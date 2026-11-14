import { DISTRICT_IDS } from './district'
import type { Env } from './env'
import { wordsOk } from './filter/server'
import { floating, type Later } from './inbox'
import { allow, DAY_MS, muteGate, rateLimited } from './limits'
import { firstName } from './names'
import { VISIBLE, visibleRow } from './profiles'
import {
  MAX_POSTER,
  MIN_POSTER,
  POSTER_AFTER_MS,
  POSTER_AHEAD_MS,
  POSTER_SLOTS,
  POSTER_TTL_MS,
  POSTER_WALLS,
  type DistrictId,
  type PosterView,
} from './protocol'
import { cleanReason } from './requests'
import { isVerified } from './trust'

/** Pins one account may make in a day (taking one down gives none back). */
export const POSTERS_PER_DAY = 5
/** Posters one person may have up at once (hidden ones included, until they expire or an admin acts). */
export const MAX_LIVE_POSTERS = 2
/**
 * Poster auto-hide: this many distinct reporters, each verified, not banned, with an account at least
 * `accountAge` old and not blocked by the poster's owner, take a poster off every wall until an admin acts.
 * Reports from anyone else are still queued, and never count. A poster report never counts toward hiding a
 * person (see `COUNTED_REPORTS`).
 */
export const POSTER_HIDE = { reporters: 3, accountAge: 7 * DAY_MS } as const
/** How many times a pin that lost a race for its slot is tried again. */
const PLACE_TRIES = 3

const fail = (error: string, status: number, extra?: Record<string, unknown>) =>
  Response.json({ error, ...extra }, { status })
const invalid = (field: string) => fail('invalid', 400, { field })

const isDistrict = (x: unknown): x is DistrictId => DISTRICT_IDS.includes(x as DistrictId)

/** A poster as it sits in D1, where it hangs. */
export interface Placed {
  id: string
  district: DistrictId
}

interface Parsed {
  district: DistrictId
  wall: number
  text: string
  when: number | null
}

/**
 * The pin as asked for, or the first field that is wrong. `when` must be a whole number of ms after `now`, and
 * no more than 30 days after it (exactly 30 days is fine).
 */
function parse(raw: unknown, now: number): Parsed | { field: string } {
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  if (!isDistrict(b.district)) return { field: 'district' }
  const district = b.district
  const wall = b.wall
  if (typeof wall !== 'number' || !Number.isInteger(wall) || wall < 0 || wall >= POSTER_WALLS[district])
    return { field: 'wall' }
  const text = cleanReason(b.text, MIN_POSTER, MAX_POSTER)
  if (text === null) return { field: 'text' }
  const when = b.when ?? null
  if (
    when !== null &&
    (typeof when !== 'number' || !Number.isInteger(when) || when <= now || when > now + POSTER_AHEAD_MS)
  )
    return { field: 'when' }
  return { district, wall, text, when }
}

const stub = (env: Env, district: DistrictId) => env.DISTRICT.get(env.DISTRICT.idFromName(district))

/**
 * Tells each district that these posters came down (its sockets drop them). Never throws: the poster is
 * already gone from D1, and a district that missed it shows it only until its people next fetch the walls.
 */
export async function tellRemoved(env: Env, gone: readonly Placed[]): Promise<void> {
  const by = new Map<DistrictId, string[]>()
  for (const p of gone) by.set(p.district, [...(by.get(p.district) ?? []), p.id])
  await Promise.all(
    [...by].map(([district, ids]) =>
      stub(env, district)
        .posterRemoved(ids)
        .catch((err: unknown) => console.error('posters: remove notice failed', district, err)),
    ),
  )
}

/** Tells the district a poster went up (after `gone` came down to make room). Never throws, like `tellRemoved`. */
async function tellAdded(
  env: Env,
  district: DistrictId,
  poster: PosterView,
  owner: string,
  gone: string[],
): Promise<void> {
  try {
    await stub(env, district).posterAdded(poster, owner, gone)
  } catch (err) {
    console.error('posters: add notice failed', district, err)
  }
}

