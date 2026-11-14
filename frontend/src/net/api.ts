import type { CitySnapshot } from './protocol'

export const API_BASE: string = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8787'

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** Local mirror of the backend's default snapshot, used when the API cannot be reached. */
export function fallbackSnapshot(now: Date): CitySnapshot {
  const day = new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
  const ist = (time: string) => new Date(`${day}T${time}+05:30`).toISOString()
  return {
    fetchedAt: now.toISOString(),
    tempC: null,
    condition: 'clear',
    aqi: null,
    aqiBand: 'moderate',
    sunrise: ist('06:30:00'),
    sunset: ist('18:00:00'),
    festival: null,
    stale: true,
  }
}

/** Never rejects: any failure yields the stale default. */
export async function fetchCity(signal?: AbortSignal): Promise<CitySnapshot> {
  try {
    const res = await fetch(`${API_BASE}/api/city`, { signal })
    if (!res.ok) return fallbackSnapshot(new Date())
    return (await res.json()) as CitySnapshot
  } catch {
    return fallbackSnapshot(new Date())
  }
}
