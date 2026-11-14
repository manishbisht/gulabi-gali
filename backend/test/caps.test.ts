import { applyD1Migrations, env, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MAX_SOCKETS_PER_IP } from '../src/district'
import type { Env } from '../src/env'
import { allow, READ_LIMIT, windowStart } from '../src/limits'
import { LIVE_CLOSE, type DistrictId, type ServerMsg } from '../src/protocol'
import { api, closeAll, devId, openLive, resident, WAIT } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const stub = (id: DistrictId) => testEnv.DISTRICT.get(testEnv.DISTRICT.idFromName(id))

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

afterEach(() => closeAll())

/** A socket that may be turned away: what it heard and how it closed. */
async function knock(district: DistrictId, headers: Record<string, string> = {}, token?: string) {
  const res = await openLive(district, { headers, token })
  expect(res.status).toBe(101)
  const ws = res.webSocket!
  const heard: ServerMsg[] = []
  const closes: number[] = []
  ws.addEventListener('message', (e) => {
    heard.push(JSON.parse(e.data as string))
  })
  ws.addEventListener('close', (e) => {
    closes.push(e.code)
  })
  ws.accept()
  await vi.waitFor(() => expect(heard.length + closes.length).toBeGreaterThan(0), WAIT)
  return { ws, heard, closes }
}

const turnedAway = async (k: Awaited<ReturnType<typeof knock>>) => {
  await vi.waitFor(() => expect(k.closes).toEqual([LIVE_CLOSE.full]), WAIT)
  expect(k.heard).toEqual([{ t: 'error', code: 'full' }])
}

describe('socket caps', () => {
  it('a district takes at most MAX_DISTRICT_SOCKETS, ghosts and residents alike', async () => {
    const district = stub('university')
    // The cap, set just above whatever this object already holds.
    await runInDurableObject(district, (instance, state) => {
      const open = state
        .getWebSockets()
        .filter((ws) => !(ws.deserializeAttachment() as { closed?: boolean } | null)?.closed).length
      const held = instance as unknown as { env: Env }
      held.env = { ...held.env, MAX_DISTRICT_SOCKETS: String(open + 2) }
    })
    try {
      const token = await resident('Cap Kavya')
      const first = await knock('university', {}, token)
      expect(first.heard[0]?.t).toBe('welcome')
      const ghost = await knock('university')
      expect(ghost.heard[0]?.t).toBe('welcome')
      // Full: a ghost and a resident are both turned away.
      await turnedAway(await knock('university'))
      await turnedAway(await knock('university', {}, await resident('Cap Kunal')))
      // Someone already in, reconnecting, takes their own place.
      const again = await knock('university', {}, token)
      expect(again.heard[0]).toMatchObject({ t: 'welcome', you: { id: devId('Cap Kavya') } })
      // One leaves: the next one gets in.
      ghost.ws.close(1000)
      await vi.waitFor(async () => {
        const next = await knock('university')
        expect(next.heard[0]?.t).toBe('welcome')
      }, WAIT)
      for (const k of [first, again]) k.ws.close(1000)
    } finally {
      await runInDurableObject(district, (instance) => {
        const held = instance as unknown as { env: Env }
        held.env = { ...held.env, MAX_DISTRICT_SOCKETS: undefined }
      })
    }
  })

  it(`at most ${MAX_SOCKETS_PER_IP} live sockets per IP per district`, async () => {
    const ip = { 'CF-Connecting-IP': '203.0.113.7' }
    const six = []
    for (let i = 0; i < MAX_SOCKETS_PER_IP; i++) {
      const k = await knock('mi-road', ip)
      expect(k.heard[0]?.t).toBe('welcome')
      six.push(k)
    }
    await turnedAway(await knock('mi-road', ip))
    // Another IP, and the same IP in another district, are their own counts.
    expect((await knock('mi-road', { 'CF-Connecting-IP': '203.0.113.8' })).heard[0]?.t).toBe('welcome')
    expect((await knock('walled-city', ip)).heard[0]?.t).toBe('welcome')
    // A place frees up when one closes.
    six[0]!.ws.close(1000)
    await vi.waitFor(async () => {
      const k = await knock('mi-road', ip)
      expect(k.heard[0]?.t).toBe('welcome')
      six.push(k)
    }, WAIT)
    for (const k of six) k.ws.close(1000)
  })

  it('loopback (local dev and the stress script) is not capped per IP', async () => {
    const all = []
    for (let i = 0; i <= MAX_SOCKETS_PER_IP; i++) {
      const k = await knock('malviya-nagar', { 'CF-Connecting-IP': '127.0.0.1' })
      expect(k.heard[0]?.t).toBe('welcome')
      all.push(k)
    }
    for (const k of all) k.ws.close(1000)
  })

  it('residents count against their IP like ghosts', async () => {
    const ip = { 'CF-Connecting-IP': '198.51.100.20' }
    const socks = []
    for (let i = 0; i < MAX_SOCKETS_PER_IP - 1; i++) socks.push(await knock('walled-city', ip))
    const resident6 = await knock('walled-city', ip, await resident('Ip Isha'))
    expect(resident6.heard[0]).toMatchObject({ t: 'welcome', you: { visible: true } })
    await turnedAway(await knock('walled-city', ip, await resident('Ip Ishaan')))
    for (const k of [...socks, resident6]) k.ws.close(1000)
  })
})

describe('read limits', () => {
  it('allow() counts per user and bucket, in fixed windows', async () => {
    const t = windowStart(Date.now(), 60_000) + 1000
    for (let i = 0; i < 3; i++)
      expect(await allow(testEnv, 'dev:counted', 'test', 3, 60_000, t + i)).toBe(true)
    expect(await allow(testEnv, 'dev:counted', 'test', 3, 60_000, t + 10)).toBe(false)
    expect(await allow(testEnv, 'dev:counted', 'other', 3, 60_000, t + 10)).toBe(true)
    expect(await allow(testEnv, 'dev:someone-else', 'test', 3, 60_000, t + 10)).toBe(true)
    // The next window starts afresh.
    expect(await allow(testEnv, 'dev:counted', 'test', 3, 60_000, t + 60_000)).toBe(true)
  })

  it(`GET /api/profiles/:id and GET /api/requests allow ${READ_LIMIT.perWindow} a minute per user`, async () => {
    const reader = await resident('Reader Ruchi')
    const other = await resident('Reader Ravi')
    // Spend the allowance for this minute and the next (in case the clock turns mid-test).
    const now = Date.now()
    for (const bucket of Object.values(READ_LIMIT.buckets))
      for (const start of [
        windowStart(now, READ_LIMIT.windowMs),
        windowStart(now, READ_LIMIT.windowMs) + 60_000,
      ])
        await testEnv.DB.prepare(
          'INSERT INTO counters (user_id, bucket, window_start, n) VALUES (?, ?, ?, ?)',
        )
          .bind(devId('Reader Ruchi'), bucket, start, READ_LIMIT.perWindow)
          .run()
    const profile = (name: string) => `/api/profiles/${encodeURIComponent(devId(name))}`
    for (const [mine, theirs] of [
      [profile('Reader Ravi'), profile('Reader Ruchi')],
      ['/api/requests', '/api/requests'],
    ] as const) {
      const res = await api(mine, reader)
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({ error: 'rate' })
      const after = Number(res.headers.get('Retry-After'))
      expect(after).toBeGreaterThanOrEqual(1)
      expect(after).toBeLessThanOrEqual(60)
      // Someone else reads on.
      expect((await api(theirs, other)).status).toBe(200)
    }
  })
})
