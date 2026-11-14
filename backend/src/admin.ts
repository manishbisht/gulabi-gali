import { DISTRICT_IDS } from './district'
import type { Env } from './env'
import { GATE_NAME } from './gate'
import { floating, type Later } from './inbox'
import { firstName } from './names'
import type {
  AdminEvidence,
  AdminHidden,
  AdminLine,
  AdminReport,
  AdminReportClosed,
  AdminReportPage,
  AdminStats,
  AdminUser,
  ReportKind,
  ReportReason,
  ReportState,
} from './protocol'
import { refreshUser } from './refresh'
import { markVerified } from './trust'

/** Reports per page of the queue. */
export const PAGE_SIZE = 20
/** How long a mute lasts. */
export const MUTE_MS = 24 * 3600_000
/** At most this many hidden people are listed, newest accounts first, each with their latest reports. */
const HIDDEN_LIMIT = 50
const HIDDEN_REPORTS = 20
const SEARCH_LIMIT = 20
const MAX_QUERY = 100
const STATES: readonly ReportState[] = ['open', 'actioned', 'dismissed']
/** Report kinds whose `target_id` is a person (a poster's is the poster). */
const PERSON_KINDS = "('person', 'bench', 'chat')"

/** The one answer anyone who is not an admin ever gets, the same as for a route that does not exist. */
const notFound = () => Response.json({ error: 'not found' }, { status: 404 })
const invalid = () => Response.json({ error: 'invalid' }, { status: 400 })

/**
 * Whether `userId` is in `ADMIN_USER_IDS` (whole ids, comma-separated). Unset or empty: nobody is. A `dev:` id
 * counts only while `DEV_AUTH` is exactly `1`: a dev id copied into production by mistake makes nobody an
 * admin (and dev tokens are refused there anyway).
 */
export function isAdmin(env: Pick<Env, 'ADMIN_USER_IDS' | 'DEV_AUTH'>, userId: string): boolean {
  if (userId.startsWith('dev:') && env.DEV_AUTH !== '1') return false
  return (env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .some((id) => id !== '' && id === userId)
}

/**
 * Every `/api/admin/*` route. Anyone not in `ADMIN_USER_IDS`, signed in or not, gets the plain 404 a signed-in
 * caller gets for an unknown route (never a 403), decided from the token alone, before anything else of the
 * request is read. (Signed out, an unknown route is a 401 while these are 404: that much is visible, by choice.)
 * No admin route reads a body. `DELETE /api/admin/posters/:id` is a 404 for everyone until posters exist
 * (phase 4).
 */
export async function handleAdmin(
  request: Request,
  env: Env,
  url: URL,
  user: { id: string } | null,
  later: Later = floating,
): Promise<Response> {
  if (!user || !isAdmin(env, user.id)) return notFound()
  const { method } = request
  const { pathname, searchParams } = url
  if (method === 'GET') {
    if (pathname === '/api/admin/reports') return listReports(env, searchParams)
    if (pathname === '/api/admin/users') return searchUsers(env, searchParams.get('q'))
    if (pathname === '/api/admin/hidden') return listHidden(env)
    if (pathname === '/api/admin/stats') return stats(env)
    if (pathname === '/api/admin/waitlist.csv') return waitlistCsv(env)
    const vouched = pathname.match(/^\/api\/admin\/users\/([^/]+)\/verified$/)
    if (vouched) return listVouched(env, decode(vouched[1]!))
  }
  if (method !== 'POST') return notFound()
  const report = pathname.match(/^\/api\/admin\/reports\/([^/]+)\/(dismiss|action)$/)
  if (report) return closeReport(env, decode(report[1]!), report[2] === 'action' ? 'actioned' : 'dismissed')
  const act = pathname.match(/^\/api\/admin\/users\/([^/]+)\/(ban|unban|mute|unmute|verify|unverify|unhide)$/)
  if (act) return actOn(env, decode(act[1]!), act[2] as UserAction, later)
  return notFound()
}

/** A path segment, decoded; a malformed one becomes an id nothing has. */
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return ''
  }
}

