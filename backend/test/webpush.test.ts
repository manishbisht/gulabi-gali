import { describe, expect, it } from 'vitest'
import { b64url, encryptPayload, vapidFrom, vapidHeader } from '../src/webpush'
import { decryptPayload, testKeys, userAgent } from './pushKit'

// RFC 8291, Appendix A: the one worked example of aes128gcm Web Push encryption.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

/** An ECDH key pair from a private scalar and its uncompressed public point. */
async function ecdhPair(d: string, pub: string): Promise<CryptoKeyPair> {
  const raw = b64url.decode(pub)
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d,
    x: b64url.encode(raw.slice(1, 33)),
    y: b64url.encode(raw.slice(33)),
  }
  const algo = { name: 'ECDH', namedCurve: 'P-256' }
  return {
    privateKey: await crypto.subtle.importKey('jwk', jwk, algo, false, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', raw, algo, true, []),
  }
}

const text = new TextEncoder()

describe('Web Push encryption (RFC 8291, aes128gcm)', () => {
  it('matches the RFC 8291 worked example byte for byte', async () => {
    const body = await encryptPayload(
      text.encode(RFC.plaintext),
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      { local: await ecdhPair(RFC.asPrivate, RFC.asPublic), salt: b64url.decode(RFC.salt) },
    )
    expect(b64url.encode(body)).toBe(RFC.body)
  })

  it('round-trips: what it encrypts to a browser, that browser decrypts', async () => {
    const ua = await userAgent()
    const body = await encryptPayload(text.encode('{"t":"message","lang":"hi"}'), ua.keys)
    expect(new TextDecoder().decode(await decryptPayload(body, ua))).toBe('{"t":"message","lang":"hi"}')
    // A fresh salt and key each time: the same payload never encrypts the same way twice.
    const again = await encryptPayload(text.encode('{"t":"message","lang":"hi"}'), ua.keys)
    expect(b64url.encode(again)).not.toBe(b64url.encode(body))
  })

  it('another browser cannot read it', async () => {
    const ua = await userAgent()
    const other = await userAgent()
    const body = await encryptPayload(text.encode('{"t":"request","lang":"en"}'), ua.keys)
    await expect(decryptPayload(body, other)).rejects.toThrow()
  })
})

describe('VAPID (RFC 8292)', () => {
  it('signs a JWT for the push service’s origin that verifies with the public key it names', async () => {
    const keys = await testKeys()
    const vapid = (await vapidFrom(keys.jwk, 'https://gulabi-gali.manishbisht.me'))!
    expect(vapid.publicKey).toBe(keys.publicKey)
    const now = Date.UTC(2026, 10, 16, 12)
    const header = await vapidHeader(vapid, 'https://fcm.googleapis.com/fcm/send/abc:def', now)
    const m = header.match(/^vapid t=([^,]+), k=(\S+)$/)!
    expect(m[2]).toBe(keys.publicKey)
    const [h, c, s] = m[1]!.split('.') as [string, string, string]
    const decode = (part: string) => JSON.parse(new TextDecoder().decode(b64url.decode(part))) as unknown
    expect(decode(h)).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(decode(c)).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'https://gulabi-gali.manishbisht.me',
    })
    const pub = await crypto.subtle.importKey(
      'raw',
      b64url.decode(keys.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      b64url.decode(s),
      text.encode(`${h}.${c}`),
    )
    expect(ok).toBe(true)
  })

  it('no key, or a key that is not a P-256 private JWK, is no VAPID: push is off', async () => {
    expect(await vapidFrom(undefined, 'https://x.example')).toBeNull()
    expect(await vapidFrom('', 'https://x.example')).toBeNull()
    expect(await vapidFrom('not json', 'https://x.example')).toBeNull()
    expect(await vapidFrom('{"kty":"EC","crv":"P-256"}', 'https://x.example')).toBeNull()
    const { jwk } = await testKeys()
    expect(await vapidFrom(jwk, undefined)).toBeNull()
  })

  it('a subject that is not an https: or mailto: URL is no VAPID either: push is off', async () => {
    const { jwk } = await testKeys()
    for (const subject of [
      'gulabi-gali.manishbisht.me',
      'http://gulabi-gali.manishbisht.me',
      'ftp://x',
      ' https://x',
    ])
      expect(await vapidFrom(jwk, subject), subject).toBeNull()
    expect(await vapidFrom(jwk, 'https://gulabi-gali.manishbisht.me')).not.toBeNull()
    expect(await vapidFrom(jwk, 'mailto:owner@example.com')).not.toBeNull()
  })
})
