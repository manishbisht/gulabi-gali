/*
 * Web Push from the Worker, with WebCrypto only (there is no Node crypto here):
 *
 * - the payload is encrypted to the browser's keys as `aes128gcm` (RFC 8291 on RFC 8188), in one record;
 * - the request carries a VAPID JWT (RFC 8292), ES256, signed with the key in the `VAPID_PRIVATE_JWK` secret.
 *
 * Tested against RFC 8291's worked example and by round trip (test/webpush.test.ts).
 */

/** base64url without padding, as every Web Push key and JWT part is written. */
export const b64url = {
  encode(bytes: Uint8Array): string {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  /** Throws on anything that is not base64url. */
  decode(text: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url')
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(s, (c) => c.charCodeAt(0))
  },
}

const ascii = (s: string) => new TextEncoder().encode(s)

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8),
  )
}

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

/**
 * ECDH with `theirs`. WebCrypto names the key `public`; workers-types spells that field `$public`, which the
 * runtime does not read, so the standard name goes through a cast.
 */
export const ecdhWith = (theirs: CryptoKey) =>
  ({ name: 'ECDH', public: theirs }) as unknown as SubtleCryptoDeriveKeyAlgorithm
/** The record size written in the header. A push payload is one record, far under it. */
const RECORD_SIZE = 4096

/** A browser's push keys, from its subscription: `p256dh` (a P-256 point) and `auth` (16 bytes), base64url. */
export interface PushKeys {
  p256dh: string
  auth: string
}

/**
 * `plain` encrypted to `keys` (RFC 8291): salt, record size, our one-off public key, then the sealed record
 * (the plaintext and its last-record delimiter). `fixed` stands in the salt and our key pair, for the RFC's
 * example only; normally both are new every time.
 */
export async function encryptPayload(
  plain: Uint8Array,
  keys: PushKeys,
  fixed?: { local: CryptoKeyPair; salt: Uint8Array },
): Promise<Uint8Array> {
  const uaPublic = b64url.decode(keys.p256dh)
  const authSecret = b64url.decode(keys.auth)
  const local =
    fixed?.local ?? ((await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair)
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer)
  const theirs = await crypto.subtle.importKey('raw', uaPublic, ECDH, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhWith(theirs), local.privateKey, 256))
  const ikm = await hkdf(authSecret, ecdh, concat(ascii('WebPush: info\0'), uaPublic, asPublic), 32)
  const cek = await hkdf(salt, ikm, ascii('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, ascii('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plain, new Uint8Array([2]))),
  )
  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  return concat(header, asPublic, sealed)
}

/** The application server's identity for VAPID. */
export interface Vapid {
  key: CryptoKey
  /** The public key as the browser was given it (`applicationServerKey`): base64url, uncompressed point. */
  publicKey: string
  /** Who runs this server (an https: or mailto: URL), for a push service that needs to get in touch. */
  subject: string
}

/**
 * The VAPID identity from the `VAPID_PRIVATE_JWK` secret (a P-256 private JWK, `d`, `x` and `y`) and the
 * subject (an https: or mailto: URL), or null when either is missing or wrong or the key does not import:
 * then push is off.
 */
export async function vapidFrom(
  jwkText: string | undefined,
  subject: string | undefined,
): Promise<Vapid | null> {
  // RFC 8292: the subject is a mailto: or an https: URL; anything else and a push service may refuse us.
  if (!jwkText || !subject || !/^(https:|mailto:)/.test(subject)) return null
  try {
    const jwk = JSON.parse(jwkText) as JsonWebKey
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) return null
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
    const point = concat(new Uint8Array([4]), b64url.decode(jwk.x), b64url.decode(jwk.y))
    if (point.length !== 65) return null
    return { key, publicKey: b64url.encode(point), subject }
  } catch {
    return null
  }
}

/** How long a VAPID JWT is good for (RFC 8292 allows up to 24 hours). */
const JWT_LIFE_S = 12 * 3600

/** The `Authorization` header for a push to `endpoint`: `vapid t=<JWT>, k=<public key>`. */
export async function vapidHeader(vapid: Vapid, endpoint: string, now = Date.now()): Promise<string> {
  const part = (o: unknown) => b64url.encode(ascii(JSON.stringify(o)))
  const head = part({ typ: 'JWT', alg: 'ES256' })
  const claims = part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + JWT_LIFE_S,
    sub: vapid.subject,
  })
  // WebCrypto's ECDSA signature is already r || s, the form JWS wants.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapid.key,
    ascii(`${head}.${claims}`),
  )
  return `vapid t=${head}.${claims}.${b64url.encode(new Uint8Array(sig))}, k=${vapid.publicKey}`
}

/** One push: where it goes and the browser's keys. */
export interface PushTarget extends PushKeys {
  endpoint: string
}

export interface PushOptions {
  /** Seconds the push service keeps it for a device that is offline. */
  ttl: number
  /** Pending pushes with the same topic replace each other at the push service (base64url, at most 32). */
  topic?: string
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
}

/** Sends `payload` to `target` and answers the push service's status. Throws only if it cannot be reached. */
export async function sendPush(
  target: PushTarget,
  payload: string,
  vapid: Vapid,
  opts: PushOptions,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<number> {
  const body = await encryptPayload(ascii(payload), target)
  const headers: Record<string, string> = {
    Authorization: await vapidHeader(vapid, target.endpoint, now),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl),
    Urgency: opts.urgency ?? 'normal',
  }
  if (opts.topic) headers.Topic = opts.topic
  const res = await fetcher(target.endpoint, { method: 'POST', headers, body })
  // Only the status matters; the body is read and dropped so the connection is let go.
  await res.body?.cancel().catch(() => undefined)
  return res.status
}
