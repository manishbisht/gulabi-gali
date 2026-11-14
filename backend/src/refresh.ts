import { DISTRICT_IDS } from './district'
import type { Env } from './env'
import { inboxOf } from './inbox'

/** Why someone's live state is looked at again: what changed for them in D1. */
export type RefreshWhy = 'block' | 'ban' | 'mute' | 'hide' | 'profile'

/**
 * The one way a change to a person reaches the live city: after writing it to D1, call this. Each district
 * and the person's inbox reload that person's state from D1 and act on it at once:
 *
 * - `ban`: their sockets close with `LIVE_CLOSE.banned`.
 * - `hide`: off the map, a ghost on their own socket, and no inbox (unhiding brings the map back).
 * - `mute`: `say` and `status` are refused with `muted` until `muted_until`.
 * - `block`: they and everyone on either side of a block stop seeing each other (and lifting it undoes that).
 * - `profile`: their new public face goes out as a `join`.
 *
 * It never throws: a district that cannot be reached is logged, and catches up on its own (blocks and mutes
 * load again on each connect and after each wake; a ban or a hide already keeps a reconnect off the map).
 */
export async function refreshUser(env: Env, userId: string, why: RefreshWhy): Promise<void> {
  const calls: Promise<void>[] = DISTRICT_IDS.map((id) =>
    env.DISTRICT.get(env.DISTRICT.idFromName(id)).refresh(userId, why),
  )
  calls.push(inboxOf(env, userId).refresh(userId))
  for (const r of await Promise.allSettled(calls))
    if (r.status === 'rejected') console.error('refresh: a live object missed it', why, r.reason)
}