interface UserRow {
  id: string
  created_at: number
  verified: number
  verified_by: string | null
  banned: number
  hidden: number
  muted_until: number | null
  name: string | null
  status: string | null
  home_area: string | null
  about: string | null
  open_reports: number
}

/** Someone with no account row: a deleted reporter, or an id nothing has. */
const unknownUser = (id: string): AdminUser => ({
  id,
  createdAt: null,
  verified: false,
  verifiedBy: null,
  banned: false,
  hidden: false,
  mutedUntil: null,
  openReports: 0,
  profile: null,
})

/** The people named by `ids`, as the moderator sees them, in one query. Every id is in the answer. */
async function loadUsers(env: Env, ids: readonly string[]): Promise<Map<string, AdminUser>> {
  const unique = [...new Set(ids)]
  const out = new Map<string, AdminUser>()
  if (!unique.length) return out
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.created_at, u.verified, u.verified_by, u.banned, u.hidden, u.muted_until,
       p.name, p.status, p.home_area, p.about,
       (SELECT COUNT(*) FROM reports r
        WHERE r.target_kind IN ${PERSON_KINDS} AND r.target_id = u.id AND r.state = 'open') AS open_reports
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id IN (SELECT value FROM json_each(?1))`,
  )
    .bind(JSON.stringify(unique))
    .all<UserRow>()
  for (const r of results)
    out.set(r.id, {
      id: r.id,
      createdAt: r.created_at,
      verified: r.verified === 1,
      verifiedBy: r.verified_by,
      banned: r.banned === 1,
      hidden: r.hidden === 1,
      mutedUntil: r.muted_until,
      openReports: r.open_reports,
      profile:
        r.name === null
          ? null
          : { name: r.name, status: r.status ?? '', homeArea: r.home_area ?? '', about: r.about ?? '' },
    })
  for (const id of unique) if (!out.has(id)) out.set(id, unknownUser(id))
  return out
}

interface ReportRow {
  id: string
  reporter: string
  target_kind: ReportKind | 'poster'
  target_id: string
  reason: ReportReason
  note: string
  evidence: string | null
  created_at: number
  state: ReportState
  closed_at: number | null
  unconfirmed: number
}

/** The cursor after `row`: opaque to the client, `[created_at, id]` to us. */
function cursorOf(row: ReportRow): string {
  const bytes = new TextEncoder().encode(JSON.stringify([row.created_at, row.id]))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function parseCursor(raw: string): [number, string] | null {
  try {
    const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))))
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      Number.isFinite(value[0]) &&
      typeof value[1] === 'string'
    )
      return value as [number, string]
  } catch {
    // Not one of ours.
  }
  return null
}

const str = (x: unknown) => (typeof x === 'string' ? x : '')
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

/**
 * A report's stored evidence as the console shows it (see `AdminEvidence`). Chat messages carry only the
 * sender's id, so the name is looked up: the first name of whoever it is now, or the id itself when they have
 * no profile. Null for none (cleared by the cron), or for anything that does not parse.
 */
function evidenceOf(raw: string | null, users: Map<string, AdminUser>): AdminEvidence | null {
  if (raw === null) return null
  let e: Record<string, unknown>
  try {
    e = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof e.profile === 'object' && e.profile !== null) {
    const p = e.profile as Record<string, unknown>
    return {
      kind: 'profile',
      name: str(p.name),
      status: str(p.status),
      homeArea: str(p.homeArea),
      about: str(p.about),
    }
  }
  const line = (from: unknown, name: string, text: unknown, at: unknown): AdminLine => ({
    from: str(from),
    name,
    text: str(text),
    at: num(at),
  })
  if (Array.isArray(e.lines))
    return {
      kind: 'lines',
      place: 'bench',
      missing: e.note === 'transcript-unavailable',
      lines: (e.lines as Record<string, unknown>[]).map((l) => line(l.from, str(l.name), l.text, l.at)),
    }
  if (Array.isArray(e.messages))
    return {
      kind: 'lines',
      place: 'chat',
      missing: false,
      lines: (e.messages as Record<string, unknown>[]).map((m) => {
        const profile = users.get(str(m.from))?.profile
        return line(m.from, profile ? firstName(profile.name) : str(m.from), m.body, m.at)
      }),
    }
  return null
}

/**
 * `GET /api/admin/reports?state=open&cursor=`: `PAGE_SIZE` at a time, by `(created_at, id)`. The open queue
 * runs oldest first, so nothing waits forever; closed lists run newest first. 400 for a state or cursor that
 * is not one.
 */
async function listReports(env: Env, params: URLSearchParams): Promise<Response> {
  const state = (params.get('state') || 'open') as ReportState
  if (!STATES.includes(state)) return invalid()
  const raw = params.get('cursor')
  const after = raw ? parseCursor(raw) : null
  if (raw && !after) return invalid()
  const [cmp, order] = state === 'open' ? ['>', 'ASC'] : ['<', 'DESC']
  const { results } = await env.DB.prepare(
    `SELECT * FROM reports WHERE state = ?1 ${after ? `AND (created_at, id) ${cmp} (?3, ?4)` : ''}
     ORDER BY created_at ${order}, id ${order} LIMIT ?2`,
  )
    .bind(state, PAGE_SIZE + 1, ...(after ?? []))
    .all<ReportRow>()
  const rows = results.slice(0, PAGE_SIZE)
  const users = await loadUsers(
    env,
    rows.flatMap((r) => [r.reporter, r.target_id]),
  )
  const page: AdminReportPage = {
    reports: rows.map((r): AdminReport => ({
      id: r.id,
      kind: r.target_kind,
      reason: r.reason,
      note: r.note,
      createdAt: r.created_at,
      state: r.state,
      closedAt: r.closed_at,
      unconfirmed: r.unconfirmed === 1,
      reporter: users.get(r.reporter)!,
      target: users.get(r.target_id)!,
      evidence: evidenceOf(r.evidence, users),
    })),
    next: results.length > PAGE_SIZE ? cursorOf(rows.at(-1)!) : null,
  }
  return Response.json(page)
}

/**
 * `POST /api/admin/reports/:id/{dismiss|action}`: closes an open report (the cron then clears its evidence).
 * Closing one already closed changes nothing and answers how it stands: a double tap, or the other button
 * after, is a 200. Actioning bans or mutes nobody: that is its own call.
 */
async function closeReport(env: Env, id: string, state: 'actioned' | 'dismissed'): Promise<Response> {
  await env.DB.prepare("UPDATE reports SET state = ?, closed_at = ? WHERE id = ? AND state = 'open'")
    .bind(state, Date.now(), id)
    .run()
  const row = await env.DB.prepare('SELECT id, state, closed_at FROM reports WHERE id = ?')
    .bind(id)
    .first<{ id: string; state: ReportState; closed_at: number | null }>()
  if (!row) return notFound()
  const out: AdminReportClosed = { id: row.id, state: row.state, closedAt: row.closed_at }
  return Response.json(out)
}

type UserAction = 'ban' | 'unban' | 'mute' | 'unmute' | 'verify' | 'unverify' | 'unhide'

/**
 * `POST /api/admin/users/:id/{action}`: 200 with the person as they now are, or 404 for an id with no
 * account (but see `ban`). Every action is idempotent: a repeat finds the state already set and answers it.
 *
 * - `ban`: off the map and out of every list (`ACTIVE`), their district and inbox sockets closed before this
 *   answers, and `/api/me` says `banned`. Their unused invite codes are deleted (a code is their word for
 *   someone). `unban` restores the rest. An id whose account was deleted, but that a report, held chat or
 *   block still names, gets a tombstone row that is banned, so signing in again with it is refused.
 * - `unverify`: back to a resident (`verified_by` cleared), and their unused codes deleted.
 * - `mute`: no writes for `MUTE_MS` (see `muteGate`); a repeat while muted keeps the end it has. `unmute`.
 * - `verify`: verified by `admin`, with their 2 codes.
 * - `unhide`: back on the map, with `unhidden_at` set: auto-hide then counts only reports filed after it (see
 *   `COUNTED_REPORTS`), so they stay visible until `AUTO_HIDE.reporters` new reports act. Every report stays
 *   open in the queue, evidence and all: unhiding is not a verdict on them.
 */
async function actOn(env: Env, id: string, action: UserAction, later: Later): Promise<Response> {
  const now = Date.now()
  const exists = await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(id).first()
  if (!exists) {
    if (action !== 'ban' || !(await named(env, id))) return notFound()
    await env.DB.prepare('INSERT OR IGNORE INTO users (id, created_at, banned) VALUES (?, ?, 1)')
      .bind(id, now)
      .run()
  }
  const set = (sql: string, ...args: unknown[]) =>
    env.DB.prepare(`UPDATE users SET ${sql} WHERE id = ?`)
      .bind(...args, id)
      .run()
  switch (action) {
    case 'ban':
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(id),
        env.DB.prepare('DELETE FROM invites WHERE owner = ? AND used_by IS NULL').bind(id),
      ])
      // Always told again: a repeat also mends a live object that missed the first.
      await refreshUser(env, id, 'ban')
      break
    case 'unban':
      await set('banned = 0')
      await refreshUser(env, id, 'ban')
      break
    case 'mute':
      await env.DB.prepare(
        'UPDATE users SET muted_until = ? WHERE id = ? AND (muted_until IS NULL OR muted_until <= ?)',
      )
        .bind(now + MUTE_MS, id, now)
        .run()
      await refreshUser(env, id, 'mute')
      break
    case 'unmute':
      await set('muted_until = NULL')
      await refreshUser(env, id, 'mute')
      break
    case 'verify':
      await markVerified(env, id, 'admin', later)
      break
    case 'unverify':
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET verified = 0, verified_by = NULL WHERE id = ?').bind(id),
        env.DB.prepare('DELETE FROM invites WHERE owner = ? AND used_by IS NULL').bind(id),
      ])
      break
    case 'unhide':
      // Only while hidden: a repeat leaves `unhidden_at` (and so what counts) as it was.
      await env.DB.prepare('UPDATE users SET hidden = 0, unhidden_at = ? WHERE id = ? AND hidden = 1')
        .bind(now, id)
        .run()
      await refreshUser(env, id, 'hide')
      break
  }
  return Response.json((await loadUsers(env, [id])).get(id))
}

/**
 * Whether a deleted account's id is still named by something a ban should hold against: a report about them,
 * a held chat, or a block either way. An id nothing names is one nobody has (a typo): a ban on it is a 404.
 */
async function named(env: Env, id: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM reports WHERE target_kind IN ${PERSON_KINDS} AND target_id = ?1)
       OR EXISTS (SELECT 1 FROM held_evidence WHERE owner = ?1)
       OR EXISTS (SELECT 1 FROM held_evidence WHERE other = ?1)
       OR EXISTS (SELECT 1 FROM blocks WHERE a = ?1)
       OR EXISTS (SELECT 1 FROM blocks WHERE b = ?1)`,
  )
    .bind(id)
    .first()
  return row !== null
}

