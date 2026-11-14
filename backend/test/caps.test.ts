import { applyD1Migrations, env, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MAX_IP_SOCKETS, ipKey } from '../src/district'
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

/** Runs `fn` with `vars` set on the district object's env, then puts its env back. */
async function withVars(district: DistrictId, vars: Partial<Env>, fn: () => Promise<void>) {
  let real: Env | undefined
  await runInDurableObject(stub(district), (instance) => {
    const held = instance as unknown as { env: Env }
    real = held.env
    held.env = { ...held.env, ...vars }
  })
  try {
    await fn()
  } finally {
    await runInDurableObject(stub(district), (instance) => {
      const held = instance as unknown as { env: Env }
      held.env = {
        ...held.env,
        ...Object.fromEntries(Object.keys(vars).map((k) => [k, real![k as keyof Env]])),
      }
    })
  }
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

  it(`the per-address cap is ${DEFAULT_MAX_IP_SOCKETS} unless MAX_IP_SOCKETS says, with IPv6 counted by /64`, () => {
    expect(DEFAULT_MAX_IP_SOCKETS).toBe(24)
    expect(testEnv.MAX_IP_SOCKETS).toBe('24')
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7')
    expect(ipKey('::ffff:203.0.113.7')).toBe('203.0.113.7')
    for (const same of ['2001:db8:1:2::a', '2001:DB8:1:2:ffff::b', '2001:0db8:0001:0002:0:0:0:c'])
      expect(ipKey(same)).toBe('2001:db8:1:2::/64')
    expect(ipKey('2001:db8:1:3::a')).toBe('2001:db8:1:3::/64')
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
  })

  it('at most MAX_IP_SOCKETS live sockets per address per district', async () => {
    await withVars('mi-road', { MAX_IP_SOCKETS: '3' }, async () => {
      const ip = { 'CF-Connecting-IP': '203.0.113.7' }
      const three = []
      for (let i = 0; i < 3; i++) {
        const k = await knock('mi-road', ip)
        expect(k.heard[0]?.t).toBe('welcome')
        three.push(k)
      }
      await turnedAway(await knock('mi-road', ip))
      // Residents count like ghosts.
      await turnedAway(await knock('mi-road', ip, await resident('Ip Isha')))
      // Another address is its own count.
      expect((await knock('mi-road', { 'CF-Connecting-IP': '203.0.113.8' })).heard[0]?.t).toBe('welcome')
      // A place frees up when one closes.
      three[0]!.ws.close(1000)
      await vi.waitFor(async () => {
        const k = await knock('mi-road', ip)
        expect(k.heard[0]?.t).toBe('welcome')
        three.push(k)
      }, WAIT)
      for (const k of three) k.ws.close(1000)
    })
    // The same address in another district is its own count too (default cap there).
    expect((await knock('walled-city', { 'CF-Connecting-IP': '203.0.113.7' })).heard[0]?.t).toBe('welcome')
  })

  it('IPv6 addresses count by their /64, however they are written', async () => {
    await withVars('university', { MAX_IP_SOCKETS: '2' }, async () => {
      const at = (ip: string) => knock('university', { 'CF-Connecting-IP': ip })
      const a = await at('2001:db8:1:2::a')
      const b = await at('2001:db8:1:2:ffff::b')
      expect([a.heard[0]?.t, b.heard[0]?.t]).toEqual(['welcome', 'welcome'])
      await turnedAway(await at('2001:0DB8:0001:0002:0:0:0:c'))
      const next = await at('2001:db8:1:3::a')
      expect(next.heard[0]?.t).toBe('welcome')
      for (const k of [a, b, next]) k.ws.close(1000)
    })
  })

  it('loopback (local dev and the stress script) is not capped per address', async () => {
    await withVars('malviya-nagar', { MAX_IP_SOCKETS: '2' }, async () => {
      const all = []
      for (let i = 0; i < 3; i++) {
        const k = await knock('malviya-nagar', { 'CF-Connecting-IP': '127.0.0.1' })
        expect(k.heard[0]?.t).toBe('welcome')
        all.push(k)
      }
      for (const k of all) k.ws.close(1000)
    })
  })

  it('a connect over a cap is told full without asking D1, even while D1 is down', async () => {
    const district = stub('walled-city')
    await withVars('walled-city', { MAX_IP_SOCKETS: '1' }, async () => {
      const ip = { 'CF-Connecting-IP': '198.51.100.20' }
      const token = await resident('Outage Om')
      const first = await knock('walled-city', ip)
      expect(first.heard[0]?.t).toBe('welcome')
      let asked = 0
      const down = {
        prepare: () => ({ bind: () => ({}) }),
        batch: () => {
          asked++
          return Promise.reject(new Error('d1 down'))
        },
      }
      let real: unknown
      await runInDurableObject(district, (instance) => {
        const held = instance as unknown as { env: Env; warm: boolean }
        real = held.env
        held.env = { ...held.env, DB: down as unknown as D1Database }
        // As after a wake: nothing loaded yet.
        held.warm = false
      })
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await turnedAway(await knock('walled-city', ip))
        await turnedAway(await knock('walled-city', ip, token))
        expect(asked).toBe(0)
      } finally {
        logged.mockRestore()
        await runInDurableObject(district, (instance) => {
          ;(instance as unknown as { env: unknown }).env = real
        })
      }
      first.ws.close(1000)
    })
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
