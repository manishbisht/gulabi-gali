import type { Env } from './env'
import { GOING_OF, SEEN } from './going'
import { allow, muteGate, rateLimited } from './limits'
import { firstName } from './names'
import { forgetWalls } from './posters'
import { VISIBLE, visibleRow } from './profiles'
import { MAX_GOING_NAMES, type DistrictId, type GoingView } from './protocol'
import { deliver, PUSH_DEVICES } from './push'
import { isVerified } from './trust'

/**
 * Milte hain: "Main aaunga/aaungi" on a poster (table `rsvps`, migration 0007).
 *
 * Privacy: the count is the same number for everyone (signed out too) and counts only people others can see now,
 * so it never tells a viewer about anyone hidden, banned or blocked. First names go to the poster's owner alone,
 * and only of those they may see. The word lives and dies with the poster: the migration's triggers take it when
 * the poster comes down, is hidden, its owner is hidden or banned, or either of the two blocks the other.
 */

/** Saying it and taking it back, together, per account: plenty for real plans, not for flipping a count. */
export const RSVP_LIMIT = { perWindow: 20, windowMs: 3600_000, bucket: 'rsvp' } as const
/** The reminder goes this long before the plan's time (the cron runs every 15 minutes, so up to 15 later). */
export const REMIND_BEFORE_MS = 3600_000
/** "Main aaunga/aaungi" is refused once the plan's time is more than this far gone (the poster stays up 6 h after). */
export const LATE_MS = 30 * 60_000
/**
 * What one cron run may spend on reminders, in subrequests, D1 calls included: the run's own statements
 * (`REMIND_OVERHEAD`), and for each person pushed `REMIND_PER_PERSON` D1 calls (see `deliver`) and one `fetch`
 * per device. The account is on the Workers Free plan: about 50 subrequests and 50 D1 queries per invocation,
 * shared with the cron's other sweeps, so this leaves them room (and each device the push service says is gone,
 * one more delete). Whoever does not fit goes on the next run, while the plan is still ahead. A Paid account
 * (1000 a run) can raise it with the `REMIND_BUDGET` var, to 300 say (see `remindBudget`).
 */
export const REMIND_BUDGET = 24
/** The run's own D1 statements: the people due, claiming them, and giving back the ones a failure left unsent. */
export const REMIND_OVERHEAD = 3
/** The D1 calls `deliver` makes for one person before any device: the resident check, their devices, the limit. */
export const REMIND_PER_PERSON = 3
/** Rows one run looks at: far more than a budget's worth. */
const REMIND_CANDIDATES = 500

const fail = (error: string, status: number) => Response.json({ error }, { status })

/** A run's budget: the `REMIND_BUDGET` var when it is a positive whole number, else `REMIND_BUDGET`. */
export function remindBudget(env: Env): number {
  const n = Number(env.REMIND_BUDGET)
  return env.REMIND_BUDGET && Number.isInteger(n) && n > 0 ? n : REMIND_BUDGET
}

/**
 * Poster `?1` as `?2` may see it at `?3`, as SQL: up, and theirs, or not hidden, its owner seen by others and
 * nobody blocked either way between them (as `listPosters` lists it).
 */
const SHOWN_TO = `FROM posters po JOIN users u ON u.id = po.owner JOIN profiles p ON p.user_id = po.owner
  WHERE po.id = ?1 AND po.expires_at > ?3 AND (po.owner = ?2 OR (po.hidden = 0 AND ${VISIBLE}))
    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.a = ?2 AND b.b = po.owner) OR (b.a = po.owner AND b.b = ?2))`

/** Poster `id` as `viewer` sees its meet-up, or null when it is not up for them. */
async function goingView(env: Env, viewer: string, id: string, now: number): Promise<GoingView | null> {
  const row = await env.DB.prepare(
    `SELECT po.owner, ${GOING_OF} AS going,
       EXISTS (SELECT 1 FROM rsvps r WHERE r.poster_id = po.id AND r.user_id = ?2) AS coming ${SHOWN_TO}`,
  )
    .bind(id, viewer, now)
    .first<{ owner: string; going: number; coming: number }>()
  if (!row) return null
  const out: GoingView = { going: row.going, coming: row.coming === 1 }
  if (row.owner !== viewer) return out
  const { results } = await env.DB.prepare(
    `SELECT rp.name FROM rsvps r JOIN users ru ON ru.id = r.user_id JOIN profiles rp ON rp.user_id = r.user_id
     WHERE r.poster_id = ?1 AND ${SEEN}
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.a = ?2 AND b.b = r.user_id) OR (b.a = r.user_id AND b.b = ?2))
     ORDER BY r.created_at, r.user_id LIMIT ?3`,
  )
    .bind(id, viewer, MAX_GOING_NAMES)
    .all<{ name: string }>()
  return { ...out, names: results.map((r) => firstName(r.name)) }
}

