import type { Env } from './env'

/** Where the fixed window holding `now` began. */
export const windowStart = (now: number, windowMs: number): number => now - (now % windowMs)

/**
 * Per-account reads: each of these routes allows this many calls a minute to one account. Bucket names are
 * their own (never shared with a write limit's), since a minute window and a day window can start at the
 * same instant.
 */
export const READ_LIMIT = {
  perWindow: 120,
  windowMs: 60_000,
  buckets: { profile: 'read-profile', requests: 'read-requests', going: 'read-going' },
} as const

/** Counter rows older than this are only history: the cron deletes them. Longer than any window in use. */
const COUNTER_KEEP_MS = 2 * 24 * 3600 * 1000

/**
 * One use of `bucket` by `userId`: true while it is within `limit` uses in the current fixed window of
 * `windowMs`. Counted in D1 with one upsert, so concurrent calls from any isolate share the count. A refused
 * call still counts: hammering does not reset anything.
 */
export async function allow(
  env: Env,
  userId: string,
  bucket: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<boolean> {
  const row = await env.DB.prepare(
    `INSERT INTO counters (user_id, bucket, window_start, n) VALUES (?, ?, ?, 1)
     ON CONFLICT (user_id, bucket, window_start) DO UPDATE SET n = n + 1
     RETURNING n`,
  )
    .bind(userId, bucket, windowStart(now, windowMs))
    .first<{ n: number }>()
  return (row?.n ?? Infinity) <= limit
}

/**
 * Gives back one use of `bucket` in the window holding `now`: for a call `allow` let through that then did
 * nothing (it lost a race). Never below zero.
 */
export async function refund(
  env: Env,
  userId: string,
  bucket: string,
  windowMs: number,
  now = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    'UPDATE counters SET n = n - 1 WHERE user_id = ? AND bucket = ? AND window_start = ? AND n > 0',
  )
    .bind(userId, bucket, windowStart(now, windowMs))
    .run()
}

/** 429 `rate`, with `Retry-After` in whole seconds until the window turns. */
export function rateLimited(windowMs: number, now = Date.now()): Response {
  const wait = Math.max(1, Math.ceil((windowStart(now, windowMs) + windowMs - now) / 1000))
  return Response.json({ error: 'rate' }, { status: 429, headers: { 'Retry-After': String(wait) } })
}

/**
 * A read route's allowance (see `READ_LIMIT`): null while within it, else the 429 to answer with.
 */
export async function readLimit(
  env: Env,
  userId: string,
  route: keyof typeof READ_LIMIT.buckets,
  now = Date.now(),
): Promise<Response | null> {
  const { perWindow, windowMs, buckets } = READ_LIMIT
  return (await allow(env, userId, buckets[route], perWindow, windowMs, now))
    ? null
    : rateLimited(windowMs, now)
}

/** The cron's sweep of counter windows long past, found by `counters_window`; it takes the cutoff. */
export const COUNTER_PURGE = 'DELETE FROM counters WHERE window_start < ?'

/** The cron's sweep of counter windows long past. */
export async function purgeCounters(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare(COUNTER_PURGE)
    .bind(now - COUNTER_KEEP_MS)
    .run()
}

/**
 * Per-account allowances. Each is a fixed window counted with `allow` (bucket names never shared, see
 * `READ_LIMIT`).
 */
export const DAY_MS = 24 * 3600 * 1000
export const ACCOUNT_LIMIT = {
  /** New requests: an account under a week old gets the smaller allowance. */
  newAccountAge: 7 * DAY_MS,
  requestsNew: 5,
  requestsOld: 20,
  /** Chat messages by one sender across every match (on top of the 1/s per match). */
  messagesPerMinute: 30,
} as const

/**
 * A person's new-request allowance for today: 5 while the account is under 7 days old (`users.created_at`),
 * 20 after. Null while within it, else the 429.
 */
export async function requestLimit(env: Env, userId: string, now = Date.now()): Promise<Response | null> {
  const row = await env.DB.prepare('SELECT created_at FROM users WHERE id = ?')
    .bind(userId)
    .first<{ created_at: number }>()
  const young = !row || now - row.created_at < ACCOUNT_LIMIT.newAccountAge
  const limit = young ? ACCOUNT_LIMIT.requestsNew : ACCOUNT_LIMIT.requestsOld
  return (await allow(env, userId, 'requests', limit, DAY_MS, now)) ? null : rateLimited(DAY_MS, now)
}

/**
 * `PUT /api/me/stamps` per account: a page pushes once when it opens signed in and once per new stamp (thirteen
 * in all), so 30 an hour is room for many reloads, and a stuck loop stops there.
 */
export const STAMP_LIMIT = { perWindow: 30, windowMs: 3600_000, bucket: 'stamps' } as const

/** One stamp push's allowance (see `STAMP_LIMIT`). Null while within it, else the 429. */
export async function stampLimit(env: Env, userId: string, now = Date.now()): Promise<Response | null> {
  const { perWindow, windowMs, bucket } = STAMP_LIMIT
  return (await allow(env, userId, bucket, perWindow, windowMs, now)) ? null : rateLimited(windowMs, now)
}

