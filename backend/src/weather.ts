import { festivalOn, istDay } from './festivals'
import type { AqiBand, CitySnapshot, Condition } from './protocol'

export const JAIPUR = { lat: 26.9124, lon: 75.7873 }

const DUST_THRESHOLD = 150 // ug/m3

export function toCondition(
  weatherCode: number,
  dustUgM3: number | null,
  precipitationMm: number,
): Condition {
  if (weatherCode >= 95 && weatherCode <= 99) return 'storm'
  if ((weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 82)) return 'rain'
  if (weatherCode === 45 || weatherCode === 48) return 'fog'
  if (dustUgM3 !== null && dustUgM3 >= DUST_THRESHOLD && precipitationMm === 0) return 'dust'
  if (weatherCode <= 1) return 'clear'
  return 'cloudy'
}

export function toAqiBand(aqi: number | null): AqiBand {
  if (aqi === null) return 'moderate'
  if (aqi <= 50) return 'good'
  if (aqi <= 100) return 'moderate'
  if (aqi <= 150) return 'poor'
  if (aqi <= 200) return 'unhealthy'
  return 'severe'
}

const istToIso = (local: string): string => new Date(`${local}+05:30`).toISOString()

export function defaultSnapshot(now: Date): CitySnapshot {
  const day = istDay(now)
  return {
    fetchedAt: now.toISOString(),
    tempC: null,
    condition: 'clear',
    aqi: null,
    aqiBand: toAqiBand(null),
    sunrise: istToIso(`${day}T06:30:00`),
    sunset: istToIso(`${day}T18:00:00`),
    festival: festivalOn(now),
    stale: true,
  }
}

interface Forecast {
  current: { temperature_2m: number; weather_code: number; precipitation: number }
  daily: { sunrise: string[]; sunset: string[] }
}
interface Air {
  current: { us_aqi: number | null; dust: number | null }
}

const UPSTREAM_TIMEOUT_MS = 5000

async function getJson<T>(fetcher: typeof fetch, url: string, timeoutMs: number): Promise<T> {
  const res = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`)
  return (await res.json()) as T
}

export async function fetchSnapshot(
  fetcher: typeof fetch,
  now: Date,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
): Promise<CitySnapshot> {
  const { lat, lon } = JAIPUR
  const forecastUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,precipitation,weather_code&daily=sunrise,sunset&timezone=Asia%2FKolkata&forecast_days=1'
  const airUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    '&current=us_aqi,dust&timezone=Asia%2FKolkata'
  const [forecast, air] = await Promise.all([
    getJson<Forecast>(fetcher, forecastUrl, timeoutMs),
    getJson<Air>(fetcher, airUrl, timeoutMs),
  ])
  const aqi = air.current.us_aqi ?? null
  return {
    fetchedAt: now.toISOString(),
    tempC: forecast.current.temperature_2m ?? null,
    condition: toCondition(
      forecast.current.weather_code,
      air.current.dust ?? null,
      forecast.current.precipitation,
    ),
    aqi,
    aqiBand: toAqiBand(aqi),
    sunrise: istToIso(forecast.daily.sunrise[0]),
    sunset: istToIso(forecast.daily.sunset[0]),
    festival: festivalOn(now),
    stale: false,
  }
}
