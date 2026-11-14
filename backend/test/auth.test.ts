import { env } from 'cloudflare:test'
import { signJwt } from '@clerk/backend/jwt'
import { describe, expect, it } from 'vitest'
import { ClerkKeys, JWKS_RETRY_MS, JWKS_TTL_MS, resolveUser, verifyClerkToken } from '../src/auth'
import type { Env } from '../src/env'
import worker from '../src/index'

const testEnv = env as unknown as Env

async function signingKey() {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
  const spki = new Uint8Array((await crypto.subtle.exportKey('spki', pair.publicKey)) as ArrayBuffer)
  const pem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki))}\n-----END PUBLIC KEY-----`
  const sign = (claims: Record<string, unknown> = {}) =>
    signJwt(
      {
        sub: 'user_abc',
        exp: Math.floor(Date.now() / 1000) + 60,
        nbf: Math.floor(Date.now() / 1000) - 5,
        ...claims,
      },
      privateJwk,
      { algorithm: 'RS256', header: { typ: 'JWT', kid: 'ins_1' } },
    )
  return { pem, sign, jwk: { ...publicJwk, kid: 'ins_1', alg: 'RS256', use: 'sig' } }
}

const bearer = (token: string) =>
  new Request('https://x.test/api/me', { headers: { Authorization: `Bearer ${token}` } })

async function devToken(name: string, e: Env = testEnv): Promise<string> {
  const res = await worker.fetch(
    new Request('https://x.test/api/dev/login', {
      method: 'POST',
      body: JSON.stringify({ name }),
      headers: { 'content-type': 'application/json' },
    }),
    e,
  )
  return ((await res.json()) as { token: string }).token
}

describe('resolveUser', () => {
  it('accepts a Clerk token signed with CLERK_JWT_KEY', async () => {
    const key = await signingKey()
    const e = { ...testEnv, CLERK_JWT_KEY: key.pem, DEV_AUTH: undefined } as unknown as Env
    expect(await resolveUser(bearer(await key.sign()), e)).toEqual({ id: 'clerk:user_abc' })
    const viaQuery = new Request(`https://x.test/ws?token=${await key.sign()}`)
    expect(await resolveUser(viaQuery, e)).toEqual({ id: 'clerk:user_abc' })
  })

  it('rejects an expired token', async () => {
    const key = await signingKey()
    const e = { ...testEnv, CLERK_JWT_KEY: key.pem } as unknown as Env
    const expired = await key.sign({ exp: Math.floor(Date.now() / 1000) - 600 })
    expect(await resolveUser(bearer(expired), e)).toBeNull()
  })

  it('rejects a missing or garbage token', async () => {
    expect(await resolveUser(new Request('https://x.test/api/me'), testEnv)).toBeNull()
    expect(await resolveUser(bearer('nonsense'), testEnv)).toBeNull()
  })

  it('dev tokens work only with DEV_AUTH=1', async () => {
    const token = await devToken('Asha')
    expect(await resolveUser(bearer(token), testEnv)).toEqual({ id: 'dev:asha' })
    const off = { ...testEnv, DEV_AUTH: undefined } as unknown as Env
    expect(await resolveUser(bearer(token), off)).toBeNull()
    const login = await worker.fetch(
      new Request('https://x.test/api/dev/login', { method: 'POST', body: JSON.stringify({ name: 'Asha' }) }),
      off,
    )
    expect(login.status).toBe(404)
  })

  it('a tampered dev token is rejected', async () => {
    const token = await devToken('Asha')
    const [, , mac] = token.split('.')
    expect(await resolveUser(bearer(`dev.bob.${mac}`), testEnv)).toBeNull()
    expect(await resolveUser(bearer(`${token}0`), testEnv)).toBeNull()
    expect(await resolveUser(bearer('dev.asha.'), testEnv)).toBeNull()
  })
})

describe('CORS', () => {
  it('lets an allowed origin send Authorization and use PUT and DELETE', async () => {
    const res = await worker.fetch(
      new Request('https://x.test/api/me', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      }),
      testEnv,
    )
    expect(res.status).toBe(204)
    const methods = res.headers.get('access-control-allow-methods') ?? ''
    for (const m of ['GET', 'PUT', 'POST', 'DELETE']) expect(methods).toContain(m)
    const headers = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase()
    expect(headers).toContain('authorization')
    expect(headers).toContain('content-type')
  })
})

