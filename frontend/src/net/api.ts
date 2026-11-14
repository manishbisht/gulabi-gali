import type { AvatarLookWire, CitySnapshot, FullProfile, HereFor, HomeArea, Me } from './protocol'

export const API_BASE: string = (import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')

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

export interface ProfileInput {
  name: string
  look: AvatarLookWire
  status: string
  homeArea: HomeArea
  hereFor: HereFor | null
  about: string
  link: string | null
  adult: boolean
  pledge: boolean
  pauseRequests: boolean
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

export async function getMe(token: string, signal?: AbortSignal): Promise<Me> {
  const res = await fetch(`${API_BASE}/api/me`, { headers: bearer(token), signal })
  if (!res.ok) throw new Error(`me ${res.status}`)
  return (await res.json()) as Me
}

export type SaveResult = { ok: true; me: Me } | { ok: false; fields: string[] }

/** A 400 gives the offending fields; any other failure rejects. */
export async function putProfile(token: string, input: ProfileInput): Promise<SaveResult> {
  const res = await fetch(`${API_BASE}/api/me/profile`, {
    method: 'PUT',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as { fields?: string[] } | null
    return { ok: false, fields: body?.fields ?? [] }
  }
  if (!res.ok) throw new Error(`profile ${res.status}`)
  return { ok: true, me: (await res.json()) as Me }
}

export async function getProfile(
  token: string,
  id: string,
  signal?: AbortSignal,
): Promise<FullProfile | null> {
  const res = await fetch(`${API_BASE}/api/profiles/${encodeURIComponent(id)}`, {
    headers: bearer(token),
    signal,
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`profile ${res.status}`)
  return (await res.json()) as FullProfile
}
