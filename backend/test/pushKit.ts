import { b64url, ecdhWith } from '../src/webpush'

/*
 * The browser's half of Web Push, for tests only: a subscriber's keys, and the decryption a browser does
 * (RFC 8291). Nothing here ships. Keys are made fresh in memory on every call and never written anywhere.
 */

/** A VAPID key pair made in memory: the private key as the JWK text the Worker's secret holds, and the public key. */
export async function testKeys(): Promise<{ jwk: string; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const { kty, crv, d, x, y } = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  return { jwk: JSON.stringify({ kty, crv, d, x, y }), publicKey: b64url.encode(raw) }
}

/** The public key (base64url, uncompressed point) of a VAPID private JWK. */
export function publicOf(jwk: string): string {
  const { x, y } = JSON.parse(jwk) as { x: string; y: string }
  return b64url.encode(new Uint8Array([4, ...b64url.decode(x), ...b64url.decode(y)]))
}

export interface UserAgent {
  /** What a subscription carries: `p256dh` and `auth`, base64url. */
  keys: { p256dh: string; auth: string }
  privateKey: CryptoKey
}

/** A browser's push keys, as `PushManager.subscribe` makes them. */
export async function userAgent(): Promise<UserAgent> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const auth = crypto.getRandomValues(new Uint8Array(16))
  return { keys: { p256dh: b64url.encode(pub), auth: b64url.encode(auth) }, privateKey: pair.privateKey }
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8),
  )
}

const ascii = (s: string) => new TextEncoder().encode(s)

/** What the browser does with an aes128gcm push body: the plaintext, padding and delimiter taken off. */
export async function decryptPayload(body: Uint8Array, ua: UserAgent): Promise<Uint8Array> {
  const salt = body.slice(0, 16)
  const idlen = body[20]!
  const asPublic = body.slice(21, 21 + idlen)
  const sealed = body.slice(21 + idlen)
  const theirs = await crypto.subtle.importKey(
    'raw',
    asPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhWith(theirs), ua.privateKey, 256))
  const uaPublic = b64url.decode(ua.keys.p256dh)
  const ikm = await hkdf(
    b64url.decode(ua.keys.auth),
    ecdh,
    new Uint8Array([...ascii('WebPush: info\0'), ...uaPublic, ...asPublic]),
    32,
  )
  const cek = await hkdf(salt, ikm, ascii('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, ascii('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed))
  let end = padded.length - 1
  while (end >= 0 && padded[end] === 0) end--
  if (padded[end] !== 2) throw new Error('not a last record')
  return padded.slice(0, end)
}
