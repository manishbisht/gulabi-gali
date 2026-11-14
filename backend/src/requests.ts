import type { Env } from './env'
import { wordsOk } from './filter/server'
import { floating, notify, type Later } from './inbox'
import { isVerified } from './trust'
import { isBlocked, loadResident, publicOf, visibleRow, type ProfileRow } from './profiles'
import { MAX_REASON, MIN_REASON, REQUEST_TTL_MS, type RequestLists, type RequestView } from './protocol'

/** The most requests either list returns: enough for a busy inbox, never an unbounded read. */
const LIST_LIMIT = 50

const fail = (error: string, status: number) => Response.json({ error }, { status })

/** NFC, no control or format characters, one line (any run of whitespace is one space); null if not 10-140. */
export function cleanReason(x: unknown): string | null {
  if (typeof x !== 'string') return null
  const text = x
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const points = [...text].length
  return points >= MIN_REASON && points <= MAX_REASON ? text : null
}

/** The two ids in the order a match stores them (`a < b`). */
export const pairOf = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x])

/**
 * Accepts the pending, unexpired requests `ids` between two people in one batch: the states flip and the match is
 * inserted together, `INSERT OR IGNORE` on (a, b), so accepts at once still leave one match. Answers the match id,
 * or null when nothing could be accepted (the cron swept the row, or it expired, since it was read).
 */
export async function accept(
  env: Env,
  ids: string[],
  from: string,
  to: string,
  now: number,
): Promise<string | null> {
  const [a, b] = pairOf(from, to)
  const cutoff = now - REQUEST_TTL_MS
  await env.DB.batch([
    ...ids.map((id) =>
      env.DB.prepare(
        "UPDATE requests SET state = 'accepted' WHERE id = ? AND state = 'pending' AND created_at > ?",
      ).bind(id, cutoff),
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO matches (id, a, b, created_at)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM requests WHERE id IN (${ids.map(() => '?').join(', ')}) AND state = 'accepted')
         AND NOT EXISTS (SELECT 1 FROM blocks WHERE (a = ? AND b = ?) OR (a = ? AND b = ?))`,
    ).bind(crypto.randomUUID(), a, b, now, ...ids, a, b, b, a),
  ])
  const match = await env.DB.prepare('SELECT id FROM matches WHERE a = ? AND b = ?')
    .bind(a, b)
    .first<{ id: string }>()
  return match?.id ?? null
}

/** Both people of a match made by crossed requests: each asked, so each hears `accepted` about the other. */
const tellBoth = (env: Env, matchId: string, x: ProfileRow, y: ProfileRow) =>
  Promise.all([
    notify(env, x.user_id, { t: 'accepted', matchId, person: publicOf(y) }),
    notify(env, y.user_id, { t: 'accepted', matchId, person: publicOf(x) }),
  ])

/** A live (unexpired) pending request from `from` to `to`, if there is one. */
const pendingBetween = (env: Env, from: string, to: string, cutoff: number) =>
  env.DB.prepare(
    "SELECT id FROM requests WHERE from_id = ? AND to_id = ? AND state = 'pending' AND created_at > ?",
  )
    .bind(from, to, cutoff)
    .first<{ id: string }>()

/** `later` runs the inbox notices after the response (`ctx.waitUntil`); they can never fail the request. */
export async function sendRequest(
  env: Env,
  userId: string,
  raw: unknown,
  now = Date.now(),
  later: Later = floating,
): Promise<Response> {
  // A new request reaches someone new: only someone others may see can send one (a hidden person cannot).
  const me = await visibleRow(env, userId)
  if (!me) return fail('ghost', 403)
  // Residents can be asked and can answer; reaching out first is for the verified.
  if (!(await isVerified(env, userId))) return fail('not-verified', 403)
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const reason = cleanReason(body.reason)
  if (reason === null) return fail('invalid', 400)
  if (!wordsOk(reason)) return Response.json({ error: 'words', field: 'reason' }, { status: 400 })
  const to = body.to
  if (typeof to !== 'string' || to.length > 200) return fail('no-such-person', 404)
  if (to === userId) return fail('invalid', 400)
  const them = await visibleRow(env, to)
  if (!them || (await isBlocked(env, userId, to))) return fail('no-such-person', 404)

  const [a, b] = pairOf(userId, to)
  const matched = await env.DB.prepare('SELECT id FROM matches WHERE a = ? AND b = ?').bind(a, b).first()
  if (matched) return fail('already', 409)

  const cutoff = now - REQUEST_TTL_MS
  // They already asked you: that is a yes, not a second request.
  const crossed = await pendingBetween(env, to, userId, cutoff)
  if (crossed) {
    const matchId = await accept(env, [crossed.id], to, userId, now)
    // Swept or expired since it was read: it is no longer a yes, so this is an ordinary request.
    if (matchId) {
      later(tellBoth(env, matchId, me, them))
      return Response.json({ matched: matchId })
    }
  }

  // Pending or declined (the sender is never told which) and still alive: one ask per pair.
  const dup = await env.DB.prepare(
    "SELECT 1 AS x FROM requests WHERE from_id = ? AND to_id = ? AND state IN ('pending', 'ignored') AND created_at > ?",
  )
    .bind(userId, to, cutoff)
    .first()
  if (dup) return fail('already', 409)
  if (them.pause_requests === 1) return fail('paused', 409)

  const id = crypto.randomUUID()
  try {
    await env.DB.batch([
      // A stale pending row would hold the unique index until the cron comes by.
      env.DB.prepare(
        "DELETE FROM requests WHERE from_id = ? AND to_id = ? AND state != 'accepted' AND created_at <= ?",
      ).bind(userId, to, cutoff),
      env.DB.prepare(
        "INSERT INTO requests (id, from_id, to_id, reason, created_at, state) VALUES (?, ?, ?, ?, ?, 'pending')",
      ).bind(id, userId, to, reason, now),
    ])
  } catch {
    // Lost a race with the same ask: the unique index let only one through.
    return fail('already', 409)
  }
  // Both asked at the same moment: each insert missed the other's. Whoever looks again now finds it.
  const reverse = await pendingBetween(env, to, userId, cutoff)
  if (reverse) {
    const matchId = await accept(env, [reverse.id, id], to, userId, now)
    if (matchId) {
      later(tellBoth(env, matchId, me, them))
      return Response.json({ matched: matchId })
    }
  }
  later(notify(env, to, { t: 'request', id }))
  return Response.json({ id }, { status: 201 })
}

/** A clause: the row's other person (`col`) is not blocked by, or blocking, the asker (`?1`). Normally no row survives a block; this covers a race. */
const unblocked = (col: string) =>
  `NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.a = ?1 AND k.b = ${col}) OR (k.b = ?1 AND k.a = ${col}))`

interface RequestRow {
  id: string
  from_id: string
  to_id: string
  reason: string
  created_at: number
  state: 'pending' | 'accepted' | 'ignored'
}

async function views(
  env: Env,
  rows: RequestRow[],
  other: 'from_id' | 'to_id',
  shown: (r: RequestRow) => 'pending' | 'accepted',
): Promise<RequestView[]> {
  const people = await Promise.all(rows.map((r) => loadResident(env, r[other])))
  const out: RequestView[] = []
  rows.forEach((r, i) => {
    const person = people[i]
    if (person) out.push({ id: r.id, person, reason: r.reason, createdAt: r.created_at, state: shown(r) })
  })
  return out
}

export async function listRequests(env: Env, userId: string, now = Date.now()): Promise<RequestLists> {
  const cutoff = now - REQUEST_TTL_MS
  const [incoming, sent] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM requests WHERE to_id = ?1 AND state = 'pending' AND created_at > ?2 AND ${unblocked('from_id')}
       ORDER BY created_at DESC LIMIT ?3`,
    )
      .bind(userId, cutoff, LIST_LIMIT)
      .all<RequestRow>(),
    // An unmatch's block (an empty reason, see `unmatch`) is no request its sender made: never listed.
    env.DB.prepare(
      `SELECT * FROM requests WHERE from_id = ?1 AND reason != '' AND (state = 'accepted' OR created_at > ?2)
       AND ${unblocked('to_id')} ORDER BY created_at DESC LIMIT ?3`,
    )
      .bind(userId, cutoff, LIST_LIMIT)
      .all<RequestRow>(),
  ])
  return {
    incoming: await views(env, incoming.results, 'from_id', () => 'pending'),
    // A decline is never revealed: an ignored request reads as pending until it expires.
    sent: await views(env, sent.results, 'to_id', (r) => (r.state === 'accepted' ? 'accepted' : 'pending')),
  }
}

