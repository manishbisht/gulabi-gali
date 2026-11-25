/*
 * "Something was touched": the one moment the touchables and the animals' feeding and petting tell the rest of
 * the page about (a bell rung, a pump worked, pigeons sent up, a diya lit, the cow fed, a dog or cat petted).
 * DOM-free and local to this page: nothing is sent to anyone. "Aaj ka Darshan" can listen here.
 */

export type Touched = 'bell' | 'pump' | 'pigeons' | 'diyas' | 'feed' | 'pet'

type Listener = (kind: Touched) => void
const listeners = new Set<Listener>()

/** Called at the moment the thing is done. A listener that throws does not stop the rest, or the touch. */
export function touched(kind: Touched): void {
  for (const fn of [...listeners])
    try {
      fn(kind)
    } catch {
      // one broken listener must not break the street
    }
}

/** Listens for touches; returns the way to stop. */
export function onTouched(fn: Listener): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
