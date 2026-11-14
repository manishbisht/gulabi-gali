import { benchDistrict, type BenchWitness } from './district'
import type { Env } from './env'
import { chatEvidence, HOLD_MS } from './evidence'
import { wordsOk } from './filter/server'
import { floating, type Later } from './inbox'
import { allow, DAY_MS, rateLimited } from './limits'
import { activeRow, cleanText, toPublic, type ProfileRow } from './profiles'
import {
  MAX_REPORT_NOTE,
  REPORT_KINDS,
  REPORT_REASONS,
  type AvatarLookWire,
  type ReportKind,
  type ReportReason,
  type ReportResult,
} from './protocol'
import { refreshUser } from './refresh'
import { pairOf } from './requests'

/** Stored evidence is at most this many bytes of JSON: the oldest lines or messages go first to fit. */
export const EVIDENCE_MAX_BYTES = 64 * 1024
/** A report's evidence is kept this long (or until the report is closed), then the cron clears it. */
export const REPORT_KEEP_MS = 30 * 24 * 3600 * 1000
/** Reports one account may file in a day. */
export const REPORTS_PER_DAY = 20
/**
 * Auto-hide: this many distinct verified reporters about one person, in open reports filed within `windowMs`,
 * take that person off the map until an admin acts. Residents' reports never count, so fresh accounts made
 * to retaliate can hide nobody.
 */
export const AUTO_HIDE = { reporters: 3, windowMs: 7 * DAY_MS } as const

const MAX_ID = 200
const fail = (error: string, status: number, extra?: Record<string, unknown>) =>
  Response.json({ error, ...extra }, { status })

interface Parsed {
  kind: ReportKind
  targetId: string
  bench: string | null
  reason: ReportReason
  note: string
}

/** The report as asked for, or null for anything malformed. Only these fields are read: never evidence. */
function parse(raw: unknown): Parsed | null {
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const { kind, targetId, reason } = b
  if (!REPORT_KINDS.includes(kind as never) || !REPORT_REASONS.includes(reason as never)) return null
  if (typeof targetId !== 'string' || !targetId || targetId.length > MAX_ID) return null
  const note = cleanText(b.note, MAX_REPORT_NOTE)
  if (note === null) return null
  let bench: string | null = null
  if (kind === 'bench') {
    if (typeof b.bench !== 'string' || !benchDistrict(b.bench)) return null
    bench = b.bench
  }
  return { kind: kind as ReportKind, targetId, bench, reason: reason as ReportReason, note }
}

/**
 * `evidence` as stored: JSON of at most `EVIDENCE_MAX_BYTES`, made to fit by dropping the oldest entries of
 * its `list` (lines or messages, oldest first).
 */
export function fitEvidence(evidence: Record<string, unknown>, list: string): string {
  const encoder = new TextEncoder()
  const bytes = (x: unknown) => encoder.encode(JSON.stringify(x)).byteLength
  const items = evidence[list] as unknown[]
  let size = bytes(evidence)
  let drop = 0
  // Each entry dropped takes its own bytes and one comma with it.
  while (size > EVIDENCE_MAX_BYTES && drop < items.length) size -= bytes(items[drop++]) + 1
  return JSON.stringify({ ...evidence, [list]: items.slice(drop) })
}

/**
 * What a person report carries: the profile as it is now, never the link. The public face (first name, look,
 * status) plus home area and about.
 */
async function personEvidence(env: Env, id: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(id).first<ProfileRow>()
  if (!row) return null
  const face = toPublic({
    id: row.user_id,
    name: row.name,
    look: JSON.parse(row.look) as AvatarLookWire,
    status: row.status,
  })
  return JSON.stringify({ profile: { ...face, homeArea: row.home_area, about: row.about } })
}

