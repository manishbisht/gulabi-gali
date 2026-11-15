import type {
  DistrictId,
  AvatarLookWire,
  BlockListEntry,
  ChatError,
  ChatMessage,
  CityCount,
  CitySnapshot,
  EndedChat,
  FullProfile,
  HereFor,
  HomeArea,
  InviteView,
  MatchView,
  Me,
  MessagePage,
  PosterError,
  PosterInput,
  PosterView,
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

/** A city read that takes longer than this is given up on: the default sky stands in. */
const CITY_TIMEOUT_MS = 8000

/** Never rejects: any failure, or no answer in `CITY_TIMEOUT_MS`, yields the stale default. */
export async function fetchCity(signal?: AbortSignal): Promise<CitySnapshot> {
  // Built by hand, not with AbortSignal.timeout / .any: neither exists on the phones that matter (Safari < 16 and
  // < 17.4, Chrome < 116), and a throw here would hand them the stale sky forever.
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), CITY_TIMEOUT_MS)
  const forward = () => ctl.abort()
  if (signal?.aborted) ctl.abort()
  else signal?.addEventListener('abort', forward)
  try {
    const res = await fetchNoting(`${API_BASE}/api/city`, { signal: ctl.signal })
    if (!res.ok) return fallbackSnapshot(new Date())
    return (await res.json()) as CitySnapshot
  } catch {
    return fallbackSnapshot(new Date())
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forward)
  }
}

/**
 * How many people others can see in the city now, as `/api/count` rounds it (0: quiet, fewer than three), or
 * null for any failure. Never rejects. Plain `fetch`: a refused read here is no reason for a "slow down" toast.
 */
