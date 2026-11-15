import { useEffect, useState } from 'react'
import { fetchCount } from '../net/api'

/** How often the welcome screen asks again: the server's own copy is at most this old. */
export const COUNT_POLL_MS = 30_000

/**
 * The city's count for the welcome screen (see `fetchCount`): null until one arrives, and kept through a
 * failed read rather than blanked. Asked on mount and every `COUNT_POLL_MS` while the page shows; never once
 * the screen is gone.
 */
export function useCityCount(): number | null {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    const ctl = new AbortController()
    const read = async () => {
      const got = await fetchCount(ctl.signal)
      if (!ctl.signal.aborted && got !== null) setCount(got)
    }
    void read()
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void read()
    }, COUNT_POLL_MS)
    return () => {
      ctl.abort()
      clearInterval(timer)
    }
  }, [])
  return count
}
