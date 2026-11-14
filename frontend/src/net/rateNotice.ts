/**
 * A 429 from any call is the server asking for a little patience. Calls that have a line of their own for it
 * (a chat message, an invite code, a report) use plain `fetch`; every other one goes through `fetchNoting`,
 * which tells whoever listens (the app's "slow down" toast) so no write path fails silently.
 */
const listeners = new Set<() => void>()

export const onRateLimited = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** `fetch`, and a nudge to the listeners when the answer is 429. Rejects exactly as `fetch` does. */
export async function fetchNoting(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 429) for (const fn of listeners) fn()
  return res
}
