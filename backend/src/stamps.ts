import type { Env } from './env'
import { stampLimit } from './limits'
import { activeRow } from './profiles'
import STAMPS from './stamps.json'

/**
 * Jaipur Darshan: one stamp per landmark, the ids in `stamps.json` (the page carries a byte-for-byte copy, with
 * the landmark names it shows). This order is the order every answer lists them in.
 */
export const STAMP_IDS: readonly string[] = STAMPS.map((s) => s.id)

/** A resident's stamps, in `STAMP_IDS` order. Anything stored that is no longer a stamp is left out. */
export async function stampsOf(env: Env, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT stamp FROM user_stamps WHERE user_id = ?')
    .bind(userId)
    .all<{ stamp: string }>()
  const have = new Set(results.map((r) => r.stamp))
  return STAMP_IDS.filter((id) => have.has(id))
}

/**
 * The ids of a `{stamps: string[]}` body, once each: every one a known stamp, and no more of them than there
 * are stamps (a repeat counts, and is then dropped). Null for anything else.
 */
function parseStamps(raw: unknown): string[] | null {
  const list = (raw as { stamps?: unknown } | null)?.stamps
  if (!Array.isArray(list) || list.length > STAMP_IDS.length) return null
  if (!list.every((id) => typeof id === 'string' && STAMP_IDS.includes(id))) return null
  return [...new Set(list as string[])]
}

/**
 * `PUT /api/me/stamps {stamps}`: adds the stamps a page has collected to the resident's own and answers the
 * whole set (`{stamps}`), so an empty list is a plain read. Never removes one. A resident only (`ACTIVE`; a
 * hidden one too): a banned one is 403 `banned` (the route's `bannedGate`, as for every write), anyone else
 * 403 `ghost`, and a ghost's stamps stay on their device. 400 `invalid` for
 * an unknown id or more ids than there are stamps; 429 past `STAMP_LIMIT`.
 */
export async function putStamps(env: Env, userId: string, raw: unknown, now = Date.now()): Promise<Response> {
  if (!(await activeRow(env, userId))) return Response.json({ error: 'ghost' }, { status: 403 })
  const slow = await stampLimit(env, userId, now)
  if (slow) return slow
  const ids = parseStamps(raw)
  if (!ids) return Response.json({ error: 'invalid' }, { status: 400 })
  if (ids.length)
    await env.DB.batch(
      ids.map((id) =>
        env.DB.prepare('INSERT OR IGNORE INTO user_stamps (user_id, stamp, at) VALUES (?, ?, ?)').bind(
          userId,
          id,
          now,
        ),
      ),
    )
  return Response.json({ stamps: await stampsOf(env, userId) })
}