describe('the Clerk key set (no CLERK_JWT_KEY)', () => {
  /** A stand-in for Clerk's JWKS endpoint that counts its calls and can be told what to answer. */
  function jwks(keys: JsonWebKey[]) {
    const calls: { url: string; auth: string | null }[] = []
    let answer: () => Response = () => Response.json({ keys })
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get('Authorization') })
      return answer()
    }) as typeof fetch
    return { calls, fetcher, answer: (fn: () => Response) => (answer = fn) }
  }
  const clerkEnv = { ...testEnv, CLERK_SECRET_KEY: 'sk_test_x', CLERK_JWT_KEY: undefined } as unknown as Env

  it('fetches the keys with the secret key, then verifies from the cache with no network', async () => {
    const key = await signingKey()
    const api = jwks([key.jwk])
    let now = 1_000_000
    const keys = new ClerkKeys(api.fetcher, () => now)
    expect(await verifyClerkToken(await key.sign(), clerkEnv, keys)).toMatchObject({ sub: 'user_abc' })
    expect(api.calls).toEqual([{ url: 'https://api.clerk.com/v1/jwks', auth: 'Bearer sk_test_x' }])
    now += JWKS_TTL_MS - 1
    expect(await verifyClerkToken(await key.sign(), clerkEnv, keys)).toMatchObject({ sub: 'user_abc' })
    expect(api.calls).toHaveLength(1)
    // Past the TTL the set is fetched again.
    now += 2
    await verifyClerkToken(await key.sign(), clerkEnv, keys)
    expect(api.calls).toHaveLength(2)
  })

  it('an unknown key id refreshes the set at most once per retry window, and concurrent misses share it', async () => {
    const key = await signingKey()
    const api = jwks([key.jwk])
    let now = 5_000_000
    const keys = new ClerkKeys(api.fetcher, () => now)
    expect(await keys.key('ins_1', 'sk')).not.toBeNull()
    expect(api.calls).toHaveLength(1)
    // A forged token naming a key Clerk never had: one refresh, however many arrive at once...
    now += JWKS_RETRY_MS
    expect(await Promise.all([keys.key('ins_nope', 'sk'), keys.key('ins_nope2', 'sk')])).toEqual([null, null])
    expect(api.calls).toHaveLength(2)
    // ...and none more until the window has passed.
    now += JWKS_RETRY_MS - 1
    expect(await keys.key('ins_nope3', 'sk')).toBeNull()
    expect(api.calls).toHaveLength(2)
    now += 1
    expect(await keys.key('ins_nope3', 'sk')).toBeNull()
    expect(api.calls).toHaveLength(3)
    // A known key is still served while unknown ones are throttled.
    expect(await keys.key('ins_1', 'sk')).not.toBeNull()
    expect(api.calls).toHaveLength(3)
  })

  it('a Clerk outage keeps the keys it had, and is asked again only once a window', async () => {
    const key = await signingKey()
    const api = jwks([key.jwk])
    let now = 9_000_000
    const keys = new ClerkKeys(api.fetcher, () => now)
    expect(await keys.key('ins_1', 'sk')).not.toBeNull()
    api.answer(() => new Response('down', { status: 503 }))
    now += JWKS_TTL_MS
    // Stale, and the refresh failed: the old key still verifies.
    expect(await keys.key('ins_1', 'sk')).not.toBeNull()
    expect(api.calls).toHaveLength(2)
    now += 1000
    expect(await keys.key('ins_1', 'sk')).not.toBeNull()
    expect(api.calls).toHaveLength(2)
  })

  it('a token signed by a key outside the set is rejected', async () => {
    const ours = await signingKey()
    const forged = await signingKey()
    const keys = new ClerkKeys(jwks([ours.jwk]).fetcher, () => 0)
    await expect(verifyClerkToken(await forged.sign(), clerkEnv, keys)).rejects.toThrow()
  })
})

describe('azp', () => {
  it('a token minted for another site is rejected; ours, or none at all, is accepted', async () => {
    const key = await signingKey()
    const e = { ...testEnv, CLERK_JWT_KEY: key.pem } as unknown as Env
    expect(await resolveUser(bearer(await key.sign({ azp: 'https://evil.example' })), e)).toBeNull()
    expect(
      await resolveUser(
        bearer(await key.sign({ azp: 'https://gulabi-gali.manishbisht.me.evil.example' })),
        e,
      ),
    ).toBeNull()
    expect(
      await resolveUser(bearer(await key.sign({ azp: 'https://gulabi-gali.manishbisht.me' })), e),
    ).toEqual({
      id: 'clerk:user_abc',
    })
    expect(await resolveUser(bearer(await key.sign()), e)).toEqual({ id: 'clerk:user_abc' })
  })
})