/** How many posters `owner` has up at `now`, as SQL (`?1` the owner, `?2` now). */
const LIVE_OF = 'SELECT COUNT(*) AS n FROM posters WHERE owner = ?1 AND expires_at > ?2'

/**
 * Puts the poster up on its wall. Expired posters there are cleared first. A free slot is used if there is
 * one; on a full wall the oldest poster not the pinner's own goes (a hidden one before any other), and the new
 * one takes its slot. Taking it down and putting this up are one transaction, both guarded by the pinner still
 * having room for one more, so a lost race never removes a poster for nothing. Null when the slot was taken
 * meanwhile (the unique index refused it: try again); `limit` when the pinner no longer has room.
 */
async function place(
  env: Env,
  owner: string,
  p: Parsed,
  view: Omit<PosterView, 'slot'>,
  now: number,
): Promise<{ slot: number; gone: string[] } | 'limit' | null> {
  const { results: expired } = await env.DB.prepare(
    'DELETE FROM posters WHERE district = ? AND wall = ? AND expires_at <= ? RETURNING id',
  )
    .bind(p.district, p.wall, now)
    .all<{ id: string }>()
  const gone = expired.map((r) => r.id)
  const { results: up } = await env.DB.prepare(
    'SELECT id, owner, slot, hidden, created_at FROM posters WHERE district = ? AND wall = ?',
  )
    .bind(p.district, p.wall)
    .all<{ id: string; owner: string; slot: number; hidden: number; created_at: number }>()
  const taken = new Set(up.map((r) => r.slot))
  let slot = 0
  while (taken.has(slot)) slot++
  let victim: string | null = null
  if (slot >= POSTER_SLOTS) {
    const oldest = up
      .filter((r) => r.owner !== owner)
      .sort((a, b) => b.hidden - a.hidden || a.created_at - b.created_at || (a.id < b.id ? -1 : 1))[0]
    // Every poster on the wall is the pinner's own: they have no room anyway.
    if (!oldest) return 'limit'
    victim = oldest.id
    slot = oldest.slot
  }
  const room = `(${LIVE_OF}) < ${MAX_LIVE_POSTERS}`
  let results: D1Result[]
  try {
    results = await env.DB.batch([
      ...(victim
        ? [env.DB.prepare(`DELETE FROM posters WHERE id = ?3 AND ${room}`).bind(owner, now, victim)]
        : []),
      env.DB.prepare(
        `INSERT INTO posters (id, owner, district, wall, slot, text, at_when, created_at, expires_at)
         SELECT ?3, ?1, ?4, ?5, ?6, ?7, ?8, ?2, ?9 WHERE ${room}`,
      ).bind(
        owner,
        now,
        view.id,
        p.district,
        p.wall,
        slot,
        p.text,
        p.when,
        p.when === null ? now + POSTER_TTL_MS : p.when + POSTER_AFTER_MS,
      ),
    ])
  } catch (err) {
    // Someone else's pin took the slot first: the whole batch rolled back.
    console.warn('posters: slot taken, trying again', err)
    if (gone.length)
      await tellRemoved(
        env,
        gone.map((id) => ({ id, district: p.district })),
      )
    return null
  }
  if (results.at(-1)!.meta.changes !== 1) return 'limit'
  return { slot, gone: victim ? [...gone, victim] : gone }
}

/**
 * `POST /api/posters {district, wall, text, when?}`: 201 with the poster (`mine`). Only a verified resident
 * others can see (403 `ghost`, `not-verified`), not muted (403 `muted`). 400 `invalid` with the `field`, or
 * `words` (field `text`). At most `MAX_LIVE_POSTERS` up at once (409 `limit`), and `POSTERS_PER_DAY` pins a day
 * (429 `rate`, counted only for pins that would otherwise go up). It goes live at once: the district tells
 * everyone there, but anyone blocked either way with the pinner.
 */
