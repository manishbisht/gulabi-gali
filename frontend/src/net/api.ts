import type {
  AvatarLookWire,
  ChatError,
  ChatMessage,
  CitySnapshot,
  FullProfile,
  HereFor,
  HomeArea,
  MatchView,
  Me,
  MessagePage,
  RequestLists,
} from './protocol'

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

type RequestError = 'invalid' | 'ghost' | 'no-such-person' | 'already' | 'paused'
export type RequestOutcome =
  { ok: true; kind: 'sent' | 'matched' } | { ok: false; error: RequestError | 'failed' }

const REQUEST_ERRORS: readonly string[] = ['invalid', 'ghost', 'no-such-person', 'already', 'paused']

/** Asks someone to meet. Never rejects: a 201 is `sent`, a crossed request's 200 is `matched`, the rest a typed error. */
export async function sendMeetRequest(token: string, to: string, reason: string): Promise<RequestOutcome> {
  try {
    const res = await fetch(`${API_BASE}/api/requests`, {
      method: 'POST',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, reason }),
    })
    if (res.ok) return { ok: true, kind: res.status === 201 ? 'sent' : 'matched' }
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    const error = body?.error
    return { ok: false, error: error && REQUEST_ERRORS.includes(error) ? (error as RequestError) : 'failed' }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

const json = (token: string) => ({ ...bearer(token), 'Content-Type': 'application/json' })

export async function getRequests(token: string, signal?: AbortSignal): Promise<RequestLists> {
  const res = await fetch(`${API_BASE}/api/requests`, { headers: bearer(token), signal })
  if (!res.ok) throw new Error(`requests ${res.status}`)
  return (await res.json()) as RequestLists
}

/** The new match's id, or null when the request could not be accepted (gone, expired, not yours). Never rejects. */
export async function acceptRequest(token: string, id: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/requests/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      headers: bearer(token),
    })
    if (!res.ok) return null
    return ((await res.json()) as { matchId: string }).matchId
  } catch {
    return null
  }
}

/** Whether the request is now ignored. Never rejects. */
export async function ignoreRequest(token: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/requests/${encodeURIComponent(id)}/ignore`, {
      method: 'POST',
      headers: bearer(token),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function getMatches(token: string, signal?: AbortSignal): Promise<MatchView[]> {
  const res = await fetch(`${API_BASE}/api/matches`, { headers: bearer(token), signal })
  if (!res.ok) throw new Error(`matches ${res.status}`)
  return (await res.json()) as MatchView[]
}

/** The newest page, or the one before `before`. Null when the match is gone. Rejects on other failures. */
export async function getMessages(
  token: string,
  matchId: string,
  before?: string | null,
  signal?: AbortSignal,
): Promise<MessagePage | null> {
  const q = before ? `?before=${encodeURIComponent(before)}` : ''
  const res = await fetch(`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/messages${q}`, {
    headers: bearer(token),
    signal,
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`messages ${res.status}`)
  return (await res.json()) as MessagePage
}

export type SendResult = { ok: true; message: ChatMessage } | { ok: false; error: ChatError | 'failed' }

/** Never rejects: a 201 gives the message, the rest a typed error (`rate` is the one a person can wait out). */
export async function sendMessage(token: string, matchId: string, body: string): Promise<SendResult> {
  try {
    const res = await fetch(`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/messages`, {
      method: 'POST',
      headers: json(token),
      body: JSON.stringify({ body }),
    })
    if (res.ok) return { ok: true, message: (await res.json()) as ChatMessage }
    const err = ((await res.json().catch(() => null)) as { error?: string } | null)?.error
    return { ok: false, error: err === 'rate' || err === 'not-found' || err === 'invalid' ? err : 'failed' }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

/** True once the match is gone: an unmatch, or one the other side made first (404). Never rejects. */
export async function unmatch(token: string, matchId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/matches/${encodeURIComponent(matchId)}`, {
      method: 'DELETE',
      headers: bearer(token),
    })
    return res.ok || res.status === 404
  } catch {
    return false
  }
}