/** How many people `GET /api/admin/users/:id/verified` lists. */
const VOUCHED_LIMIT = 100

/**
 * `GET /api/admin/users/:id/verified`: up to `VOUCHED_LIMIT` people `id` verified (their invite redeemed, so
 * `verified_by` is them), newest accounts first: a ring of accounts vouched for by one member shows here.
 */
async function listVouched(env: Env, id: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM users WHERE verified_by = ? ORDER BY created_at DESC LIMIT ?',
  )
    .bind(id, VOUCHED_LIMIT)
    .all<{ id: string }>()
  const users = await loadUsers(
    env,
    results.map((r) => r.id),
  )
  return Response.json(results.map((r) => users.get(r.id)!))
}

/**
 * `GET /api/admin/users?q=`: up to `SEARCH_LIMIT` people whose id is `q`, or whose name starts with it (any
 * case), newest accounts first. An empty `q` finds nobody.
 */
async function searchUsers(env: Env, raw: string | null): Promise<Response> {
  const q = (raw ?? '').trim().slice(0, MAX_QUERY)
  if (!q) return Response.json([])
  const prefix = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const { results } = await env.DB.prepare(
    `SELECT u.id FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     WHERE u.id = ?1 OR p.name LIKE ?2 ESCAPE '\\' ORDER BY u.created_at DESC LIMIT ?3`,
  )
    .bind(q, prefix, SEARCH_LIMIT)
    .all<{ id: string }>()
  const users = await loadUsers(
    env,
    results.map((r) => r.id),
  )
  return Response.json(results.map((r) => users.get(r.id)!))
}

