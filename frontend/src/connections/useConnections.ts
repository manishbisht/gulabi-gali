import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  acceptRequest,
  getEnded,
  getMatches,
  getMessages,
  getRequests,
  ignoreRequest,
  unmatch,
} from '../net/api'
import { connectInbox } from '../net/inbox'
import type { EndedChat, InboxNotice, MatchView, RequestLists } from '../net/protocol'
import { storage } from '../storage'

const READ_KEY = 'gg-read'
const NONE: RequestLists = { incoming: [], sent: [] }

type ReadMap = Record<string, string>

function loadRead(): ReadMap {
  const raw = storage.getJSON<unknown>(READ_KEY, {})
  const out: ReadMap = {}
  if (raw && typeof raw === 'object')
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v
  return out
}

export interface Connections {
  incoming: RequestLists['incoming']
  /** Only the pending ones: an accepted request is a chat by now. */
  sent: RequestLists['sent']
  matches: MatchView[]
  /** Unread incoming requests plus unread chats. */
  badge: number
  /** Whether a request has not been looked at yet. */
  requestUnread(id: string): boolean
  chatUnread(matchId: string): boolean
  /** The incoming tab was looked at. */
  seeIncoming(): void
  /** The chat was read up to this message id. */
  markRead(matchId: string, messageId: string): void
  /** How many times the inbox socket has come (back) up: an open chat refetches, it may have missed a message. */
  reconnects: number
  /** Per match, how many `message` notices have arrived: a chat that is open refetches when its count moves. */
  messageTicks: Record<string, number>
  /** Matches the other person ended (an `unmatched` notice): an open one says so instead of vanishing. */
  ended: ReadonlySet<string>
  /**
   * Chats that ended in the last 30 days, by either side (an unmatch, a block, a deletion), from the server:
   * they can still be reported. Fetched with the request lists.
   */
  endedChats: EndedChat[]
  /** The match id on success, null if it could not be accepted. The lists are fresh when it resolves. */
  accept(id: string): Promise<string | null>
  ignore(id: string): Promise<void>
  /** True once the match is gone. */
  unmatch(matchId: string): Promise<boolean>
  refresh(): Promise<void>
}

/**
 * A resident's requests, matches and unread state, kept fresh by the inbox socket. A notice only says "look
 * again": a `message` refetches the chats, any other notice every list (and so does each (re)connect, so a
 * notice missed offline is still caught).
 */