export async function fetchCount(signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch(`${API_BASE}/api/count`, { signal })
    if (!res.ok) return null
    const { people } = (await res.json()) as Partial<CityCount>
    return typeof people === 'number' && Number.isInteger(people) && people >= 0 ? people : null
  } catch {
    return null
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

/** `getMe`'s rejection for an account a moderator has banned (403 `banned`). */
export class BannedError extends Error {
  constructor() {
    super('banned')
  }
}

/** Rejects with `BannedError` for a banned account, and with an `Error` for any other failure. */
export async function getMe(token: string, signal?: AbortSignal): Promise<Me> {
  const res = await fetchNoting(`${API_BASE}/api/me`, { headers: bearer(token), signal })
  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    if (body?.error === 'banned') throw new BannedError()
  }
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

/**
 * Adds these Jaipur Darshan stamps to the resident's own on the server: the whole set it then holds, or null for
 * any failure (a ghost, a 429, offline). Never rejects. Plain `fetch`: a refused push is retried later, quietly.
 */
export async function putStamps(token: string, stamps: readonly string[]): Promise<string[] | null> {
  try {
    const res = await fetch(`${API_BASE}/api/me/stamps`, {
      method: 'PUT',
      headers: { ...bearer(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ stamps }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { stamps?: unknown }
    return Array.isArray(body.stamps)
      ? body.stamps.filter((id): id is string => typeof id === 'string')
      : null
  } catch {
    return null
  }
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

type RequestError =
  'invalid' | 'ghost' | 'not-verified' | 'no-such-person' | 'already' | 'paused' | 'words' | 'muted'
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
  'muted',
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

export type SendResult =
  { ok: true; message: ChatMessage } | { ok: false; error: ChatError | 'slow' | 'failed' }

/** Never rejects: a 201 gives the message, the rest a typed error (`rate` is the one a person can wait out). */
export async function sendMessage(token: string, matchId: string, body: string): Promise<SendResult> {
  try {
    const res = await fetch(`${API_BASE}/api/matches/${encodeURIComponent(matchId)}/messages`, {
      method: 'POST',
      headers: json(token),
      body: JSON.stringify({ body }),
    })
    if (res.ok) return { ok: true, message: (await res.json()) as ChatMessage }
    const reply = (await res.json().catch(() => null)) as { error?: string; scope?: string } | null
    const err = reply?.error
    // The per-address ceiling is not "one a second": it gets the general slow-down line.
    if (err === 'rate' && reply?.scope === 'ip') return { ok: false, error: 'slow' }
    return {
      ok: false,
      error:
        err === 'rate' || err === 'not-found' || err === 'invalid' || err === 'words' || err === 'muted'
          ? err
          : 'failed',
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

/** True once the account is deleted (the server answered 204). Never rejects. */
export async function deleteMyAccount(token: string): Promise<boolean> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/me`, { method: 'DELETE', headers: bearer(token) })
    return res.ok
  } catch {
    return false
  }
}

/** A device's push subscription as `PUT /api/me/push` takes it (see src/push/push.ts). */
export interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
  lang: 'hi' | 'en'
  /** The server key the browser subscribed with, so a server with another one can say so (409 `key`). */
  server: string
}

/**
 * `PUT /api/me/push`: the status (204 when stored), or 0 when the API could not be reached. Never rejects. Plain
 * `fetch`, like the other push call: a visit refreshes it in the background, and the switch has its own line.
 */
export async function putPushSubscription(token: string, input: PushSubscriptionInput): Promise<number> {
  try {
    const res = await fetch(`${API_BASE}/api/me/push`, {
      method: 'PUT',
      headers: json(token),
      body: JSON.stringify(input),
    })
    return res.status
  } catch {
    return 0
  }
}

/** `DELETE /api/me/push`: true once this device's subscription is off the server. Never rejects. */
export async function deletePushSubscription(token: string, endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/me/push`, {
      method: 'DELETE',
      headers: json(token),
      body: JSON.stringify({ endpoint }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** True once the block the list calls `handle` is lifted (or was never one of yours). Never rejects. */
export async function unblockPerson(token: string, handle: string): Promise<boolean> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/blocks/${encodeURIComponent(handle)}`, {
      method: 'DELETE',
      headers: bearer(token),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * The blocks the caller made, by first name, each with an opaque handle (never the person's id: a block made
 * from a poster must not say whose it was). Rejects on failure.
 */
export async function getBlocks(token: string, signal?: AbortSignal): Promise<BlockListEntry[]> {
  const res = await fetchNoting(`${API_BASE}/api/blocks`, { headers: bearer(token), signal })
  if (!res.ok) throw new Error(`blocks ${res.status}`)
  return (await res.json()) as BlockListEntry[]
}

/** The caller's chats that ended in the last 30 days, which they can still report. Rejects on failure. */
export async function getEnded(token: string, signal?: AbortSignal): Promise<EndedChat[]> {
  const res = await fetchNoting(`${API_BASE}/api/ended`, { headers: bearer(token), signal })
  if (!res.ok) throw new Error(`ended ${res.status}`)
  return (await res.json()) as EndedChat[]
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

/** `invalid`: not an email address. `failed` covers the rest (a 429 included): try again later. */
export type WaitlistOutcome = 'ok' | 'invalid' | 'failed'

/**
 * Leaves an email for when the full city has room. No sign-in: someone waiting may have no account. Already
 * listed or not, a good address is `ok` (the server never says which). Never rejects.
 */
export async function joinWaitlist(email: string): Promise<WaitlistOutcome> {
  try {
    const res = await fetch(`${API_BASE}/api/waitlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    })
    return res.ok ? 'ok' : res.status === 400 ? 'invalid' : 'failed'
  } catch {
    return 'failed'
  }
}

/**
 * A district's posters, wall by wall. With a token, the list leaves out anyone blocked either way and marks
 * your own; without one it is everyone's. Rejects on failure.
 */
export async function getPosters(
  district: DistrictId,
  token: string | null,
  signal?: AbortSignal,
): Promise<PosterView[]> {
  const res = await fetchNoting(`${API_BASE}/api/districts/${district}/posters`, {
    headers: token ? bearer(token) : {},
    signal,
  })
  if (!res.ok) throw new Error(`posters ${res.status}`)
  return (await res.json()) as PosterView[]
}

export type PinOutcome =
  { ok: true; poster: PosterView } | { ok: false; error: PosterError | 'failed'; field?: string }

const PIN_ERRORS: readonly string[] = ['invalid', 'words', 'ghost', 'not-verified', 'muted', 'limit', 'rate']

/**
 * Pins a plan on a wall. Never rejects: the poster as it went up, or the typed reason it did not. Plain `fetch`:
 * the composer has its own line for the day's limit.
 */
export async function pinPoster(token: string, input: PosterInput): Promise<PinOutcome> {
  try {
    const res = await fetch(`${API_BASE}/api/posters`, {
      method: 'POST',
      headers: json(token),
      body: JSON.stringify(input),
    })
    if (res.ok) return { ok: true, poster: (await res.json()) as PosterView }
    const body = (await res.json().catch(() => null)) as {
      error?: string
      field?: string
      scope?: string
    } | null
    // The per-address ceiling is not the day's five: just try again later.
    if (body?.error === 'rate' && body.scope === 'ip') return { ok: false, error: 'failed' }
    const error = body?.error && PIN_ERRORS.includes(body.error) ? (body.error as PosterError) : 'failed'
    return { ok: false, error, ...(body?.field ? { field: body.field } : {}) }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

/** Takes your own poster down: true once it is down (or already was). Never rejects. */
export async function takeDownPoster(token: string, id: string): Promise<boolean> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/posters/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: bearer(token),
    })
    return res.ok || res.status === 404
  } catch {
    return false
  }
}

/**
 * Blocks a poster's owner, whose id the page never has: true once done; `gone` when the poster came down so long
 * ago (or never was) that nobody is remembered for it, so there is nobody to block; false for anything else (try
 * again). Never rejects.
 */
export async function blockPosterOwner(token: string, posterId: string): Promise<boolean | 'gone'> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/blocks`, {
      method: 'POST',
      headers: json(token),
      body: JSON.stringify({ poster: posterId }),
    })
    return res.ok ? true : res.status === 404 ? 'gone' : false
  } catch {
    return false
  }
}