/**
 * `GET /api/admin/hidden`: everyone hidden, with the latest reports about them and who filed them: account
 * age and who vouched for each reporter (`verifiedBy`), so a ring of fresh accounts hiding someone shows.
 * Never the evidence: that stays in the report card.
 */
async function listHidden(env: Env): Promise<Response> {
  const { results: hidden } = await env.DB.prepare(
    'SELECT id FROM users WHERE hidden = 1 ORDER BY created_at DESC LIMIT ?',
  )
    .bind(HIDDEN_LIMIT)
    .all<{ id: string }>()
  const ids = hidden.map((h) => h.id)
  const { results: reports } = ids.length
    ? await env.DB.prepare(
        `SELECT * FROM (
           SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.target_id ORDER BY r.created_at DESC, r.id DESC) AS n
           FROM reports r
           WHERE r.target_kind IN ${PERSON_KINDS} AND r.target_id IN (SELECT value FROM json_each(?1)))
         WHERE n <= ?2 ORDER BY created_at DESC, id DESC`,
      )
        .bind(JSON.stringify(ids), HIDDEN_REPORTS)
        .all<ReportRow>()
    : { results: [] as ReportRow[] }
  const users = await loadUsers(env, [...ids, ...reports.map((r) => r.reporter)])
  const out: AdminHidden[] = ids.map((id) => ({
    user: users.get(id)!,
    reports: reports
      .filter((r) => r.target_id === id)
      .map((r) => ({
        id: r.id,
        kind: r.target_kind,
        reason: r.reason,
        createdAt: r.created_at,
        state: r.state,
        closedAt: r.closed_at,
        unconfirmed: r.unconfirmed === 1,
        reporter: users.get(r.reporter)!,
      })),
  }))
  return Response.json(out)
}