/** One chat message's allowance against the per-minute cap. Null while within it, else the 429. */
export async function messageLimit(env: Env, userId: string, now = Date.now()): Promise<Response | null> {
  const { messagesPerMinute } = ACCOUNT_LIMIT
  return (await allow(env, userId, 'messages', messagesPerMinute, 60_000, now))
    ? null
    : rateLimited(60_000, now)
}

/*
 * Per-address limits. The Workers Rate Limiting bindings (wrangler.jsonc `ratelimits`) take only 10 or 60
 * second periods, so the 1-hour one (invite redemptions) is counted in D1 under the key `ip:<address>`.
 *
 * Trust assumption: `CF-Connecting-IP` is set by Cloudflare's edge on every request that reaches this Worker
 * in production, replacing anything the client sent, and a client cannot reach the Worker any other way. So
 * it is the connecting address, and no other header (`X-Forwarded-For`, `X-Real-IP`) is ever read. A request
 * with none, or with a loopback one, did not come through the edge: only `wrangler dev`, tests and CI, all of
 * which run with DEV_AUTH=1. So that is the only place it is exempt; anywhere else it all counts under one
 * shared `noip` key, so a misrouted deploy (a route that skips the edge) is throttled, never unlimited.
 */

/** How long a refused address is told to wait: the longest period of any binding in wrangler.jsonc. */
export const IP_RETRY_AFTER_S = 60

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/i

/**
 * What an address counts as, for the rate limits and the per-address socket cap alike: an IPv4 address as itself
 * (also when mapped into IPv6, in any spelling), an IPv6 one as its /64 (written out, so every spelling of it is
 * the same key).
 */
export function ipKey(ip: string): string {
  const a = ip.toLowerCase().split('%')[0]!
  if (!a.includes(':')) return a
  const mapped = a.match(/^(?:::|0::|(?:0:){5})ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return mapped[1]!
  // The same address written in hex (::ffff:7f00:1) is the IPv4 one too.
  const hex = a.match(/^(?:::|0::|(?:0:){5})ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const hi = parseInt(hex[1]!, 16)
    const lo = parseInt(hex[2]!, 16)
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  const [head, tail] = a.split('::') as [string, string | undefined]
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups =
    tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/64`
}

/** The one key every request without a usable edge address shares, outside dev. */
export const NO_IP_KEY = 'noip'

/** The key a request counts against, or null when it never counts (loopback or no address, in dev only). */
export function clientKey(request: Request, env: Pick<Env, 'DEV_AUTH'>): string | null {
  const ip = request.headers.get('CF-Connecting-IP')?.trim()
  const key = ip ? ipKey(ip) : null
  if (!ip || LOOPBACK.test(ip) || LOOPBACK.test(key!)) return env.DEV_AUTH === '1' ? null : NO_IP_KEY
  return key
}

/** The 429 for a per-address limit. */
export const ipRateLimited = (): Response =>
  Response.json(
    { error: 'rate', scope: 'ip' },
    { status: 429, headers: { 'Retry-After': String(IP_RETRY_AFTER_S) } },
  )

/** Whether `request`'s address is over `limiter`. An absent binding limits nothing. */
export async function overLimit(
  env: Env,
  limiter: RateLimit | undefined,
  request: Request,
): Promise<boolean> {
  const key = clientKey(request, env)
  if (!limiter || key === null) return false
  const { success } = await limiter.limit({ key })
  return !success
}

/** Null while within `limiter`, else the 429. */
export async function ipLimit(
  env: Env,
  limiter: RateLimit | undefined,
  request: Request,
): Promise<Response | null> {
  return (await overLimit(env, limiter, request)) ? ipRateLimited() : null
}

/** A per-address allowance counted in D1, for windows the bindings cannot take (see above). */
export interface IpWindow {
  perWindow: number
  windowMs: number
  bucket: string
}

/** One use of `limit` by `request`'s address, counted under `ip:<address>`. Null while within it, else the 429. */
export async function ipWindowLimit(
  env: Env,
  request: Request,
  limit: IpWindow,
  now = Date.now(),
): Promise<Response | null> {
  const key = clientKey(request, env)
  if (key === null) return null
  const { perWindow, windowMs, bucket } = limit
  return (await allow(env, `ip:${key}`, bucket, perWindow, windowMs, now)) ? null : rateLimited(windowMs, now)
}

export const INVITE_IP_LIMIT = { perWindow: 10, windowMs: 3600_000, bucket: 'redeem-ip' } as const

/** Invite redemptions per address, 10 an hour, in addition to the per-person limit. Null while within it. */
export const inviteIpLimit = (env: Env, request: Request, now = Date.now()): Promise<Response | null> =>
  ipWindowLimit(env, request, INVITE_IP_LIMIT, now)

/**
 * A moderator's mute (`users.muted_until`, ms): while it lasts, everything a person writes for others to read
 * (requests, chat messages, their profile; the district refuses bench lines and status the same way) is 403
 * `{ error: 'muted', until }`. It runs out by itself. Reading, reporting and blocking stay open. Null while
 * not muted.
 */
export async function muteGate(env: Env, userId: string, now = Date.now()): Promise<Response | null> {
  const row = await env.DB.prepare('SELECT muted_until FROM users WHERE id = ?')
    .bind(userId)
    .first<{ muted_until: number | null }>()
  const until = row?.muted_until ?? null
  return until !== null && until > now ? Response.json({ error: 'muted', until }, { status: 403 }) : null
}
