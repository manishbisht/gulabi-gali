import { env } from 'cloudflare:test'
import { signJwt } from '@clerk/backend/jwt'
import { describe, expect, it } from 'vitest'
import { resolveUser } from '../src/auth'
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
  return { pem, sign }
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