/** What a report will carry, or why it cannot be filed (404 with that `error`). */
type Gathered =
  | {
      evidence: string
      /** The person's presence rests on the reporter's word: never counted toward auto-hide. */
      unconfirmed?: boolean
      /** There was nothing to carry (a bench transcript the district no longer holds). */
      missing?: boolean
    }
  | { error: 'not-found' | 'not-there' }

const found = (evidence: string | null): Gathered =>
  evidence === null ? { error: 'not-found' } : { evidence }

/**
 * What a bench report carries: the bench's last 10 minutes, from the district that keeps them in memory.
 *
 * The reporter must sit there now or have sat there in those 10 minutes (else `not-there`). A district that
 * slept since has lost who sat and what was said, but not its seats: then only someone seated now can report.
 * The person reported must have been there too: a district that has been up for the whole 10 minutes
 * (`remembers`) and has no sign of them answers `not-found`; one that has not cannot say, so the report is
 * filed on the reporter's word, `unconfirmed`. A district that cannot be reached is the same, and never a
 * 500. With no lines to carry the evidence says so (`transcript-unavailable`), and the reporter is told.
 */
async function benchEvidence(env: Env, reporter: string, target: string, bench: string): Promise<Gathered> {
  let witness: BenchWitness | null = null
  try {
    const district = env.DISTRICT.get(env.DISTRICT.idFromName(benchDistrict(bench)!))
    witness = await district.benchWitness(bench, reporter, target)
  } catch (err) {
    console.error('report: bench district unreachable', bench, err)
  }
  if (witness && !witness.reporter) return { error: 'not-there' }
  if (witness && !witness.target && witness.remembers) return { error: 'not-found' }
  const unconfirmed = !witness?.target
  const lines = witness?.lines ?? []
  if (!lines.length)
    return {
      evidence: JSON.stringify({ bench, lines: [], note: 'transcript-unavailable' }),
      unconfirmed,
      missing: true,
    }
  return { evidence: fitEvidence({ bench, lines }, 'lines'), unconfirmed }
}

/**
 * What a chat report carries: the last 30 messages of the reporter's match with `target`, while it lasts, or
 * as held when it ended, for 30 days (see `chatEvidence`).
 */