async function rsvpLimit(env: Env, userId: string, now: number): Promise<Response | null> {
  const { perWindow, windowMs, bucket } = RSVP_LIMIT
  return (await allow(env, userId, bucket, perWindow, windowMs, now)) ? null : rateLimited(windowMs, now)
}

/** Drops the poster's district's signed-out list from this location's edge cache: its count changed. */
async function forgetWallOf(env: Env, id: string): Promise<void> {
  const row = await env.DB.prepare('SELECT district FROM posters WHERE id = ?')
    .bind(id)
    .first<{ district: DistrictId }>()
  if (row) await forgetWalls(env, [row.district])
}

/**
 * `GET /api/posters/:id/going`: 200 `GoingView` (names only for the poster's owner), 404 for a poster not up for
 * the caller.
 */
export async function getGoing(env: Env, userId: string, id: string, now = Date.now()): Promise<Response> {
  const out = await goingView(env, userId, id, now)
  return out
    ? Response.json(out, { headers: { 'cache-control': 'private, no-store' } })
    : fail('not found', 404)
}

/**
 * `PUT /api/posters/:id/going`: "Main aaunga/aaungi". 200 `GoingView`, also when already said. Only a verified resident
 * others can see (403 `ghost`, `not-verified`), not muted (403 `muted`); never on your own poster (400 `mine`);
 * 404 `not found` for a poster not up for you (gone, hidden, its owner hidden, or a block either way); 409 `past`
 * once its plan is more than `LATE_MS` gone; 429 `rate` past `RSVP_LIMIT`. Said inside the hour before the plan,
 * no reminder will come (they know).
 */
export async function putGoing(env: Env, userId: string, id: string, now = Date.now()): Promise<Response> {
  if (!(await visibleRow(env, userId))) return fail('ghost', 403)
  if (!(await isVerified(env, userId))) return fail('not-verified', 403)
  const muted = await muteGate(env, userId, now)
  if (muted) return muted
  const slow = await rsvpLimit(env, userId, now)
  if (slow) return slow
  // One statement, so a block, hide or take-down landing meanwhile either comes first (and refuses it) or after
  // (and its trigger takes the row back).
  await env.DB.prepare(
    `INSERT INTO rsvps (poster_id, user_id, created_at, reminded)
     SELECT po.id, ?2, ?3, CASE WHEN po.at_when IS NOT NULL AND po.at_when - ?3 <= ?4 THEN 1 ELSE 0 END
     ${SHOWN_TO} AND po.owner != ?2 AND po.hidden = 0 AND (po.at_when IS NULL OR po.at_when + ?5 >= ?3)
       AND EXISTS (SELECT 1 FROM users ru JOIN profiles rp ON rp.user_id = ru.id
         WHERE ru.id = ?2 AND ru.verified = 1 AND ${SEEN})
     ON CONFLICT (poster_id, user_id) DO NOTHING`,
  )
    .bind(id, userId, now, REMIND_BEFORE_MS, LATE_MS)
    .run()
  const out = await goingView(env, userId, id, now)
  if (!out) return fail('not found', 404)
  if (!out.coming) {
    const row = await env.DB.prepare('SELECT owner, at_when FROM posters WHERE id = ?')
      .bind(id)
      .first<{ owner: string; at_when: number | null }>()
    if (row?.owner === userId) return fail('mine', 400)
    if (row?.at_when != null && row.at_when + LATE_MS < now) return fail('past', 409)
    return fail('not found', 404)
  }
  await forgetWallOf(env, id)
  return Response.json({ going: out.going, coming: true } satisfies GoingView)
}

/**
 * `DELETE /api/posters/:id/going`: taking it back. 200 `GoingView` (`coming` false), or `{going: 0, coming:
 * false}` for a poster no longer up for you; anyone signed in may take theirs back. 429 `rate` past `RSVP_LIMIT`.
 */
