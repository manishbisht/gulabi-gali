import { env, SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { handleCity, refreshCity } from '../src/index'
import type { CitySnapshot } from '../src/protocol'

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
  for (const origin of ['https://jaipur.manishbisht.me', 'http://127.0.0.1:5173', 'http://localhost:5173']) {
    const res = await SELF.fetch('https://api.test/health', { headers: { Origin: origin } })
    expect(res.headers.get('access-control-allow-origin')).toBe(origin)
  }
  const evil = await SELF.fetch('https://api.test/health', { headers: { Origin: 'https://evil.example' } })
  expect(evil.headers.get('access-control-allow-origin')).toBeNull()
})

it('404s unknown paths as JSON', async () => {
  const res = await SELF.fetch('https://api.test/nope')
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'not found' })
})

it('serves the stored snapshot', async () => {
  await env.CITY.put('now', JSON.stringify(stored))
  const res = await SELF.fetch('https://api.test/api/city')
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('public, max-age=300')
  expect(await res.json()).toEqual(stored)
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
