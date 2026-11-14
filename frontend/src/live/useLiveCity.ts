import { useEffect, useMemo, useRef, useState } from 'react'
import { fallbackSnapshot, fetchCity } from '../net/api'
import type { CitySnapshot } from '../net/protocol'

const REFRESH_MS = 10 * 60 * 1000
/** A kept live snapshot older than this yields to a stale reply: three hours of old weather is worse than none. */
const KEEP_LIVE_MS = 3 * 60 * 60 * 1000

export interface LiveCity {
  /** The latest snapshot (null until the first fetch settles); render from this. */
  snapshot: CitySnapshot | null
  /** Latest snapshot or the stale default, read synchronously. */
  current(): CitySnapshot
  /** The clock the sky runs on: `new Date()`, unless a test froze it. */
  now(): Date
  /** Test hooks: merge into the snapshot, and freeze the clock at an ISO instant. */
  patch(partial: Partial<CitySnapshot>): void
  freeze(iso: string): void
}

/** Fetches the city snapshot now and every 10 minutes. */
export function useLiveCity(): LiveCity {
  const [snapshot, setSnapshot] = useState<CitySnapshot | null>(null)
  const latest = useRef<CitySnapshot | null>(null)
  const frozen = useRef<number | null>(null)

  const api = useMemo(() => {
    const current = () => (latest.current ??= fallbackSnapshot(new Date()))
    return {
      current,
      now: () => new Date(frozen.current ?? Date.now()),
      patch(partial: Partial<CitySnapshot>) {
        latest.current = { ...current(), ...partial }
        setSnapshot(latest.current)
      },
      freeze(iso: string) {
        frozen.current = Date.parse(iso)
      },
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      void fetchCity(controller.signal).then((s) => {
        if (controller.signal.aborted) return
        // One failed refresh must not replace good, recent live data with the stale default.
        const kept = latest.current
        if (s.stale && kept && !kept.stale && Date.now() - Date.parse(kept.fetchedAt) < KEEP_LIVE_MS) return
        latest.current = s
        setSnapshot(s)
      })
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [])

  return { snapshot, ...api }
}
