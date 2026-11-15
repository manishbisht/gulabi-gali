import { applyD1Migrations, env, SELF } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import { ERROR_IP_LIMIT, ERROR_KEEP_MS, ERROR_LIMITS, purgeClientErrors } from '../src/errors'
import type { AdminErrorGroup, ClientErrorReport } from '../src/protocol'
import { api, login } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const API = 'https://api.test'

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})
beforeEach(async () => {
  await testEnv.DB.prepare('DELETE FROM client_errors').run()
})

const report = (over: Record<string, unknown> = {}): ClientErrorReport & Record<string, unknown> => ({
  msg: "TypeError: Cannot read properties of undefined (reading 'x')",
  stack: 'TypeError: at tick (https://gulabi-gali.manishbisht.me/assets/index-abc.js:1:2345)',
  where: 'error',
  ua: { device: 'mobile', app: 'instagram' },
  build: '35dce39',
  district: 'walled-city',
  ...over,
})

/** As `navigator.sendBeacon` sends it: text/plain, no token, from an address the edge names. */
const send = (body: unknown, ip?: string) =>
  SELF.fetch(`${API}/api/errors`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8', ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const rows = () =>
  testEnv.DB.prepare('SELECT * FROM client_errors ORDER BY id').all<Record<string, unknown>>()

describe('POST /api/errors', () => {
  it('stores one error without a sign-in and answers an empty 204', async () => {
    const res = await send(report())
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    const { results } = await rows()
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      msg: "TypeError: Cannot read properties of undefined (reading 'x')",
      place: 'error',
      ua: 'mobile/instagram',
      build: '35dce39',
      district: 'walled-city',
    })
    expect(typeof results[0]!.created_at).toBe('number')
    expect(results[0]!.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('cuts every field to size: the stack to 1 kB, the message to 300 characters', async () => {
    await send(report({ msg: 'm'.repeat(1500), stack: 's'.repeat(2000), build: 'b'.repeat(200) }))
    const [row] = (await rows()).results
    expect((row!.msg as string).length).toBe(ERROR_LIMITS.msg)
    expect((row!.stack as string).length).toBe(ERROR_LIMITS.stack)
    expect(ERROR_LIMITS.stack).toBe(1024)
    expect(row!.build).toBe('unknown') // not a short sha
  })

  it('keeps no query string, no email and nothing it was not asked for', async () => {
    await send(
      report({
        msg: 'failed https://api.gulabi-gali.manishbisht.me/api/districts/mi-road/live?token=SECRET#frag',
        stack: 'at https://x.test/a.js?v=1&who=me:1:2 by riya@example.in',
        userId: 'dev:someone',
        email: 'someone@example.in',
        name: 'Someone',
      }),
    )
    const [row] = (await rows()).results
    expect(row!.msg).toBe('failed https://api.gulabi-gali.manishbisht.me/api/districts/mi-road/live')
    expect(row!.stack).toBe('at https://x.test/a.js:1:2 by [email]')
    const all = JSON.stringify(row)
    for (const leak of ['SECRET', 'dev:someone', 'someone@example.in', 'Someone', 'riya'])
      expect(all).not.toContain(leak)
  })

  it('takes only the known kinds: anything else is unknown, and an unknown district is none', async () => {
    await send(report({ ua: { device: 'fridge', app: 'tiktok' }, district: 'atlantis' }))
    const [row] = (await rows()).results
    expect(row!.ua).toBe('unknown/other')
    expect(row!.district).toBeNull()
  })

  it('refuses a body that is not a report, or over 4 kB, and stores nothing', async () => {
    expect((await send('not json')).status).toBe(400)
    expect((await send(report({ where: 'somewhere' }))).status).toBe(400)
    expect((await send(report({ msg: '' }))).status).toBe(400)
    expect((await send(report({ msg: 42 }))).status).toBe(400)
    expect((await send(report({ stack: 'x'.repeat(5000) }))).status).toBe(400)
    expect((await rows()).results).toHaveLength(0)
  })

  it('counts 20 a minute from one address, then 429; another address is not held up', async () => {
    expect(ERROR_IP_LIMIT.perWindow).toBe(20)
    for (let i = 0; i < 20; i++) expect((await send(report(), '203.0.113.50')).status).toBe(204)
    const over = await send(report(), '203.0.113.50')
    expect(over.status).toBe(429)
    expect((await send(report(), '203.0.113.51')).status).toBe(204)
    expect((await rows()).results).toHaveLength(21)
  })

  it('groups the same error with different numbers under one fingerprint', async () => {
    await send(report({ msg: 'Chunk 12 failed after 300 ms' }))
    await send(report({ msg: 'Chunk 7 failed after 9 ms' }))
    await send(report({ msg: 'Chunk 7 failed after 9 ms', where: 'rejection' }))
    const { results } = await rows()
    expect(results[0]!.fingerprint).toBe(results[1]!.fingerprint)
    expect(results[2]!.fingerprint).not.toBe(results[0]!.fingerprint)
  })
})

describe('the purge', () => {
  it('deletes errors older than 14 days and keeps the rest', async () => {
    const now = Date.now()
    await send(report({ msg: 'kept' }))
    await send(report({ msg: 'old' }))
    await testEnv.DB.prepare("UPDATE client_errors SET created_at = ? WHERE msg = 'old'")
      .bind(now - ERROR_KEEP_MS - 60_000)
      .run()
    expect(ERROR_KEEP_MS).toBe(14 * 24 * 3600 * 1000)
    await purgeClientErrors(testEnv, now)
    expect((await rows()).results.map((r) => r.msg)).toEqual(['kept'])
  })
})

describe('GET /api/admin/errors', () => {
  it('is a plain 404 to anyone but an admin, signed in or not', async () => {
    expect((await SELF.fetch(`${API}/api/admin/errors`)).status).toBe(404)
    expect((await api('/api/admin/errors', await login('Not Owner'))).status).toBe(404)
  })

  it('lists the top fingerprints with count, last seen, a sample stack and the ua breakdown', async () => {
    for (let i = 0; i < 3; i++) await send(report({ msg: 'often 1' }))
    await send(report({ msg: 'often 2', ua: { device: 'desktop', app: 'other' }, stack: 'latest stack' }))
    await send(report({ msg: 'rare', where: 'webgl-lost', stack: null, district: null }))
    const res = await api('/api/admin/errors', await login('Owner'))
    expect(res.status).toBe(200)
    const groups = (await res.json()) as AdminErrorGroup[]
    expect(groups).toHaveLength(2)
    const [top, rare] = groups
    expect(top).toMatchObject({
      where: 'error',
      msg: 'often 2',
      count: 4,
      sample: { stack: 'latest stack', build: '35dce39', district: 'walled-city' },
      ua: { 'mobile/instagram': 3, 'desktop/other': 1 },
    })
    expect(top!.lastSeen).toBeGreaterThan(Date.now() - 60_000)
    expect(rare).toMatchObject({ where: 'webgl-lost', msg: 'rare', count: 1, ua: { 'mobile/instagram': 1 } })
    expect(rare!.sample.stack).toBeNull()
  })
})
