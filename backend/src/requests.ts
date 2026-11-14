import type { Env } from './env'
import { loadResident, residentRow } from './profiles'
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
const pairOf = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x])

/**
 * Accepts request `id` (which must be pending) in one batch: the state flips and the match is inserted
 * together, `INSERT OR IGNORE` on (a, b), so two accepts at once still leave one match. Answers the match id.
 */
async function accept(env: Env, id: string, from: string, to: string, now: number): Promise<string> {
  const [a, b] = pairOf(from, to)
  await env.DB.batch([
    env.DB.prepare("UPDATE requests SET state = 'accepted' WHERE id = ? AND state = 'pending'").bind(id),
    env.DB.prepare(
      `INSERT OR IGNORE INTO matches (id, a, b, created_at)
       SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM requests WHERE id = ? AND state = 'accepted')`,
    ).bind(crypto.randomUUID(), a, b, now, id),
  ])
  const match = await env.DB.prepare('SELECT id FROM matches WHERE a = ? AND b = ?')
    .bind(a, b)
    .first<{ id: string }>()
  return match!.id
}

export async function sendRequest(
  env: Env,
  userId: string,
  raw: unknown,
  now = Date.now(),
): Promise<Response> {
  const me = await residentRow(env, userId)
  if (!me) return fail('ghost', 403)
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const reason = cleanReason(body.reason)
  if (reason === null) return fail('invalid', 400)
  const to = body.to
  if (typeof to !== 'string' || to.length > 200) return fail('no-such-person', 404)
  if (to === userId) return fail('invalid', 400)
  const them = await residentRow(env, to)
  if (!them) return fail('no-such-person', 404)

  const [a, b] = pairOf(userId, to)
  const matched = await env.DB.prepare('SELECT id FROM matches WHERE a = ? AND b = ?').bind(a, b).first()
  if (matched) return fail('already', 409)

  const cutoff = now - REQUEST_TTL_MS
  // They already asked you: that is a yes, not a second request.
  const crossed = await env.DB.prepare(
    "SELECT id FROM requests WHERE from_id = ? AND to_id = ? AND state = 'pending' AND created_at > ?",
  )
    .bind(to, userId, cutoff)
    .first<{ id: string }>()
  if (crossed) return Response.json({ matched: await accept(env, crossed.id, to, userId, now) })

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
  return Response.json({ id }, { status: 201 })
}

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
      "SELECT * FROM requests WHERE to_id = ? AND state = 'pending' AND created_at > ? ORDER BY created_at DESC LIMIT ?",
    )
      .bind(userId, cutoff, LIST_LIMIT)
      .all<RequestRow>(),
    env.DB.prepare(
      "SELECT * FROM requests WHERE from_id = ? AND (state = 'accepted' OR created_at > ?) ORDER BY created_at DESC LIMIT ?",
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
): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM requests WHERE id = ? AND to_id = ? AND state = 'pending'")
    .bind(id, userId)
    .first<RequestRow>()
  if (!row) return fail('not-found', 404)
  if (row.created_at <= now - REQUEST_TTL_MS) return fail('expired', 410)
  // Both people must still be residents: a ban or a half-deleted profile ends it.
  if (!(await residentRow(env, row.from_id)) || !(await residentRow(env, userId)))
    return fail('not-found', 404)
  return Response.json({ matchId: await accept(env, id, row.from_id, userId, now) })
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
