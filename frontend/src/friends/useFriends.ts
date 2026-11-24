import { useCallback, useEffect, useRef, useState } from 'react'
import { answerFriend, askFriend, getFriends, putFriendSettings, removeFriend } from '../net/friends'
import type { FriendLists, FriendSettings, FriendState } from '../net/protocol'

/**
 * A plain look again is skipped within this long of the last one (or while one is under way): the list, the
 * chat menu and the chai picker may all ask at once. The open friends list looks every `FRIENDS_POLL_MS`.
 */
const MIN_GAP_MS = 10_000
/** How often an open friends list looks again (where friends are changes as they come and go). */
export const FRIENDS_POLL_MS = 30_000

/** Where you stand with one person: friends, you asked, they asked, or none of these. */
export type FriendStanding = 'friends' | 'asked' | 'incoming' | null

export interface Friends {
  /** Null until the first look, or after one failed with nothing to show. */
  lists: FriendLists | null
  /** The last look failed. */
  failed: boolean
  /** Looks again; `force` even if it just did (after your own change, or a `friend` notice). */
  refresh(force?: boolean): Promise<void>
  standing(id: string): FriendStanding
  /** "Dost banao": where it stands now, `cooldown` when not yet again, or null when it could not be asked. */
  ask(id: string): Promise<FriendState | 'cooldown' | null>
  /** Yes (true once friends) or a silent no to `id`'s ask. */
  answer(id: string, yes: boolean): Promise<boolean>
  remove(id: string): Promise<boolean>
  /** Flips a switch; true once saved. */
  setSettings(patch: Partial<FriendSettings>): Promise<boolean>
}

/**
 * A resident's friends, asks and switches (see backend/src/friends.ts). Read on demand only: when a friends list,
 * a chat's menu or the chai picker opens, while the friends list is open (`FRIENDS_POLL_MS`), and on each
 * `friend` notice (`tick`). Nothing is fetched for nobody (`user` null), and a new user starts afresh.
 */
export function useFriends({
  user,
  token,
  tick,
}: {
  user: string | null
  token: () => Promise<string | null>
  /** Moves with each `friend` notice (see `useConnections`). */
  tick: number
}): Friends {
  const [lists, setLists] = useState<FriendLists | null>(null)
  const [failed, setFailed] = useState(false)
  const tokenRef = useRef(token)
  useEffect(() => {
    tokenRef.current = token
  }, [token])
  /** Moves with each user change: an answer from before it is dropped. */
  const gen = useRef(0)
  const seq = useRef(0)
  const last = useRef(-Infinity)
  const busy = useRef(false)
  const userRef = useRef(user)
  // a different person: nothing of the last one's stays on screen (set while rendering, as React suggests)
  const [owner, setOwner] = useState(user)
  if (owner !== user) {
    setOwner(user)
    setLists(null)
    setFailed(false)
  }
  // and no answer still on its way for the last one lands (not on the first mount: a list opening with the page
  // may already be asking, and its children's effects run first)
  useEffect(() => {
    if (userRef.current === user) return
    userRef.current = user
    gen.current++
    last.current = -Infinity
  }, [user])

  const refresh = useCallback(async (force = false) => {
    if (!userRef.current) return
    const now = Date.now()
    if (!force && (busy.current || now - last.current < MIN_GAP_MS)) return
    const g = gen.current
    const s = ++seq.current
    busy.current = true
    last.current = now
    try {
      const tok = await tokenRef.current().catch(() => null)
      const got = tok ? await getFriends(tok) : null
      if (g !== gen.current || s !== seq.current) return
      if (got) setLists(got)
      setFailed(!got)
    } finally {
      if (s === seq.current) busy.current = false
    }
  }, [])

  // a `friend` notice: someone asked, or said yes
  const firstTick = useRef(tick)
  useEffect(() => {
    if (tick !== firstTick.current) void refresh(true)
  }, [tick, refresh])

  const withToken = useCallback(async <T>(fn: (tok: string) => Promise<T>, none: T): Promise<T> => {
    const tok = await tokenRef.current().catch(() => null)
    return tok ? fn(tok) : none
  }, [])

  const ask = useCallback(
    async (id: string) => {
      const state = await withToken((tok) => askFriend(tok, id), null)
      if (state && state !== 'cooldown') void refresh(true)
      return state
    },
    [withToken, refresh],
  )
  const answer = useCallback(
    async (id: string, yes: boolean) => {
      const ok = await withToken((tok) => answerFriend(tok, id, yes), false)
      // gone from the list at once (a no tells the asker nothing either way)
      if (ok) setLists((l) => l && { ...l, incoming: l.incoming.filter((a) => a.id !== id) })
      void refresh(true)
      return ok
    },
    [withToken, refresh],
  )
  const remove = useCallback(
    async (id: string) => {
      const ok = await withToken((tok) => removeFriend(tok, id), false)
      if (ok)
        setLists(
          (l) =>
            l && {
              ...l,
              friends: l.friends.filter((f) => f.id !== id),
              sent: l.sent.filter((a) => a.id !== id),
            },
        )
      return ok
    },
    [withToken],
  )
  const setSettings = useCallback(
    async (patch: Partial<FriendSettings>) => {
      // the switch moves at once; the server's answer settles it, and a failure puts back what was patched
      const keys = Object.keys(patch) as (keyof FriendSettings)[]
      setLists((l) => l && { ...l, settings: { ...l.settings, ...patch } })
      const next = await withToken((tok) => putFriendSettings(tok, patch), null)
      setLists((l) => {
        if (!l) return l
        if (next) return { ...l, settings: next }
        const back = { ...l.settings }
        for (const k of keys) back[k] = !patch[k]
        return { ...l, settings: back }
      })
      return next !== null
    },
    [withToken],
  )
  const standing = useCallback(
    (id: string): FriendStanding => {
      if (!lists) return null
      if (lists.friends.some((f) => f.id === id)) return 'friends'
      if (lists.sent.some((a) => a.id === id)) return 'asked'
      if (lists.incoming.some((a) => a.id === id)) return 'incoming'
      return null
    },
    [lists],
  )

  return { lists, failed, refresh, standing, ask, answer, remove, setSettings }
}
