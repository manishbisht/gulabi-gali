import type { Env } from './env'
import { allow, rateLimited } from './limits'
import { activeRow } from './profiles'
import { b64url, sendPush, vapidFrom, type Vapid } from './webpush'

/**
 * Push notifications for requests and messages, opted into per device from the profile sheet.
 *
 * Privacy: a push names nobody and quotes nothing. Its payload is `{t, lang}` and nothing else (a meet-up
 * reminder adds its poster's wall, `at`, for the tap only): the service worker shows "Gulabi Gali" over "a new
 * request" or "a new message" in the device's language, and a tap opens the inbox. The person who asked or wrote is seen only inside the app, where blocks and hides already apply.
 *
 * Off by itself without a VAPID key (the `VAPID_PRIVATE_JWK` secret, set by `scripts/vapid-setup.mjs`) or a
 * subject (`VAPID_SUBJECT`): subscribing is 404 `off`, and nothing is ever sent.
 */

/** The notices that push when the person has no inbox open: an `accepted` or an `unmatched` never does. */
export const PUSH_KINDS = ['request', 'message'] as const
export type PushKind = (typeof PUSH_KINDS)[number]
export const isPushKind = (t: string): t is PushKind => (PUSH_KINDS as readonly string[]).includes(t)
/**
 * Everything a push may be about: the inbox's kinds, and `meetup`, the reminder an hour before a plan someone
 * said they would come to (see `remindMeetups`), which names neither the plan nor anyone in it.
 */
export type PushTopic = PushKind | 'meetup'

export const PUSH_LANGS = ['hi', 'en'] as const
export type PushLang = (typeof PUSH_LANGS)[number]

/**
 * Pushes one person gets, whatever they are about: at most one a minute (a burst of messages is one buzz) and
 * ten an hour. A push held back is just dropped: the inbox lists everything when it opens.
 */
export const PUSH_LIMIT = {
  minute: { perWindow: 1, windowMs: 60_000, bucket: 'push-minute' },
  hour: { perWindow: 10, windowMs: 3600_000, bucket: 'push-hour' },
  /**
   * Meet-up reminders have their own count, so a message push in the same minute never drops one: a few an
   * hour (one per plan), whatever the inbox sent.
   */
  meetup: { perWindow: 5, windowMs: 3600_000, bucket: 'push-meetup' },
} as const

/** `PUT` and `DELETE /api/me/push` per account: a page sends one on each open and on each switch. */
export const PUSH_SUB_LIMIT = { perWindow: 30, windowMs: 3600_000, bucket: 'push-sub' } as const

/** Devices one person keeps subscribed; a newer one pushes the oldest out. */
export const PUSH_DEVICES = 5

/** How long a push service holds a push for a phone that is off: a day, then it is old news. */
const PUSH_TTL_S = 24 * 3600
/** The shortest hold a caller may ask for (`pushTo`'s `ttlS`). */
export const MIN_PUSH_TTL_S = 60

/** The longest endpoint taken. The real ones are a few hundred characters. */
const MAX_ENDPOINT = 1024

/**
 * The push services a subscription may point at: every browser's own (Chrome, Edge, Samsung and the rest on
 * FCM or WNS, Firefox on Mozilla's, Safari on Apple's). Anything else is refused, so the Worker never posts to
 * an address of a client's choosing.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
]

/** With DEV_AUTH only (tests and e2e): a fake push service on this machine. */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost']

function endpointAllowed(env: Env, endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT) return false
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((h) => h.test(url.hostname))) return true
  return env.DEV_AUTH === '1' && url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname)
}

/** Whether `text` is base64url for exactly `bytes` bytes (and, for a key, an uncompressed P-256 point). */
function keyOf(text: unknown, bytes: number, point = false): text is string {
  if (typeof text !== 'string' || text.length > 128) return false
  try {
    const raw = b64url.decode(text)
    return raw.length === bytes && (!point || raw[0] === 4)
  } catch {
    return false
  }
}

interface Subscription {
  endpoint: string
  p256dh: string
  auth: string
  lang: PushLang
  /** The `applicationServerKey` the browser subscribed with. */
  server: string
}

