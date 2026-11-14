import { DISTRICT_IDS } from './district'
import type { Env } from './env'
import { inboxOf } from './inbox'

/** Why someone's live state is looked at again: what changed for them in D1. */
export type RefreshWhy = 'block' | 'ban' | 'mute' | 'hide' | 'profile'

/** How long `refreshUser` waits before trying a failed target again. */
export const REFRESH_RETRY_MS = 500

/**
 * The one way a change to a person reaches the live city: after writing it to D1, call this. Each district
 * and the person's inbox reload that person's state from D1 and act on it at once:
 *
 * - `ban`: their sockets close with `LIVE_CLOSE.banned`.
 * - `hide`: off the map and a ghost on their own socket (unhiding brings the map back); their inbox stays.
 * - `mute`: `say` and `status` are refused with `muted` until `muted_until`.
 * - `block`: they and everyone on either side of a block stop seeing each other (and lifting it undoes that).
 * - `profile`: their new public face goes out as a `join`.
 *
 * A target that throws is tried once more after `retryMs`. It never throws itself: it answers the targets
 * (district ids, or `inbox`) that failed twice, and logs them. For those, the districts catch up on their own:
 * each district's alarm reloads everyone connected at least every minute (`TRUST_SWEEP_MS`), so a missed ban,
 * hide, mute or block still takes hold within about a minute; blocks and mutes also load on every connect. A
 * missed `profile` waits for the person's next connect, and a missed inbox close only leaves a banned person's
 * inbox hearing nudges to lists the API no longer gives them.
 */
export async function refreshUser(
  env: Env,
  userId: string,
  why: RefreshWhy,
  retryMs = REFRESH_RETRY_MS,
): Promise<{ failed: string[] }> {
  const targets = new Map<string, () => Promise<void>>(
    DISTRICT_IDS.map((id) => [id, () => env.DISTRICT.get(env.DISTRICT.idFromName(id)).refresh(userId, why)]),
  )
  targets.set('inbox', () => inboxOf(env, userId).refresh(userId))
  const attempt = async (names: string[]) => {
    const results = await Promise.allSettled(names.map((name) => targets.get(name)!()))
    return names.filter((_, i) => results[i]!.status === 'rejected')
  }
  let failed = await attempt([...targets.keys()])
  if (failed.length) {
    await new Promise((resolve) => setTimeout(resolve, retryMs))
    failed = await attempt(failed)
  }
  if (failed.length) console.error('refresh: live objects missed it', why, failed)
  return { failed }
}
