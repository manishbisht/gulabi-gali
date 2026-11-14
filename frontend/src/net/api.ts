import type {
  AvatarLookWire,
  ChatError,
  ChatMessage,
  CitySnapshot,
  FullProfile,
  HereFor,
  HomeArea,
  InviteView,
  MatchView,
  Me,
  MessagePage,
  ReportInput,
  ReportResult,
  RequestLists,
} from './protocol'
import { fetchNoting } from './rateNotice'

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
    const res = await fetchNoting(`${API_BASE}/api/city`, { signal })
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
  /** Left out when the person did not touch it (the server keeps the stored one); null clears it. */
  link?: string | null
  adult: boolean
  pledge: boolean
  pauseRequests: boolean
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

export async function getMe(token: string, signal?: AbortSignal): Promise<Me> {
  const res = await fetchNoting(`${API_BASE}/api/me`, { headers: bearer(token), signal })
  if (!res.ok) throw new Error(`me ${res.status}`)
  return (await res.json()) as Me
}

/** `words`: the server's word filter refused one of `fields` (not a malformed field). */
export type SaveResult = { ok: true; me: Me } | { ok: false; fields: string[]; words?: true }

/** A 400 gives the offending fields; any other failure rejects. */
export async function putProfile(token: string, input: ProfileInput): Promise<SaveResult> {
  const res = await fetchNoting(`${API_BASE}/api/me/profile`, {
    method: 'PUT',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as {
      error?: string
      field?: string
      fields?: string[]
    } | null
    if (body?.error === 'words') return { ok: false, fields: body.field ? [body.field] : [], words: true }
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
  const res = await fetchNoting(`${API_BASE}/api/profiles/${encodeURIComponent(id)}`, {
    headers: bearer(token),
    signal,
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`profile ${res.status}`)
  return (await res.json()) as FullProfile
}

type RequestError = 'invalid' | 'ghost' | 'not-verified' | 'no-such-person' | 'already' | 'paused' | 'words'
export type RequestOutcome =
  { ok: true; kind: 'sent' | 'matched' } | { ok: false; error: RequestError | 'failed' }

const REQUEST_ERRORS: readonly string[] = [
  'invalid',
  'ghost',
  'not-verified',
  'no-such-person',
  'already',
  'paused',
  'words',
]

/** Asks someone to meet. Never rejects: a 201 is `sent`, a crossed request's 200 is `matched`, the rest a typed error. */
export async function sendMeetRequest(token: string, to: string, reason: string): Promise<RequestOutcome> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/requests`, {
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
  const res = await fetchNoting(`${API_BASE}/api/requests`, { headers: bearer(token), signal })
  if (!res.ok) throw new Error(`requests ${res.status}`)
  return (await res.json()) as RequestLists
}

/** The new match's id, or null when the request could not be accepted (gone, expired, not yours). Never rejects. */
export async function acceptRequest(token: string, id: string): Promise<string | null> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/requests/${encodeURIComponent(id)}/accept`, {
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
    const res = await fetchNoting(`${API_BASE}/api/requests/${encodeURIComponent(id)}/ignore`, {
      method: 'POST',
      headers: bearer(token),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function getMatches(token: string, signal?: AbortSignal): Promise<MatchView[]> {
  const res = await fetchNoting(`${API_BASE}/api/matches`, { headers: bearer(token), signal })
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
  const res = await fetchNoting(`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/messages${q}`, {
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
    return {
      ok: false,
      error: err === 'rate' || err === 'not-found' || err === 'invalid' || err === 'words' ? err : 'failed',
    }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

/** True once the match is gone: an unmatch, or one the other side made first (404). Never rejects. */
export async function unmatch(token: string, matchId: string): Promise<boolean> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/matches/${encodeURIComponent(matchId)}`, {
      method: 'DELETE',
      headers: bearer(token),
    })
    return res.ok || res.status === 404
  } catch {
    return false
  }
}

/** The caller's invite codes. Rejects on failure. */
export async function getInvites(token: string, signal?: AbortSignal): Promise<InviteView[]> {
  const res = await fetchNoting(`${API_BASE}/api/invites`, { headers: bearer(token), signal })
  if (!res.ok) throw new Error(`invites ${res.status}`)
  return ((await res.json()) as { codes: InviteView[] }).codes
}

export type RedeemError = 'bad-code' | 'used' | 'own-code' | 'already-verified' | 'rate' | 'failed'
export type RedeemResult = { ok: true; me: Me } | { ok: false; error: RedeemError }

const REDEEM_ERRORS: readonly string[] = ['bad-code', 'used', 'own-code', 'already-verified', 'rate']

/** Never rejects: the verified `Me`, or the typed reason the code did not work. */
export async function redeemInvite(token: string, code: string): Promise<RedeemResult> {
  try {
    const res = await fetch(`${API_BASE}/api/invites/redeem`, {
      method: 'POST',
      headers: json(token),
      body: JSON.stringify({ code }),
    })
    if (res.ok) return { ok: true, me: (await res.json()) as Me }
    const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error
    return { ok: false, error: error && REDEEM_ERRORS.includes(error) ? (error as RedeemError) : 'failed' }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

/** Blocks `id`: true once it is done (the server answers 204 whether or not they exist). Never rejects. */
export async function blockPerson(token: string, id: string): Promise<boolean> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/blocks`, {
      method: 'POST',
      headers: json(token),
      body: JSON.stringify({ id }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** True once `id` is no longer blocked. Never rejects. */
export async function unblockPerson(token: string, id: string): Promise<boolean> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/blocks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: bearer(token),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Someone the caller blocked: an id and the first name saved when they did (null: none was saved). */
export interface BlockedPerson {
  id: string
  name: string | null
}

/** The people the caller has blocked, by first name. Rejects on failure. */
export async function getBlocks(token: string, signal?: AbortSignal): Promise<BlockedPerson[]> {
  const res = await fetchNoting(`${API_BASE}/api/blocks`, { headers: bearer(token), signal })
  if (!res.ok) throw new Error(`blocks ${res.status}`)
  return (await res.json()) as BlockedPerson[]
}

/**
 * `not-there`: a bench you were not at in the last 10 minutes. `gone`: nothing else left to report (no such
 * person, a chat that is over).
 */
export type ReportError = 'rate' | 'words' | 'not-there' | 'gone' | 'failed'
export type ReportOutcome = ({ ok: true } & ReportResult) | { ok: false; error: ReportError }

/** Files a report; the server gathers what goes with it. Never rejects. */
export async function sendReport(token: string, input: ReportInput): Promise<ReportOutcome> {
  try {
    const res = await fetch(`${API_BASE}/api/reports`, {
      method: 'POST',
      headers: json(token),
      body: JSON.stringify(input),
    })
    if (res.ok) return { ok: true, ...((await res.json()) as ReportResult) }
    const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error
    if (res.status === 404) return { ok: false, error: error === 'not-there' ? error : 'gone' }
    return { ok: false, error: error === 'rate' || error === 'words' ? error : 'failed' }
  } catch {
    return { ok: false, error: 'failed' }
  }
}
