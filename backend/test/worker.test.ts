import { applyD1Migrations, createExecutionContext, env, SELF, waitOnExecutionContext } from 'cloudflare:test'
import { beforeAll, expect, it } from 'vitest'
import worker, { handleCity, refreshCity } from '../src/index'
import type { CitySnapshot } from '../src/protocol'

beforeAll(async () => {
  await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: never }).TEST_MIGRATIONS)
})

const stored: CitySnapshot = {
  fetchedAt: '2026-11-14T06:30:00.000Z',
  tempC: 30,
  condition: 'clear',
  aqi: 80,
  aqiBand: 'moderate',
  sunrise: '2026-11-14T01:14:00.000Z',
  sunset: '2026-11-14T12:04:00.000Z',
  festival: null,
  stale: false,
}
const rejecting = (async () => {
  throw new Error('offline')
}) as unknown as typeof fetch

it('answers /health', async () => {
  const res = await SELF.fetch('https://api.test/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

it('allows the production site and local dev origins only', async () => {
  for (const origin of [
    'https://gulabi-gali.manishbisht.me',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ]) {
    const res = await SELF.fetch('https://api.test/health', { headers: { Origin: origin } })
    expect(res.headers.get('access-control-allow-origin')).toBe(origin)
  }
  for (const origin of ['https://evil.example', 'https://jaipur.manishbisht.me']) {
    const res = await SELF.fetch('https://api.test/health', { headers: { Origin: origin } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  }
})

it('404s unknown paths as JSON', async () => {
  const res = await SELF.fetch('https://api.test/nope')
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'not found' })
})

it('serves the stored snapshot', async () => {
  const fresh = { ...stored, fetchedAt: new Date().toISOString() }
  await env.CITY.put('now', JSON.stringify(fresh))
  const res = await SELF.fetch('https://api.test/api/city')
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('public, max-age=300')
  expect(await res.json()).toEqual(fresh)
})

it('serves a default snapshot when upstream fails', async () => {
  await env.CITY.delete('now')
  const res = await handleCity(env, rejecting, new Date('2026-11-14T06:30:00Z'))
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('public, max-age=300')
  expect(((await res.json()) as CitySnapshot).stale).toBe(true)
})

it('refreshCity stores to KV', async () => {
  await env.CITY.delete('now')
  const fake = (async (input: RequestInfo | URL) =>
    String(input).includes('air-quality')
      ? Response.json({ current: { us_aqi: 50, dust: 10 } })
      : Response.json({
          current: { temperature_2m: 25, weather_code: 0, precipitation: 0 },
          daily: { sunrise: ['2026-11-14T06:44'], sunset: ['2026-11-14T17:34'] },
        })) as typeof fetch
  const snap = await refreshCity(env, fake, new Date('2026-11-14T06:30:00Z'))
  expect(JSON.parse((await env.CITY.get('now'))!)).toEqual(snap)
})

it('treats malformed JSON in KV as a cache miss', async () => {
  await env.CITY.put('now', '{not json')
  const res = await handleCity(env, rejecting, new Date('2026-11-14T06:30:00Z'))
  expect(res.status).toBe(200)
  expect(((await res.json()) as CitySnapshot).stale).toBe(true)
})

it('still serves the live snapshot when the KV write fails', async () => {
  await env.CITY.delete('now')
  const fake = (async (input: RequestInfo | URL) =>
    String(input).includes('air-quality')
      ? Response.json({ current: { us_aqi: 50, dust: 10 } })
      : Response.json({
          current: { temperature_2m: 25, weather_code: 0, precipitation: 0 },
          daily: { sunrise: ['2026-11-14T06:44'], sunset: ['2026-11-14T17:34'] },
        })) as typeof fetch
  const brokenEnv = {
    CITY: {
      get: () => Promise.resolve(null),
      put: () => Promise.reject(new Error('kv down')),
    },
  } as unknown as typeof env
  const res = await handleCity(brokenEnv, fake, new Date('2026-11-14T06:30:00Z'))
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ stale: false, tempC: 25 })
})

const live = (async (input: RequestInfo | URL) =>
  String(input).includes('air-quality')
    ? Response.json({ current: { us_aqi: 50, dust: 10 } })
    : Response.json({
        current: { temperature_2m: 25, weather_code: 0, precipitation: 0 },
        daily: { sunrise: ['2026-11-14T06:44'], sunset: ['2026-11-14T17:34'] },
      })) as typeof fetch

/** A KV whose puts are recorded, so a test can see the options they carried. */
function recordingEnv(initial: string | null = null) {
  const puts: { value: string; options: unknown }[] = []
  const kv = {
    get: () => Promise.resolve(initial ? JSON.parse(initial) : null),
    put: (_key: string, value: string, options?: unknown) => (
      puts.push({ value, options }),
      Promise.resolve()
    ),
  }
  return { puts, env: { CITY: kv } as unknown as typeof env }
}

it('does not serve a snapshot older than 2 hours as live', async () => {
  const old = { ...stored, fetchedAt: '2026-11-13T06:30:00.000Z', tempC: 99 }
  await env.CITY.put('now', JSON.stringify(old))
  const res = await handleCity(env, live, new Date('2026-11-14T06:30:00Z'))
  expect(await res.json()).toMatchObject({ stale: false, tempC: 25 })
})

it('falls back to the default, not the old snapshot, when it is old and upstream fails', async () => {
  const old = { ...stored, fetchedAt: '2026-11-13T06:30:00.000Z', tempC: 99 }
  await env.CITY.put('now', JSON.stringify(old))
  const res = await handleCity(env, rejecting, new Date('2026-11-14T06:30:00Z'))
  expect(await res.json()).toMatchObject({ stale: true, tempC: null })
})

it('still serves a snapshot under 2 hours old', async () => {
  const recent = { ...stored, fetchedAt: '2026-11-14T05:00:00.000Z' }
  await env.CITY.put('now', JSON.stringify(recent))
  const res = await handleCity(env, rejecting, new Date('2026-11-14T06:30:00Z'))
  expect(await res.json()).toEqual(recent)
})

it('puts snapshots in KV with a 3 hour expirationTtl, from the cron and from a request', async () => {
  const cron = recordingEnv()
  await refreshCity(cron.env, live, new Date('2026-11-14T06:30:00Z'))
  expect(cron.puts[0].options).toEqual({ expirationTtl: 3 * 3600 })
  const request = recordingEnv()
  await handleCity(request.env, live, new Date('2026-11-14T06:30:00Z'))
  expect(request.puts[0].options).toEqual({ expirationTtl: 3 * 3600 })
})

it('gives the default snapshot when upstream hangs, within the timeout', async () => {
  await env.CITY.delete('now')
  const hung = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
    )) as typeof fetch
  const started = Date.now()
  const res = await handleCity(env, hung, new Date('2026-11-14T06:30:00Z'), null, 50)
  expect(Date.now() - started).toBeLessThan(2000)
  expect(((await res.json()) as CitySnapshot).stale).toBe(true)
})