export async function pinPoster(
  env: Env,
  userId: string,
  raw: unknown,
  later: Later = floating,
  now = Date.now(),
): Promise<Response> {
  const me = await visibleRow(env, userId)
  if (!me) return fail('ghost', 403)
  if (!(await isVerified(env, userId))) return fail('not-verified', 403)
  const muted = await muteGate(env, userId, now)
  if (muted) return muted
  const p = parse(raw, now)
  if ('field' in p) return invalid(p.field)
  if (!wordsOk(p.text)) return fail('words', 400, { field: 'text' })
  const live = await env.DB.prepare(LIVE_OF).bind(userId, now).first<{ n: number }>()
  if ((live?.n ?? 0) >= MAX_LIVE_POSTERS) return fail('limit', 409)
  if (!(await allow(env, userId, 'poster', POSTERS_PER_DAY, DAY_MS, now))) return rateLimited(DAY_MS, now)
  const view = { id: crypto.randomUUID(), wall: p.wall, text: p.text, when: p.when, name: firstName(me.name) }
  for (let tries = 0; tries < PLACE_TRIES; tries++) {
    const placed = await place(env, userId, p, view, now)
    if (placed === null) continue
    if (placed === 'limit') return fail('limit', 409)
    const poster: PosterView = { ...view, slot: placed.slot }
    later(tellAdded(env, p.district, poster, userId, placed.gone))
    return Response.json({ ...poster, mine: true } satisfies PosterView, { status: 201 })
  }
  return fail('busy', 503)
}

/**
 * `GET /api/districts/:id/posters`: every poster up in the district, wall by wall: text, time, first name.
 * Public. Not the hidden or expired ones, nor those of anyone others may no longer see (banned, hidden). For a
 * signed-in `viewer`, not those of anyone blocked either way with them, and their own marked `mine`: such a
 * list is theirs alone, so it is never cached; the signed-out one is, for 30 s.
 */
export async function listPosters(
  env: Env,
  district: string,
  viewer: string | null,
  now = Date.now(),
): Promise<Response> {
  if (!isDistrict(district)) return fail('not found', 404)
  const { results } = await env.DB.prepare(
    `SELECT po.id, po.owner, po.wall, po.slot, po.text, po.at_when, p.name FROM posters po
     JOIN users u ON u.id = po.owner JOIN profiles p ON p.user_id = po.owner
     WHERE po.district = ?1 AND po.hidden = 0 AND po.expires_at > ?2 AND ${VISIBLE}
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.a = ?3 AND b.b = po.owner) OR (b.a = po.owner AND b.b = ?3))
     ORDER BY po.wall, po.slot LIMIT ?4`,
  )
    .bind(district, now, viewer ?? '', POSTER_WALLS[district] * POSTER_SLOTS)
    .all<{
      id: string
      owner: string
      wall: number
      slot: number
      text: string
      at_when: number | null
      name: string
    }>()
  const out: PosterView[] = results.map((r) => ({
    id: r.id,
    wall: r.wall,
    slot: r.slot,
    text: r.text,
    when: r.at_when,
    name: firstName(r.name),
    ...(viewer !== null && r.owner === viewer ? { mine: true as const } : {}),
  }))
  return Response.json(out, {
    headers: {
      'cache-control': viewer === null ? 'public, max-age=30' : 'private, no-store',
      vary: 'Authorization',
    },
  })
}

/** `DELETE /api/posters/:id`: 204 once your own poster is down, 404 for one that is not (or no longer) yours. */
export async function removeOwnPoster(
  env: Env,
  userId: string,
  id: string,
  later: Later = floating,
): Promise<Response> {
  const { results } = await env.DB.prepare(
    'DELETE FROM posters WHERE id = ? AND owner = ? RETURNING id, district',
  )
    .bind(id, userId)
    .all<Placed>()
  if (!results.length) return fail('not found', 404)
  later(tellRemoved(env, results))
  return new Response(null, { status: 204 })
}