export function useConnections({
  user,
  token,
  onBanned,
}: {
  /** The signed-in resident, or null for nobody (no inbox). A different user starts everything afresh. */
  user: string | null
  token: () => Promise<string | null>
  /** The inbox was closed because this person is no longer a resident (4004): ask the server who they are. */
  onBanned?: () => void
}): Connections {
  const [lists, setLists] = useState<RequestLists>(NONE)
  const [matches, setMatches] = useState<MatchView[]>([])
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set())
  const [read, setRead] = useState<ReadMap>(loadRead)
  /** The newest message id known per match, from a notice or a fetch. */
  const [latest, setLatest] = useState<Record<string, string>>({})
  const [messageTicks, setTicks] = useState<Record<string, number>>({})
  const [ended, setEnded] = useState<ReadonlySet<string>>(new Set())
  const [endedChats, setEndedChats] = useState<EndedChat[]>([])
  const [reconnects, setReconnects] = useState(0)
  /** Moves with every sign-out or user change: an answer from before it is dropped. */
  const gen = useRef(0)
  /** Each list's newest fetch: an older answer that lands after a newer one is dropped. */
  const seq = useRef({ requests: 0, matches: 0, ended: 0 })
  const tokenRef = useRef(token)
  const bannedRef = useRef(onBanned)
  const alive = useRef(true)
  const asked = useRef(new Set<string>())
  useEffect(() => {
    tokenRef.current = token
    bannedRef.current = onBanned
  }, [token, onBanned])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const writeRead = useCallback((fn: (r: ReadMap) => ReadMap) => {
    setRead((was) => {
      const next = fn(was)
      if (next === was) return was
      storage.set(READ_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  /** Refetches the matches, and the request lists and ended chats too unless `only` says chats. */
  const refresh = useCallback(
    async (only?: 'chats') => {
      const g = gen.current
      const m = ++seq.current.matches
      const r = only ? null : ++seq.current.requests
      const e = only ? null : ++seq.current.ended
      const tok = await tokenRef.current().catch(() => null)
      if (!tok || g !== gen.current) return
      const [req, mat, end] = await Promise.allSettled([
        r === null ? null : getRequests(tok),
        getMatches(tok),
        e === null ? null : getEnded(tok),
      ])
      if (!alive.current || g !== gen.current) return
      if (r === seq.current.requests && req.status === 'fulfilled' && req.value) setLists(req.value)
      if (e === seq.current.ended && end.status === 'fulfilled' && end.value) setEndedChats(end.value)
      if (m === seq.current.matches && mat.status === 'fulfilled') {
        setMatches(mat.value)
        const ids = new Set(mat.value.map((m) => m.id))
        // read marks of matches that are gone would pile up for good
        writeRead((r) => {
          const keep = Object.keys(r).filter((k) => ids.has(k))
          return keep.length === Object.keys(r).length ? r : Object.fromEntries(keep.map((k) => [k, r[k]!]))
        })
        // A chat's last line carries no id: for a chat read before, ask once what its newest id is
        for (const m of mat.value) {
          if (!m.last || m.last.mine || asked.current.has(m.id)) continue
          asked.current.add(m.id)
          void getMessages(tok, m.id)
            .then((page) => {
              const id = page?.messages.at(-1)?.id
              if (id && alive.current && g === gen.current) setLatest((l) => ({ ...l, [m.id]: id }))
            })
            .catch(() => asked.current.delete(m.id))
        }
      }
    },
    [writeRead],
  )

  useEffect(() => {
    if (!user) return
    const generation = gen
    const questions = asked
    const conn = connectInbox({
      token: () => tokenRef.current(),
      onBanned: () => bannedRef.current?.(),
      onOpen: () => {
        setReconnects((n) => n + 1)
        void refresh()
      },
      onNotice: (n: InboxNotice) => {
        if (n.t === 'message') {
          setLatest((l) => ({ ...l, [n.matchId]: n.id }))
          setTicks((t) => ({ ...t, [n.matchId]: (t[n.matchId] ?? 0) + 1 }))
          // a message changes a chat's last line, never a request
          return void refresh('chats')
        }
        if (n.t === 'unmatched') setEnded((was) => new Set([...was, n.matchId]))
        void refresh()
      },
    })
    return () => {
      conn.close()
      generation.current++
      questions.current.clear()
      setLists(NONE)
      setMatches([])
      setSeen(new Set())
      setLatest({})
      setTicks({})
      setEnded(new Set())
      setEndedChats([])
    }
  }, [user, refresh])

  const sent = useMemo(() => lists.sent.filter((r) => r.state === 'pending'), [lists.sent])

  const chatUnread = useCallback(
    (matchId: string) => {
      const m = matches.find((x) => x.id === matchId)
      if (!m?.last || m.last.mine) return false
      // no mark yet: never opened. A mark with the newest id still unknown reads as read until it is known.
      if (read[matchId] === undefined) return true
      return latest[matchId] !== undefined && latest[matchId] !== read[matchId]
    },
    [matches, read, latest],
  )
  const requestUnread = useCallback((id: string) => !seen.has(id), [seen])

  const badge =
    lists.incoming.filter((r) => !seen.has(r.id)).length + matches.filter((m) => chatUnread(m.id)).length

  const seeIncoming = useCallback(() => {
    setSeen((was) => {
      if (lists.incoming.every((r) => was.has(r.id))) return was
      return new Set([...was, ...lists.incoming.map((r) => r.id)])
    })
  }, [lists.incoming])

  const markRead = useCallback(
    (matchId: string, messageId: string) => {
      setLatest((l) => (l[matchId] === messageId ? l : { ...l, [matchId]: messageId }))
      writeRead((r) => (r[matchId] === messageId ? r : { ...r, [matchId]: messageId }))
    },
    [writeRead],
  )

  const accept = useCallback(
    async (id: string) => {
      const tok = await tokenRef.current().catch(() => null)
      const matchId = tok ? await acceptRequest(tok, id) : null
      await refresh()
      return matchId
    },
    [refresh],
  )

  const ignore = useCallback(
    async (id: string) => {
      const tok = await tokenRef.current().catch(() => null)
      if (tok && (await ignoreRequest(tok, id))) {
        // gone quietly, without waiting for the refetch
        setLists((l) => ({ ...l, incoming: l.incoming.filter((r) => r.id !== id) }))
      }
      await refresh()
    },
    [refresh],
  )

  const leave = useCallback(
    async (matchId: string) => {
      const tok = await tokenRef.current().catch(() => null)
      const gone = tok ? await unmatch(tok, matchId) : false
      if (gone) {
        setMatches((m) => m.filter((x) => x.id !== matchId))
        writeRead((r) => {
          if (!(matchId in r)) return r
          const rest = { ...r }
          delete rest[matchId]
          return rest
        })
        void refresh()
      }
      return gone
    },
    [refresh, writeRead],
  )

  return {
    incoming: lists.incoming,
    sent,
    matches,
    badge,
    requestUnread,
    chatUnread,
    seeIncoming,
    markRead,
    reconnects,
    messageTicks,
    ended,
    endedChats,
    accept,
    ignore,
    unmatch: leave,
    refresh,
  }
}