it('the scheduled handler refreshes KV, and purges held evidence and counters past their time', async () => {
  await env.CITY.delete('now')
  const day = 24 * 3600 * 1000
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO held_evidence (id, owner, other, match_id, messages, created_at) VALUES (?, 'dev:x', 'dev:y', ?, '[]', ?)",
    ).bind('held-old', 'm-old', Date.now() - 31 * day),
    env.DB.prepare(
      "INSERT INTO held_evidence (id, owner, other, match_id, messages, created_at) VALUES (?, 'dev:x', 'dev:y', ?, '[]', ?)",
    ).bind('held-new', 'm-new', Date.now() - 29 * day),
    env.DB.prepare(
      "INSERT INTO counters (user_id, bucket, window_start, n) VALUES ('dev:x', 'reads', ?, 3)",
    ).bind(Date.now() - 3 * day),
  ])
  const realFetch = globalThis.fetch
  globalThis.fetch = live
  try {
    const ctx = createExecutionContext()
    await worker.scheduled!({} as ScheduledController, env, ctx)
    await waitOnExecutionContext(ctx)
  } finally {
    globalThis.fetch = realFetch
  }
  expect(JSON.parse((await env.CITY.get('now'))!)).toMatchObject({ stale: false, tempC: 25 })
  const { results } = await env.DB.prepare('SELECT id FROM held_evidence').all<{ id: string }>()
  expect(results.map((r) => r.id)).toEqual(['held-new'])
  expect(await env.DB.prepare("SELECT 1 FROM counters WHERE user_id = 'dev:x'").first()).toBeNull()
})
