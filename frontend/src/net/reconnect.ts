/** Waits between reconnects: 1, 2, 4, 8 s and so on, never more than this. */
const BACKOFF_FIRST_MS = 1000
const BACKOFF_MAX_MS = 15_000
/** A socket that stayed up this long was healthy: the next drop starts the backoff over. */
const STABLE_MS = 30_000

export interface Reconnector {
  /** Opens again after the next backoff wait. */
  later(): void
  /** A socket just came up; `dropped` judges how long it lasted. */
  opened(): void
  /** The socket went down by itself: the backoff starts over if it had been healthy, then `later`. */
  dropped(): void
  /** For good: any pending wait is cancelled. */
  stop(): void
}

/** The backoff both sockets (district and inbox) keep themselves up with. `open` is called after each wait. */
export function reconnecting(open: () => void): Reconnector {
  let attempt = 0
  let openedAt = 0
  let retry: ReturnType<typeof setTimeout> | null = null
  const stop = () => {
    if (retry) clearTimeout(retry)
    retry = null
  }
  const later = () => {
    stop()
    const delay = Math.min(BACKOFF_FIRST_MS * 2 ** attempt, BACKOFF_MAX_MS)
    attempt++
    retry = setTimeout(() => {
      retry = null
      open()
    }, delay)
  }
  return {
    later,
    opened() {
      openedAt = Date.now()
    },
    dropped() {
      if (openedAt && Date.now() - openedAt >= STABLE_MS) attempt = 0
      openedAt = 0
      later()
    },
    stop,
  }
}