/** Whether `p256dh` is a point on P-256, which the encryption needs: one that is not would fail every push. */
async function onCurve(p256dh: string): Promise<boolean> {
  try {
    await crypto.subtle.importKey(
      'raw',
      b64url.decode(p256dh),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    )
    return true
  } catch {
    return false
  }
}

/** A `PUT /api/me/push` body, or null. */
function parseSubscription(env: Env, raw: unknown): Subscription | null {
  const b = (raw ?? {}) as Record<string, unknown>
  const keys = (b.keys ?? {}) as Record<string, unknown>
  if (typeof b.endpoint !== 'string' || !endpointAllowed(env, b.endpoint)) return null
  if (!keyOf(keys.p256dh, 65, true) || !keyOf(keys.auth, 16)) return null
  if (typeof b.lang !== 'string' || !(PUSH_LANGS as readonly string[]).includes(b.lang)) return null
  if (typeof b.server !== 'string') return null
  return {
    endpoint: b.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    lang: b.lang as PushLang,
    server: b.server,
  }
}

/** The VAPID identity, imported once per isolate (and again only if the secret changes). */
let cached: { text: string | undefined; subject: string | undefined; vapid: Promise<Vapid | null> } | null =
  null

export function vapidOf(env: Env): Promise<Vapid | null> {
  const text = env.VAPID_PRIVATE_JWK
  const subject = env.VAPID_SUBJECT
  if (!cached || cached.text !== text || cached.subject !== subject)
    cached = { text, subject, vapid: vapidFrom(text, subject) }
  return cached.vapid
}

async function subLimit(env: Env, userId: string, now: number): Promise<Response | null> {
  const { perWindow, windowMs, bucket } = PUSH_SUB_LIMIT
  return (await allow(env, userId, bucket, perWindow, windowMs, now)) ? null : rateLimited(windowMs, now)
}

/**
 * `PUT /api/me/push {endpoint, keys: {p256dh, auth}, lang, server}`: this device wants a push for a new request
 * or message while the app is shut. 204. A resident only (403 `ghost` for anyone else); 404 `off` when push is
 * not configured; 400 `invalid` for an endpoint off the known push services or keys that are not keys (`p256dh` must be a point on P-256); 409
 * `key` when the browser subscribed with another server key than ours (the page re-subscribes); 429 past
 * `PUSH_SUB_LIMIT`. The endpoint is the row's key, so the same browser signed in as someone else moves to them;
 * past `PUSH_DEVICES` the oldest device goes.
 */
