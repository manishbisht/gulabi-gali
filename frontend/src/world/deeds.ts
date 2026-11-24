import type { Deed } from './today'

/*
 * A tiny event bus for "Aaj ka Darshan": the existing hooks say what the player just did at the moment it
 * happens (a landmark's ring reached, a ride arrived, a photo taken…), and `useToday` listens. Nothing polls and
 * nothing runs per frame: each emit is one of those once-per-change moments. Local to this page; never sent.
 */

type Listener = (deed: Deed) => void
const listeners = new Set<Listener>()

/** Tells every listener about `deed`. A listener that throws does not stop the rest. */
export function emitDeed(deed: Deed): void {
  for (const fn of [...listeners])
    try {
      fn(deed)
    } catch {
      // one broken listener must not break the hook that emitted
    }
}

/** Listens for deeds; returns the way to stop. */
export function onDeed(fn: Listener): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
