import { useCallback, useEffect, useRef, useState } from 'react'

/** How long "Jaipur can see you now" stays up after getting in. */
export const ADMITTED_MS = 4000

/**
 * The line for room in a full city, as the live socket tells it (`queued`, for the session's presence hook):
 * where this resident stands (null: not waiting), whether the card is up (it can be dismissed, and reopened
 * from the chip), and a passing `admitted` once they get in.
 */
export function useQueue() {
  const [position, setPosition] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [admitted, setAdmitted] = useState(false)
  const waiting = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  /** Each welcome and position from the socket: `visible` says whether this socket is now seen. */
  const queued = useCallback((next: number | null, visible: boolean) => {
    const was = waiting.current
    waiting.current = next !== null
    setPosition(next)
    if (next !== null) return
    setDismissed(false)
    if (was && visible) {
      clearTimeout(timer.current)
      setAdmitted(true)
      timer.current = setTimeout(() => setAdmitted(false), ADMITTED_MS)
    }
  }, [])
  const dismiss = useCallback(() => setDismissed(true), [])
  const reopen = useCallback(() => setDismissed(false), [])

  return { position, card: position !== null && !dismissed, admitted, queued, dismiss, reopen }
}
