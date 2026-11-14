import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BenchLine } from '../net/protocol'
import type { Bench, BenchHooks, BenchRefusal, BenchSeat } from './benches'

/** What the bench UI says when a sit or a line did not go through. `ghost` stays until dealt with. */
export type BenchNotice = Exclude<BenchRefusal, 'invalid'> | 'failed'

const NOTICE_MS = 4000
/** A touch over the server's one line a second, so a line sent on the beat is never refused. */
const SAY_GAP_MS = 1100
/** The panel keeps at most this many lines, as the server's transcript does. */
const MAX_LINES = 200

/** What the bench UI asks of the city session. */
export interface BenchActions {
  sit(): void
  stand(): void
  say(text: string): boolean
}

/**
 * The tapri and bench UI state: the bench in reach, where the player sits and who with, the lines said there
 * since they sat, and any notice. `hooks` goes to the session; App binds the session's actions once it is up.
 */
export function useBench() {
  const [near, setNear] = useState<Bench | null>(null)
  const [seat, setSeat] = useState<BenchSeat | null>(null)
  const [lines, setLines] = useState<BenchLine[]>([])
  const [notice, setNotice] = useState<BenchNotice | null>(null)
  const seatRef = useRef<BenchSeat | null>(null)
  const actions = useRef<BenchActions | null>(null)
  const lastSay = useRef(-Infinity)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const show = useCallback((n: BenchNotice | null) => {
    clearTimeout(timer.current)
    setNotice(n)
    if (n && n !== 'ghost') timer.current = setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  const hooks = useMemo<BenchHooks>(
    () => ({
      near(bench) {
        setNear(bench)
        // the "be seen first" card belongs to the bench it was asked at
        if (!bench) setNotice((n) => (n === 'ghost' ? null : n))
      },
      seated(next) {
        if (next?.bench !== seatRef.current?.bench) setLines([])
        seatRef.current = next
        setSeat(next)
        if (next) show(null)
      },
      line: (l) => setLines((all) => (all.length < MAX_LINES ? [...all, l] : [...all.slice(1), l])),
      refused: (code) => show(code === 'invalid' ? 'failed' : code),
    }),
    [show],
  )

  const bind = useCallback((a: BenchActions | null) => void (actions.current = a), [])
  const sit = useCallback(() => actions.current?.sit(), [])
  const stand = useCallback(() => actions.current?.stand(), [])
  /** Sends a line, at most one a second: false (with a notice) when it is too soon or did not go. */
  const say = useCallback(
    (text: string) => {
      const now = Date.now()
      if (now - lastSay.current < SAY_GAP_MS) {
        show('rate')
        return false
      }
      if (!actions.current?.say(text)) return false
      lastSay.current = now
      return true
    },
    [show],
  )
  const dismiss = useCallback(() => show(null), [show])
  /** Drops what `from` said: after blocking them, the lines already here go too. */
  const forget = useCallback((from: string) => setLines((all) => all.filter((l) => l.from !== from)), [])

  return { near, seat, lines, notice, hooks, bind, sit, stand, say, dismiss, forget }
}
