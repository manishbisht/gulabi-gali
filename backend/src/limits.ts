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
  buckets: { profile: 'read-profile', requests: 'read-requests' },
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

/** The cron's sweep of counter windows long past. */
export async function purgeCounters(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare('DELETE FROM counters WHERE window_start < ?')
    .bind(now - COUNTER_KEEP_MS)
    .run()
}