async function chatWith(env: Env, reporter: string, target: string, now: number): Promise<string | null> {
  const [a, b] = pairOf(reporter, target)
  const current = await env.DB.prepare('SELECT id FROM matches WHERE a = ? AND b = ?')
    .bind(a, b)
    .first<{ id: string }>()
  const matchId =
    current?.id ??
    (
      await env.DB.prepare(
        `SELECT match_id FROM held_evidence
         WHERE ((owner = ?1 AND other = ?2) OR (owner = ?2 AND other = ?1)) AND created_at > ?3
         ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(reporter, target, now - HOLD_MS)
        .first<{ match_id: string }>()
    )?.match_id
  if (!matchId) return null
  const evidence = await chatEvidence(env, reporter, matchId, now)
  if (!evidence || evidence.other !== target) return null
  return fitEvidence({ matchId, messages: evidence.messages }, 'messages')
}

/**
 * The reports auto-hide counts, as a `WHERE` over `reports`: about the person `?1`, filed after `?2` (ms), open,
 * confirmed, by a reporter who is verified and not banned. An admin's unhide dismisses exactly these, so the
 * person stays visible until `AUTO_HIDE.reporters` new ones act.
 */
export const COUNTED_REPORTS = `target_kind IN ('person', 'bench', 'chat') AND target_id = ?1 AND created_at > ?2
  AND state = 'open' AND unconfirmed = 0
  AND reporter IN (SELECT id FROM users WHERE verified = 1 AND banned = 0)`

/**
 * Whether `target` now has `AUTO_HIDE.reporters` distinct verified (and not banned) reporters in open,
 * confirmed reports from the last `AUTO_HIDE.windowMs`; when so they are hidden. True only when this call hid
 * them (they were not hidden already); every live district is then told, through `later`.
 */
async function autoHide(env: Env, target: string, now: number, later: Later): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT reporter) AS n FROM reports WHERE ${COUNTED_REPORTS}`,
  )
    .bind(target, now - AUTO_HIDE.windowMs)
    .first<{ n: number }>()
  if ((row?.n ?? 0) < AUTO_HIDE.reporters) return false
  const { meta } = await env.DB.prepare('UPDATE users SET hidden = 1 WHERE id = ? AND hidden = 0')
    .bind(target)
    .run()
  if (!meta.changes) return false
  later(refreshUser(env, target, 'hide'))
  return true
}

/**
 * `POST /api/reports {kind, targetId, bench?, reason, note?}`: 201 `{ autoHidden, evidence? }`. The reporter
 * must be a resident (403 `ghost`) and may not report themself (400 `invalid`); a note is word-filtered (400
 * `words`, field `note`). The evidence is the server's own (see `personEvidence`, `benchEvidence`,
 * `chatWith`), never anything the client sent. With none to carry it is 404: `not-there` for a bench the
 * reporter was not at, `not-found` for the rest (no such person, a chat you are not in); nothing is filed.
 * `evidence: 'missing'` says a bench report was filed without its transcript. Only a filed report uses one of
 * the day's 20 (429 `rate`). After the insert, a verified reporter's report may auto-hide the person (see
 * `autoHide`); `autoHidden` is true only for the report that did.
 */
export async function fileReport(
  env: Env,
  userId: string,
  raw: unknown,
  later: Later = floating,
  now = Date.now(),
): Promise<Response> {
  if (!(await activeRow(env, userId))) return fail('ghost', 403)
  const report = parse(raw)
  if (!report || report.targetId === userId) return fail('invalid', 400)
  if (!wordsOk(report.note, 'note')) return fail('words', 400, { field: 'note' })
  const { kind, targetId, bench, reason, note } = report
  const gathered =
    kind === 'person'
      ? found(await personEvidence(env, targetId))
      : kind === 'bench'
        ? await benchEvidence(env, userId, targetId, bench!)
        : found(await chatWith(env, userId, targetId, now))
  if ('error' in gathered) return fail(gathered.error, 404)
  if (!(await allow(env, userId, 'report', REPORTS_PER_DAY, DAY_MS, now))) return rateLimited(DAY_MS, now)
  await env.DB.prepare(
    `INSERT INTO reports (id, reporter, target_kind, target_id, reason, note, evidence, created_at, state, unconfirmed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      kind,
      targetId,
      reason,
      note,
      gathered.evidence,
      now,
      gathered.unconfirmed ? 1 : 0,
    )
    .run()
  const reporter = await env.DB.prepare('SELECT verified FROM users WHERE id = ?')
    .bind(userId)
    .first<{ verified: number }>()
  const autoHidden =
    reporter?.verified === 1 && !gathered.unconfirmed && (await autoHide(env, targetId, now, later))
  const out: ReportResult = { autoHidden, ...(gathered.missing ? { evidence: 'missing' as const } : {}) }
  return Response.json(out, { status: 201 })
}

/**
 * The cron's two sweeps, each found by its own partial index over the reports still holding evidence
 * (`reports_closed_evidence`, `reports_evidence_age`), never a scan of every report. The second takes the
 * cutoff: 30 days ago.
 */
export const PURGE_STATEMENTS = [
  `UPDATE reports SET evidence = NULL WHERE evidence IS NOT NULL AND state IN ('actioned', 'dismissed')`,
  'UPDATE reports SET evidence = NULL WHERE evidence IS NOT NULL AND created_at <= ?',
] as const

/** The cron's sweep: evidence goes from closed reports, and from any filed 30 days ago. The reports stay. */
export async function purgeReportEvidence(env: Env, now = Date.now()): Promise<void> {
  const [closed, aged] = PURGE_STATEMENTS
  await env.DB.batch([env.DB.prepare(closed), env.DB.prepare(aged).bind(now - REPORT_KEEP_MS)])
}
