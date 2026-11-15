import { applyD1Migrations, env, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { COUNT_CACHE_S, COUNT_FLOOR, countKey, roundCount } from '../src/count'
import type { Env } from '../src/env'
import { GATE_NAME } from '../src/gate'
import worker from '../src/index'
import type { CityCount, DistrictId } from '../src/protocol'
import { devId, live, login, resident, settle, WAIT, type LiveClient } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const API = 'https://api.test'
const gate = () => testEnv.GATE.get(testEnv.GATE.idFromName(GATE_NAME))

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

// Each test asks the gate afresh: no edge copy from the one before.
beforeEach(() => caches.default.delete(countKey(testEnv, API)))

afterEach(async () => {
  await settle()
  await gate().configure({ maxLive: null, clear: true })
})

/** A resident who has stepped into `where`, as `token` or as a new person. */
async function walker(name: string, where: DistrictId, token?: string): Promise<LiveClient> {
  const c = await live(where, { token: token ?? (await resident(name)) })
  c.send({ t: 'move', x: 1, z: 1, ry: 0 })
  await c.sync()
  return c
}

const count = async (init?: RequestInit) => {
  const res = await SELF.fetch(`${API}/api/count`, init)
  return { res, body: res.ok ? ((await res.json()) as CityCount) : null }
}

describe('roundCount: what the welcome screen may say', () => {
  it('collapses anything below three into "quiet" (0)', () => {
    expect(COUNT_FLOOR).toBe(3)
    for (const n of [0, 1, 2]) expect(roundCount(n)).toBe(0)
  })

  it('says three to nine as they are, and rounds ten and up down to a multiple of five', () => {
    for (const n of [3, 4, 9]) expect(roundCount(n)).toBe(n)
    expect(roundCount(10)).toBe(10)
    expect(roundCount(14)).toBe(10)
    expect(roundCount(15)).toBe(15)
    expect(roundCount(23)).toBe(20)
    expect(roundCount(301)).toBe(300)
  })
})

describe('GET /api/count', () => {
  it('counts visible residents only: never a ghost, someone hidden, someone waiting in line, or a hold', async () => {
    await gate().configure({ maxLive: 4, clear: true })
    await walker('Count Asha', 'walled-city')
    await walker('Count Bela', 'mi-road')
    await walker('Count Chand', 'university')
    // Signed out: a ghost.
    await live('walled-city')
    // Signed in with no profile: a ghost too.
    await live('mi-road', { token: await login('Count Half') })
    // Hidden before connecting: a ghost to everyone.
    const hiddenToken = await resident('Count Hidden')
    await testEnv.DB.prepare('UPDATE users SET hidden = 1 WHERE id = ?').bind(devId('Count Hidden')).run()
    await live('walled-city', { token: hiddenToken })
    // A fourth resident fills the cap, then leaves: a hold for HOLD_MS, still not someone on the street.
    const gone = await walker('Count Gone', 'university')
    gone.close()
    await vi.waitFor(async () => expect(await gate().stats()).toEqual({ live: 4, queue: 0 }), WAIT)
    expect(await gate().visible()).toBe(3)
    // Over the cap: waits in line as a ghost.
    await gate().configure({ maxLive: 3 })
    const waiting = await walker('Count Wait', 'mi-road')
    expect((await waiting.next('welcome')).you.queued).toBe(1)

    const { res, body } = await count()
    expect(res.status).toBe(200)
    expect(body).toEqual({ people: 3 })
  })

  it('says nothing about one or two people: below three it is quiet (0)', async () => {
    await walker('Pair Pari', 'walled-city')
    await walker('Pair Qasim', 'university')
    expect(await gate().visible()).toBe(2)
    expect((await count()).body).toEqual({ people: 0 })
  })

  it('carries no names, ids or districts: just the number', async () => {
    for (const name of ['Plain Ria', 'Plain Sahil', 'Plain Tara']) await walker(name, 'walled-city')
    const text = await (await SELF.fetch(`${API}/api/count`)).text()
    expect(JSON.parse(text)).toEqual({ people: 3 })
    expect(text).not.toMatch(/Plain|dev:|walled/)
  })

  it('is cached at the edge for 30 s: one gate read serves everyone meanwhile; browsers keep no copy', async () => {
    expect(COUNT_CACHE_S).toBe(30)
    for (const name of ['Cache Uma', 'Cache Veer', 'Cache Wasim']) await walker(name, 'walled-city')
    const first = await count({ headers: { Origin: 'https://gulabi-gali.manishbisht.me' } })
    expect(first.body).toEqual({ people: 3 })
    expect(first.res.headers.get('cache-control')).toBe('no-store')
    expect(first.res.headers.get('access-control-allow-origin')).toBe('https://gulabi-gali.manishbisht.me')
    const stored = await vi.waitFor(async () => {
      const hit = await caches.default.match(countKey(testEnv, API))
      expect(hit).toBeDefined()
      return hit!
    }, WAIT)
    expect(stored.headers.get('cache-control')).toBe(`public, max-age=${COUNT_CACHE_S}`)
    // A fourth arrives: the edge copy still says three until it runs out.
    await walker('Cache Xenia', 'mi-road')
    expect((await count()).body).toEqual({ people: 3 })
    await caches.default.delete(countKey(testEnv, API))
    expect((await count()).body).toEqual({ people: 4 })
  })

  it('is rate-limited per address (COUNT_LIMITER), before the cache or the gate is asked', async () => {
    const seen: string[] = []
    const refusing = {
      limit: async ({ key }: { key: string }) => (seen.push(key), { success: false }),
    } as RateLimit
    const res = await worker.fetch(
      new Request(`${API}/api/count`, { headers: { 'CF-Connecting-IP': '203.0.113.70' } }),
      { ...testEnv, COUNT_LIMITER: refusing },
    )
    expect(res.status).toBe(429)
    expect(seen).toEqual(['203.0.113.70'])
  })

  it('only answers GET: any other method is just an unknown, signed-out API call', async () => {
    const res = await SELF.fetch(`${API}/api/count`, { method: 'POST' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('a gate that cannot be asked is a 503, and nothing is cached', async () => {
    const broken = {
      ...testEnv,
      GATE: {
        idFromName: () => ({}),
        get: () => ({
          visible: async () => {
            throw new Error('gate down')
          },
        }),
      },
    } as unknown as Env
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await worker.fetch(new Request(`${API}/api/count`), broken)
    err.mockRestore()
    expect(res.status).toBe(503)
    expect(await caches.default.match(countKey(testEnv, API))).toBeUndefined()
  })
})