export async function acceptRequest(
  env: Env,
  userId: string,
  id: string,
  now = Date.now(),
  later: Later = floating,
): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM requests WHERE id = ? AND to_id = ? AND state = 'pending'")
    .bind(id, userId)
    .first<RequestRow>()
  if (!row) return fail('not-found', 404)
  if (row.created_at <= now - REQUEST_TTL_MS) return fail('expired', 410)
  // Both people must still be residents others may see: a ban, a hide or a half-deleted profile ends it, since a
  // new match with a hidden person would be one the other side could not see.
  const me = await visibleRow(env, userId)
  if (!me || !(await visibleRow(env, row.from_id)) || (await isBlocked(env, userId, row.from_id)))
    return fail('not-found', 404)
  const matchId = await accept(env, [id], row.from_id, userId, now)
  // The row went (the cron) or aged out between the read and the write.
  if (!matchId) return fail('expired', 410)
  // Only the one who asked is told: the one accepting is right here.
  later(notify(env, row.from_id, { t: 'accepted', matchId, person: publicOf(me) }))
  return Response.json({ matchId })
}

export async function ignoreRequest(env: Env, userId: string, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT 1 AS x FROM requests WHERE id = ? AND to_id = ?')
    .bind(id, userId)
    .first()
  if (!row) return fail('not-found', 404)
  await env.DB.prepare(
    "UPDATE requests SET state = 'ignored' WHERE id = ? AND to_id = ? AND state = 'pending'",
  )
    .bind(id, userId)
    .run()
  return new Response(null, { status: 204 })
}

/** The cron's sweep: a request nobody answered in 14 days goes (accepted ones stay: they are matches' history). */
export async function expireRequests(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare("DELETE FROM requests WHERE state != 'accepted' AND created_at <= ?")
    .bind(now - REQUEST_TTL_MS)
    .run()
}
