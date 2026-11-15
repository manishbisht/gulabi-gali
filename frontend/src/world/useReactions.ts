import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { REACT_PAIR_MS, type Reaction, type ReactRefusal } from '../net/protocol'

/** Why a greeting did not go: the server's reasons, or no live street to send it on. */
export type ReactionRefusal = ReactRefusal | 'offline'

/** What the session tells React about greetings (see `CitySession.react`). */
export interface ReactionHooks {
  /** Someone the player can see greeted them. */
  got(from: { id: string; name: string }, kind: Reaction): void
  /** The player's own greeting reached `to` (the server passed it on). */
  sent(to: string, kind: Reaction): void
  /** The player's greeting to `to` did not go, and why. */
  refused(to: string, why: ReactionRefusal): void
}

/** What the reaction UI asks of the city session: null when it went out, else why not. */
export interface ReactionActions {
  react(to: string, kind: Reaction): ReactionRefusal | null
}

/** The toast: a greeting the player got (`again`: a block is offered), or why theirs did not go. */
export type ReactionNotice =
  { t: 'got'; id: string; name: string; kind: Reaction; again: boolean } | { t: 'no'; why: ReactionRefusal }

const NOTICE_MS = 4000
/** A toast offering a block stays long enough to reach for it. */
const AGAIN_MS = 10_000
/** Greetings from one person within this long add up; the `REPEAT_AT`-th offers a block. */
export const REPEAT_MS = 5 * 60_000
const REPEAT_AT = 3

/**
 * Reactions as the page sees them: the passing toast, and whom the player greeted within the pair's wait (so
 * the card rests its buttons, as the server would refuse). Kept in memory only: a reload forgets it all. `hooks`
 * goes to the session; App binds the session's `react` once it is up.
 */
export function useReactions() {
  const [notice, setNotice] = useState<ReactionNotice | null>(null)
  const [sent, setSent] = useState<Record<string, Reaction>>({})
  const actions = useRef<ReactionActions | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sentTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  /** When each person's recent greetings arrived, by id. */
  const heard = useRef(new Map<string, number[]>())
  useEffect(() => {
    const timers = sentTimers.current
    return () => {
      clearTimeout(noticeTimer.current)
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const show = useCallback((n: ReactionNotice | null) => {
    clearTimeout(noticeTimer.current)
    setNotice(n)
    if (n)
      noticeTimer.current = setTimeout(() => setNotice(null), n.t === 'got' && n.again ? AGAIN_MS : NOTICE_MS)
  }, [])

  const hooks = useMemo<ReactionHooks>(
    () => ({
      got(from, kind) {
        const now = Date.now()
        const times = (heard.current.get(from.id) ?? []).filter((at) => now - at < REPEAT_MS)
        times.push(now)
        heard.current.set(from.id, times)
        show({ t: 'got', id: from.id, name: from.name, kind, again: times.length >= REPEAT_AT })
      },
      sent(to, kind) {
        setSent((was) => ({ ...was, [to]: kind }))
        clearTimeout(sentTimers.current.get(to))
        sentTimers.current.set(
          to,
          setTimeout(() => {
            sentTimers.current.delete(to)
            setSent((was) => {
              const rest = { ...was }
              delete rest[to]
              return rest
            })
          }, REACT_PAIR_MS),
        )
      },
      refused: (_to, why) => show({ t: 'no', why }),
    }),
    [show],
  )

  const bind = useCallback((a: ReactionActions | null) => void (actions.current = a), [])
  /** Greets `to`; a greeting that cannot go is said at once, and the server's answer follows otherwise. */
  const react = useCallback(
    (to: string, kind: Reaction) => {
      const why = actions.current ? actions.current.react(to, kind) : 'offline'
      if (why) show({ t: 'no', why })
    },
    [show],
  )
  const dismiss = useCallback(() => show(null), [show])

  return { notice, sent, hooks, bind, react, dismiss }
}
