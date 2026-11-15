import { expect, it } from 'vitest'
import { fetchSnapshot, toAqiBand, toCondition } from '../src/weather'

it('maps WMO codes and dust to conditions', () => {
  expect(toCondition(0, 20, 0)).toBe('clear')
  expect(toCondition(3, 20, 0)).toBe('cloudy')
  expect(toCondition(45, 20, 0)).toBe('fog')
  expect(toCondition(61, 20, 2)).toBe('rain')
  expect(toCondition(95, 20, 5)).toBe('storm')
  expect(toCondition(1, 180, 0)).toBe('dust') // dust >= 150 ug/m3 and dry
  expect(toCondition(61, 180, 2)).toBe('rain') // rain beats dust
})

it('an unknown precipitation (null from the feed) reads as dry: dust still shows', () => {
  expect(toCondition(1, 180, null)).toBe('dust')
  expect(toCondition(1, 180, 0.4)).toBe('clear') // a little rain keeps the dust down
})

it('a non-OK answer from either endpoint is an error, not a snapshot', async () => {
  const json = {
    current: { temperature_2m: 31, weather_code: 0, precipitation: 0, us_aqi: 50, dust: 10 },
    daily: { sunrise: ['2026-11-14T06:44'], sunset: ['2026-11-14T17:34'] },
  }
  const now = new Date('2026-11-14T06:30:00Z')
  for (const failing of ['https://api.open-meteo.com/', 'https://air-quality-api.open-meteo.com/']) {
    const fake = (async (input: RequestInfo | URL) =>
      String(input).startsWith(failing)
        ? new Response('down', { status: 503 })
        : Response.json(json)) as typeof fetch
    await expect(fetchSnapshot(fake, now), failing).rejects.toThrow(/upstream 503/)
  }
})

it('bands US AQI', () => {
  expect([40, 90, 140, 190, 260, null].map(toAqiBand)).toEqual([
    'good',
    'moderate',
    'poor',
    'unhealthy',
    'severe',
    'moderate',
  ])
})

it('builds a snapshot from both Open-Meteo endpoints', async () => {
  const fake = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('https://api.open-meteo.com/')) {
      return Response.json({
        current: { temperature_2m: 31.4, weather_code: 0, precipitation: 0 },
        daily: { sunrise: ['2026-11-14T06:44'], sunset: ['2026-11-14T17:34'] },
      })
    }
    if (url.startsWith('https://air-quality-api.open-meteo.com/')) {
      return Response.json({ current: { us_aqi: 162, dust: 40 } })
    }
    throw new Error(`unexpected url ${url}`)
  }) as typeof fetch
  const s = await fetchSnapshot(fake, new Date('2026-11-14T06:30:00Z'))
  expect(s).toMatchObject({ tempC: 31.4, condition: 'clear', aqi: 162, aqiBand: 'unhealthy', stale: false })
  expect(s.sunrise).toBe('2026-11-14T01:14:00.000Z') // 06:44 IST
  expect(s.sunset).toBe('2026-11-14T12:04:00.000Z')
})

it('an upstream answer with the wrong shape is an error, not a snapshot', async () => {
  const good = {
    current: { temperature_2m: 31, weather_code: 0, precipitation: 0, us_aqi: 50, dust: 10 },
    daily: { sunrise: ['2026-11-14T06:44'], sunset: ['2026-11-14T17:34'] },
  }
  const now = new Date('2026-11-14T06:30:00Z')
  const serve = (forecast: unknown) =>
    (async (input: RequestInfo | URL) =>
      String(input).includes('air-quality') ? Response.json(good) : Response.json(forecast)) as typeof fetch
  await expect(fetchSnapshot(serve(good), now)).resolves.toMatchObject({ tempC: 31, stale: false })
  const bad = [
    { ...good, current: { ...good.current, weather_code: 'x' } },
    { ...good, current: { ...good.current, weather_code: null } },
    { ...good, daily: { sunrise: [], sunset: good.daily.sunset } },
    { ...good, daily: { sunrise: [5], sunset: good.daily.sunset } },
    { current: good.current },
  ]
  for (const b of bad) await expect(fetchSnapshot(serve(b), now), JSON.stringify(b)).rejects.toThrow(/shape/)
  // a junk temperature is dropped, not shown
  const junk = { ...good, current: { ...good.current, temperature_2m: 'hot' } }
  await expect(fetchSnapshot(serve(junk), now)).resolves.toMatchObject({ tempC: null })
})
