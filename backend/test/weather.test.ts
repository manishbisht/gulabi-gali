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