/** Takes every poster of `owner` down, wherever it hangs (a ban, a deletion), as one statement for a batch. */
export const takeDownAllOf = (env: Env, owner: string) =>
  env.DB.prepare('DELETE FROM posters WHERE owner = ? RETURNING id, district').bind(owner)

/**
 * `DELETE /api/admin/posters/:id` (the caller is an admin): the poster comes down off every wall, and every
 * open report about it closes as actioned. 200 `{id, removed, closed}`; 404 when there was neither.
 */
export async function adminRemovePoster(env: Env, id: string, now = Date.now()): Promise<Response> {
  const [down, closed] = await env.DB.batch([
    env.DB.prepare('DELETE FROM posters WHERE id = ? RETURNING id, district').bind(id),
    env.DB.prepare(
      "UPDATE reports SET state = 'actioned', closed_at = ? WHERE poster_id = ? AND state = 'open'",
    ).bind(now, id),
  ])
  const gone = down!.results as Placed[]
  if (!gone.length && !closed!.meta.changes) return fail('not found', 404)
  await tellRemoved(env, gone)
  return Response.json({ id, removed: gone.length > 0, closed: closed!.meta.changes })
}

/** What a poster report carries and whom it is about, or null for a poster that is not up (expired, gone). */
export async function posterEvidence(
  env: Env,
  id: string,
  now: number,
): Promise<{ owner: string; evidence: string } | null> {
  const row = await env.DB.prepare(
    'SELECT owner, district, wall, text, at_when FROM posters WHERE id = ? AND expires_at > ?',
  )
    .bind(id, now)
    .first<{ owner: string; district: DistrictId; wall: number; text: string; at_when: number | null }>()
  if (!row) return null
  const poster = { id, district: row.district, wall: row.wall, text: row.text, when: row.at_when }
  return { owner: row.owner, evidence: JSON.stringify({ poster }) }
}

/**
 * Hides poster `id` once `POSTER_HIDE.reporters` distinct reporters that count (see `POSTER_HIDE`) have open
 * reports on it. True only for the call that hid it; every district is then told, through `later`.
 */
export async function posterAutoHide(
  env: Env,
  id: string,
  owner: string,
  now: number,
  later: Later,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT r.reporter) AS n FROM reports r JOIN users u ON u.id = r.reporter
     WHERE r.poster_id = ?1 AND r.state = 'open' AND r.target_kind = 'poster'
       AND u.verified = 1 AND u.banned = 0 AND u.created_at <= ?2
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.a = ?3 AND b.b = r.reporter)`,
  )
    .bind(id, now - POSTER_HIDE.accountAge, owner)
    .first<{ n: number }>()
  if ((row?.n ?? 0) < POSTER_HIDE.reporters) return false
  const { results } = await env.DB.prepare(
    'UPDATE posters SET hidden = 1 WHERE id = ? AND hidden = 0 RETURNING id, district',
  )
    .bind(id)
    .all<Placed>()
  if (!results.length) return false
  later(tellRemoved(env, results))
  return true
}

/** Who owns poster `id`, if it is still up anywhere (for blocking from a poster). */
export async function posterOwner(env: Env, id: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT owner FROM posters WHERE id = ?')
    .bind(id)
    .first<{ owner: string }>()
  return row?.owner ?? null
}

/** The cron's sweep: expired posters are deleted (found by `posters_expires`), and their districts told. */
export async function purgePosters(env: Env, now = Date.now()): Promise<void> {
  const { results } = await env.DB.prepare('DELETE FROM posters WHERE expires_at <= ? RETURNING id, district')
    .bind(now)
    .all<Placed>()
  if (results.length) await tellRemoved(env, results)
}
