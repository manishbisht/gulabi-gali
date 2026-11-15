import { DISTRICT_IDS } from './district'
import type { Env } from './env'
import { DAY_MS } from './limits'
import type { AdminErrorGroup, ClientErrorWhere, DistrictId, UaApp, UaDevice } from './protocol'

/*
 * Client errors: what the page catches (window errors, unhandled rejections, a lost WebGL context, React's
 * boundary) and sends with `navigator.sendBeacon` to `POST /api/errors`. Kept in our own D1, never a third
 * party, for 14 days, and read only on the admin page. Nothing stored names a person: the body has no account
 * id, name or typed text by design, and URLs and anything shaped like an email are scrubbed here as well.
 */

/** The biggest report body read; anything bigger is a 400. */
export const ERROR_MAX_BODY = 4 * 1024
/** Each text field is cut to this many characters (after scrubbing). */
export const ERROR_LIMITS = { msg: 300, stack: 1024, build: 40 } as const
/** Reports per address: 20 a minute, counted in D1 like the invite limit (see `ipWindowLimit`). */
export const ERROR_IP_LIMIT = { perWindow: 20, windowMs: 60_000, bucket: 'errors-ip' } as const
/** The cron deletes reports older than this. */
export const ERROR_KEEP_MS = 14 * DAY_MS
/** The admin page lists this many fingerprints, the most frequent first. */
const TOP = 20

const WHERE: readonly ClientErrorWhere[] = ['error', 'rejection', 'webgl-lost', 'react']
const DEVICES: readonly UaDevice[] = ['mobile', 'desktop']
const APPS: readonly UaApp[] = ['instagram', 'facebook', 'other']

const is = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T)

/** Characters that end a URL or an address inside a message or a stack. */
const END = `\\s'"()<>`
/** A query string or fragment, up to a stack frame's `:line:col` or the end of the URL. */
const QUERY = new RegExp(
  `(\\b[a-z][a-z0-9+.-]*://[^?#${END}]*)[?#][^${END}]*?(?=(?::\\d+){1,2}(?=[${END}]|$)|[${END}]|$)`,
  'gi',
)
const EMAIL = new RegExp(`[^@${END}]+@[^@${END}]+\\.[a-z]{2,}`, 'gi')

/** `text` with no query string or fragment on any URL, and every email-shaped run as `[email]`. */
export function scrub(text: string): string {
  return text.replace(QUERY, '$1').replace(EMAIL, '[email]')
}

/** Groups the same error: where it was caught and its message, numbers taken out. 16 hex characters. */
async function fingerprint(where: string, msg: string): Promise<string> {
  const data = new TextEncoder().encode(`${where}\n${msg.replace(/\d+/g, '0')}`)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface Clean {
  where: ClientErrorWhere
  msg: string
  stack: string | null
  ua: string
  build: string
  district: DistrictId | null
}

/** The report, scrubbed and cut to size, or null when it is not one. Fields it does not know are dropped. */
function parse(raw: unknown): Clean | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.msg !== 'string' || !r.msg.trim() || !is(WHERE, r.where)) return null
  if (r.stack !== null && r.stack !== undefined && typeof r.stack !== 'string') return null
  const ua = (r.ua && typeof r.ua === 'object' ? r.ua : {}) as Record<string, unknown>
  const build = typeof r.build === 'string' && /^(?:[0-9a-f]{4,40}|dev)$/.test(r.build) ? r.build : 'unknown'
  return {
    where: r.where,
    msg: scrub(r.msg).slice(0, ERROR_LIMITS.msg),
    stack: typeof r.stack === 'string' && r.stack ? scrub(r.stack).slice(0, ERROR_LIMITS.stack) : null,
    ua: `${is(DEVICES, ua.device) ? ua.device : 'unknown'}/${is(APPS, ua.app) ? ua.app : 'other'}`,
    build: build.slice(0, ERROR_LIMITS.build),
    district: is(DISTRICT_IDS, r.district) ? r.district : null,
  }
}

/**
 * `POST /api/errors` (the caller has already counted it against `ERROR_IP_LIMIT` and read at most
 * `ERROR_MAX_BODY`; `raw` is null for a body that was not JSON or was too big). An empty 204, or a 400: never
 * anything from the body.
 */
export async function recordClientError(env: Env, raw: unknown, now = Date.now()): Promise<Response> {
  const report = parse(raw)
  if (!report) return Response.json({ error: 'invalid' }, { status: 400 })
  await env.DB.prepare(
    `INSERT INTO client_errors (fingerprint, place, msg, stack, ua, build, district, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await fingerprint(report.where, report.msg),
      report.where,
      report.msg,
      report.stack,
      report.ua,
      report.build,
      report.district,
      now,
    )
    .run()
  return new Response(null, { status: 204 })
}

/** The cron's sweep of reports past `ERROR_KEEP_MS`. */
export async function purgeClientErrors(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare('DELETE FROM client_errors WHERE created_at < ?')
    .bind(now - ERROR_KEEP_MS)
    .run()
}

/**
 * `GET /api/admin/errors` (admins only, see `handleAdmin`): the `TOP` most frequent fingerprints, each with
 * its count, when it was last seen, its latest report as the sample and a count per `device/app`.
 */
export async function listClientErrors(env: Env): Promise<Response> {
  const { results: top } = await env.DB.prepare(
    `SELECT fingerprint, COUNT(*) AS n, MAX(created_at) AS last, MAX(id) AS latest FROM client_errors
     GROUP BY fingerprint ORDER BY n DESC, last DESC LIMIT ?`,
  )
    .bind(TOP)
    .all<{ fingerprint: string; n: number; last: number; latest: number }>()
  if (!top.length) return Response.json([])
  const marks = top.map(() => '?').join(', ')
  const [samples, uas] = await Promise.all([
    env.DB.prepare(`SELECT id, place, msg, stack, build, district FROM client_errors WHERE id IN (${marks})`)
      .bind(...top.map((g) => g.latest))
      .all<{
        id: number
        place: ClientErrorWhere
        msg: string
        stack: string | null
        build: string
        district: DistrictId | null
      }>(),
    env.DB.prepare(
      `SELECT fingerprint, ua, COUNT(*) AS n FROM client_errors WHERE fingerprint IN (${marks})
       GROUP BY fingerprint, ua`,
    )
      .bind(...top.map((g) => g.fingerprint))
      .all<{ fingerprint: string; ua: string; n: number }>(),
  ])
  const sampleOf = new Map(samples.results.map((s) => [s.id, s]))
  const out: AdminErrorGroup[] = top.map((g) => {
    const s = sampleOf.get(g.latest)!
    const ua: Record<string, number> = {}
    for (const u of uas.results) if (u.fingerprint === g.fingerprint) ua[u.ua] = u.n
    return {
      fingerprint: g.fingerprint,
      where: s.place,
      msg: s.msg,
      count: g.n,
      lastSeen: g.last,
      sample: { stack: s.stack, build: s.build, district: s.district },
      ua,
    }
  })
  return Response.json(out)
}