/**
 * `GET /api/admin/stats`: each district's live sockets (null for one that could not be asked), everyone the
 * cap counts and everyone waiting for room (null when the gate could not be asked), the open reports and the
 * hidden.
 */
async function stats(env: Env): Promise<Response> {
  const [counts, gate, open, hidden] = await Promise.all([
    Promise.allSettled(DISTRICT_IDS.map((id) => env.DISTRICT.get(env.DISTRICT.idFromName(id)).counts())),
    env.GATE.get(env.GATE.idFromName(GATE_NAME))
      .stats()
      .catch((err: unknown) => {
        console.error('admin: gate stats failed', err)
        return null
      }),
    env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE state = 'open'").first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE hidden = 1').first<{ n: number }>(),
  ])
  const out: AdminStats = {
    districts: DISTRICT_IDS.map((id, i) => {
      const c = counts[i]!
      return c.status === 'fulfilled'
        ? { id, residents: c.value.residents, ghosts: c.value.ghosts }
        : { id, residents: null, ghosts: null }
    }),
    live: gate?.live ?? null,
    queue: gate?.queue ?? null,
    openReports: open?.n ?? 0,
    hidden: hidden?.n ?? 0,
  }
  return Response.json(out)
}

/**
 * One CSV cell. Quoted (inner quotes doubled) when it holds a comma, a quote or a line break. A cell that a
 * spreadsheet would run as a formula (starting `=`, `+`, `-`, `@`, a tab or a carriage return) gets a `'`
 * in front, so an email typed as `=HYPERLINK(…)` stays text.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Rows as CSV, CRLF after every row (RFC 4180). */
export const toCsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'

/** `GET /api/admin/waitlist.csv`: every email left while the city was full, oldest first. */
async function waitlistCsv(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT email, created_at FROM waitlist ORDER BY created_at, email',
  ).all<{ email: string; created_at: number | null }>()
  const rows = [
    ['email', 'joined'],
    ...results.map((r) => [r.email, r.created_at === null ? '' : new Date(r.created_at).toISOString()]),
  ]
  return new Response(toCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="waitlist.csv"',
      'cache-control': 'no-store',
    },
  })
}