export async function deleteGoing(env: Env, userId: string, id: string, now = Date.now()): Promise<Response> {
  const slow = await rsvpLimit(env, userId, now)
  if (slow) return slow
  const { meta } = await env.DB.prepare('DELETE FROM rsvps WHERE poster_id = ? AND user_id = ?')
    .bind(id, userId)
    .run()
  if (meta.changes) await forgetWallOf(env, id)
  const out = await goingView(env, userId, id, now)
  return Response.json({ going: out?.going ?? 0, coming: false } satisfies GoingView)
}

/** The statement that takes back every word `userId` gave (account deletion). */
export const forgetRsvpsOf = (env: Env, userId: string): D1PreparedStatement =>
  env.DB.prepare('DELETE FROM rsvps WHERE user_id = ?').bind(userId)

/**
 * The cron's reminder: for every plan due within `REMIND_BEFORE_MS` of `now` on a poster still up for everyone
 * (not hidden, its owner seen by others), each person coming who is, as it sends, seen by others and verified,
 * and was not reminded yet, is marked reminded and pushed once (`deliver`, which names nobody: "your plan is in
 * an hour", held by the push service only until the plan). Someone with push off is marked and costs nothing.
 * A run spends at most `budget` subrequests (see `REMIND_BUDGET`), always taking at least one person, and claims
 * only the people it then pushes; a push that failed (no device took it, and not because there was nothing to
 * send) is given back, for the next run while the plan is still ahead. Answers how many people's devices took
 * it. Throws only when D1 cannot be reached.
 */
export async function remindMeetups(
  env: Env,
  now = Date.now(),
  fetcher: typeof fetch = fetch,
  { budget = remindBudget(env) }: { budget?: number } = {},
): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT r.rowid AS rid, r.user_id, po.at_when,
       (SELECT COUNT(*) FROM push_subs s WHERE s.user_id = r.user_id) AS devices
     FROM posters po JOIN rsvps r ON r.poster_id = po.id
       JOIN users u ON u.id = po.owner JOIN profiles p ON p.user_id = po.owner
       JOIN users ru ON ru.id = r.user_id JOIN profiles rp ON rp.user_id = r.user_id
     WHERE po.at_when > ?1 AND po.at_when <= ?2 AND po.expires_at > ?1 AND po.hidden = 0 AND r.reminded = 0
       AND ${VISIBLE} AND ${SEEN} AND ru.verified = 1
     ORDER BY po.at_when, r.rowid LIMIT ?3`,
  )
    .bind(now, now + REMIND_BEFORE_MS, REMIND_CANDIDATES)
    .all<{ rid: number; user_id: string; at_when: number; devices: number }>()
  // One push per person, however many of their plans are due: held until the soonest.
  const people = new Map<string, { rids: number[]; at: number; devices: number }>()
  for (const r of results) {
    const p = people.get(r.user_id)
    if (p) p.rids.push(r.rid)
    else people.set(r.user_id, { rids: [r.rid], at: r.at_when, devices: Math.min(r.devices, PUSH_DEVICES) })
  }
  const rids: number[] = []
  const due = new Map<string, number>()
  let spent = REMIND_OVERHEAD
  for (const [id, p] of people) {
    const cost = p.devices ? p.devices + REMIND_PER_PERSON : 0
    if (cost && due.size && spent + cost > budget) continue
    spent += cost
    rids.push(...p.rids)
    if (p.devices) due.set(id, p.at)
  }
  if (!rids.length) return 0
  // Claimed in one statement: a run overlapping this one cannot push the same person again.
  const claimed = await env.DB.prepare(
    `UPDATE rsvps SET reminded = 1 WHERE rowid IN (SELECT value FROM json_each(?1)) AND reminded = 0
     RETURNING rowid AS rid, user_id`,
  )
    .bind(JSON.stringify(rids))
    .all<{ rid: number; user_id: string }>()
  const mine = new Map<string, number[]>()
  for (const r of claimed.results) mine.set(r.user_id, [...(mine.get(r.user_id) ?? []), r.rid])
  const sent = await Promise.all(
    [...due]
      .filter(([id]) => mine.has(id))
      .map(async ([id, at]) => ({
        id,
        ...(await deliver(env, id, 'meetup', fetcher, now, (at - now) / 1000)),
      })),
  )
  const failed = sent.filter((s) => s.retry).flatMap((s) => mine.get(s.id)!)
  if (failed.length)
    await env.DB.prepare('UPDATE rsvps SET reminded = 0 WHERE rowid IN (SELECT value FROM json_each(?1))')
      .bind(JSON.stringify(failed))
      .run()
  return sent.filter((s) => s.took > 0).length
}