export async function putPush(env: Env, userId: string, raw: unknown, now = Date.now()): Promise<Response> {
  const vapid = await vapidOf(env)
  if (!vapid) return Response.json({ error: 'off' }, { status: 404 })
  if (!(await activeRow(env, userId))) return Response.json({ error: 'ghost' }, { status: 403 })
  const slow = await subLimit(env, userId, now)
  if (slow) return slow
  const sub = parseSubscription(env, raw)
  if (!sub || !(await onCurve(sub.p256dh))) return Response.json({ error: 'invalid' }, { status: 400 })
  if (sub.server !== vapid.publicKey) return Response.json({ error: 'key' }, { status: 409 })
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO push_subs (endpoint, user_id, p256dh, auth, lang, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
         auth = excluded.auth, lang = excluded.lang, created_at = excluded.created_at`,
    ).bind(sub.endpoint, userId, sub.p256dh, sub.auth, sub.lang, now),
    env.DB.prepare(
      `DELETE FROM push_subs WHERE user_id = ?1 AND endpoint NOT IN
         (SELECT endpoint FROM push_subs WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2)`,
    ).bind(userId, PUSH_DEVICES),
  ])
  return new Response(null, { status: 204 })
}

/**
 * `DELETE /api/me/push {endpoint}`: this device wants no more pushes (switched off, or signing out). 204, also
 * when there was nothing to delete; someone else's endpoint is never touched. Works with push off too.
 */
export async function removePush(
  env: Env,
  userId: string,
  raw: unknown,
  now = Date.now(),
): Promise<Response> {
  const endpoint = (raw as { endpoint?: unknown } | null)?.endpoint
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT)
    return Response.json({ error: 'invalid' }, { status: 400 })
  const slow = await subLimit(env, userId, now)
  if (slow) return slow
  await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?')
    .bind(endpoint, userId)
    .run()
  return new Response(null, { status: 204 })
}

/** The statement that forgets every device of `userId` (account deletion; a ban does it by trigger, 0008). */
export const forgetPushOf = (env: Env, userId: string): D1PreparedStatement =>
  env.DB.prepare('DELETE FROM push_subs WHERE user_id = ?').bind(userId)

/**
 * Tells `userId`'s subscribed devices that something of `kind` arrived, when they have no inbox open (the
 * inbox decides; see `InboxDO.notify`), or that a plan they are going to is an hour away (`meetup`). Nothing
 * when push is off, they are no resident now (a ban), they have no device, or they are past `PUSH_LIMIT`
 * (`meetup` counts against its own limit only). The push service holds it for `ttlS` seconds (at least
 * `MIN_PUSH_TTL_S`) while the phone is off. A device whose push service answers 404 or 410 has gone and is
 * forgotten. Never throws; answers how many devices took it.
 */
export async function pushTo(
  env: Env,
  userId: string,
  kind: PushTopic,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  ttlS = PUSH_TTL_S,
): Promise<number> {
  return (await deliver(env, userId, kind, fetcher, now, { ttlS })).took
}

/** A meet-up reminder's poster, as a place link names it: `<district>:poster-<wall>`. */
export const posterPlace = (district: string, wall: number) => `${district}:poster-${wall}`

/**
 * `pushTo`, saying also whether to try again later: `retry` when no device took it because something failed
 * (a push service error other than 404/410, a network error, D1 unreachable), never when there was simply
 * nothing to send (push off, no resident, no device, past the limit) or a device took it. A `meetup` may carry
 * `at`, its poster's place (`posterPlace`): the service worker puts it in the tap's data only, so the tap opens
 * the city there; it names a wall, never a person, and is never shown. Never throws.
 */
export async function deliver(
  env: Env,
  userId: string,
  kind: PushTopic,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  { ttlS = PUSH_TTL_S, at }: { ttlS?: number; at?: string } = {},
): Promise<{ took: number; retry: boolean }> {
  const none = { took: 0, retry: false }
  try {
    const vapid = await vapidOf(env)
    if (!vapid || !(await activeRow(env, userId))) return none
    const { results } = await env.DB.prepare(
      'SELECT endpoint, p256dh, auth, lang FROM push_subs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    )
      .bind(userId, PUSH_DEVICES)
      .all<{ endpoint: string; p256dh: string; auth: string; lang: PushLang }>()
    if (!results.length) return none
    const { minute, hour, meetup } = PUSH_LIMIT
    if (kind === 'meetup') {
      if (!(await allow(env, userId, meetup.bucket, meetup.perWindow, meetup.windowMs, now))) return none
    } else {
      if (!(await allow(env, userId, minute.bucket, minute.perWindow, minute.windowMs, now))) return none
      if (!(await allow(env, userId, hour.bucket, hour.perWindow, hour.windowMs, now))) return none
    }
    const outcomes = await Promise.all(
      results.map(async (sub): Promise<'took' | 'gone' | 'failed'> => {
        try {
          // The whole payload: what kind of thing, the language to say it in, and for a reminder the wall the
          // tap opens. No name, no text, no id.
          const payload = JSON.stringify(
            kind === 'meetup' && at ? { t: kind, lang: sub.lang, at } : { t: kind, lang: sub.lang },
          )
          const opts = {
            ttl: Math.max(MIN_PUSH_TTL_S, Math.round(ttlS)),
            topic: kind,
            urgency: 'normal',
          } as const
          const status = await sendPush(sub, payload, vapid, opts, fetcher, now)
          if (status === 404 || status === 410) {
            await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?')
              .bind(sub.endpoint, userId)
              .run()
            return 'gone'
          }
          if (status >= 200 && status < 300) return 'took'
          console.error('push: refused', status)
          return 'failed'
        } catch (err) {
          console.error('push: send failed', err)
          return 'failed'
        }
      }),
    )
    const took = outcomes.filter((o) => o === 'took').length
    return { took, retry: took === 0 && outcomes.includes('failed') }
  } catch (err) {
    console.error('push: failed', err)
    return { took: 0, retry: true }
  }
}
