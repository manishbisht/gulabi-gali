import { API_BASE } from './api'
import type { BenchKind, ChaiInviteView, FriendLists, FriendSettings, FriendState } from './protocol'
import { fetchNoting } from './rateNotice'

/*
 * Friends ("Dost banao") and "Chai pe bulao" (backend/src/friends.ts). None of these reject: a failure is a
 * typed outcome or null, and the page says so where it matters.
 */

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
const json = (token: string) => ({ ...bearer(token), 'Content-Type': 'application/json' })
const path = (id: string) => encodeURIComponent(id)

/** The friend lists and the caller's switches, or null on any failure (a 429 included). */
export async function getFriends(token: string, signal?: AbortSignal): Promise<FriendLists | null> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/friends`, { headers: bearer(token), signal })
    return res.ok ? ((await res.json()) as FriendLists) : null
  } catch {
    return null
  }
}

/**
 * "Dost banao": where it stands now; `cooldown` when it cannot be asked again yet (an ask taken back, or they ended
 * the friendship, in the last 14 days); null when it could not be asked (no longer matched, a limit, offline).
 */
export async function askFriend(token: string, to: string): Promise<FriendState | 'cooldown' | null> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/friends`, {
      method: 'POST',
      headers: json(token),
      body: JSON.stringify({ to }),
    })
    if (res.status === 409) {
      const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error
      return error === 'cooldown' ? 'cooldown' : null
    }
    if (!res.ok) return null
    return ((await res.json()) as { state: FriendState }).state
  } catch {
    return null
  }
}

/** Accepts (true once friends) or declines (true once done, silently) `from`'s ask. */
export async function answerFriend(token: string, from: string, yes: boolean): Promise<boolean> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/friends/${path(from)}/${yes ? 'accept' : 'decline'}`, {
      method: 'POST',
      headers: bearer(token),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Ends the friendship with `id` (or takes back an ask to them). True once done. */
export async function removeFriend(token: string, id: string): Promise<boolean> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/friends/${path(id)}`, {
      method: 'DELETE',
      headers: bearer(token),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Flips one or both switches: both as they now stand, or null when it did not go. */
export async function putFriendSettings(
  token: string,
  patch: Partial<FriendSettings>,
): Promise<FriendSettings | null> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/me/friend-settings`, {
      method: 'PUT',
      headers: json(token),
      body: JSON.stringify(patch),
    })
    return res.ok ? ((await res.json()) as FriendSettings) : null
  } catch {
    return null
  }
}

/**
 * What an invite for chai came to. `sent` is all the server ever says once it is past your own checks, whether it
 * reached them or not; `not-seated` you are no longer at that bench; `rate` too many for now.
 */
export type ChaiOutcome = 'sent' | 'not-seated' | 'rate' | 'muted' | 'failed'

/** Plain `fetch`: a 429 here has a line of its own (see `fetchNoting`). */
export async function sendChai(
  token: string,
  to: string,
  bench: string,
  kind: BenchKind,
): Promise<ChaiOutcome> {
  try {
    const res = await fetch(`${API_BASE}/api/chai`, {
      method: 'POST',
      headers: json(token),
      body: JSON.stringify({ to, bench, kind }),
    })
    if (res.ok) return 'sent'
    const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error
    return error === 'not-seated' || error === 'rate' || error === 'muted' ? error : 'failed'
  } catch {
    return 'failed'
  }
}

/** The invites for chai to you that still stand, or null on any failure. */
export async function getChai(token: string, signal?: AbortSignal): Promise<ChaiInviteView[] | null> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/chai`, { headers: bearer(token), signal })
    if (!res.ok) return null
    const body = (await res.json()) as unknown
    return Array.isArray(body) ? (body as ChaiInviteView[]) : null
  } catch {
    return null
  }
}

/** "Abhi nahi" (or "Chalo"): the invite is gone from your list. True once done. */
export async function dismissChai(token: string, id: string): Promise<boolean> {
  try {
    const res = await fetchNoting(`${API_BASE}/api/chai/${path(id)}`, {
      method: 'DELETE',
      headers: bearer(token),
    })
    return res.ok
  } catch {
    return false
  }
}
