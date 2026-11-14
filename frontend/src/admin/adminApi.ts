import type { StringKey } from '../i18n/strings'
import { API_BASE } from '../net/api'
import type {
  AdminHidden,
  AdminReport,
  AdminReportClosed,
  AdminReportPage,
  AdminStats,
  AdminUser,
  ReportReason,
  ReportState,
} from '../net/protocol'

/** How often the admin page asks for the live counts, while it is in view. */
export const STATS_MS = 15_000

/** A token getter, as `useAuth` gives it. */
export type Token = () => Promise<string | null>

/**
 * An admin call's outcome. `missing`: a 404, which for a list means this account is not an admin (the server
 * never says 403) and for an action means the person or report is gone. `failed`: anything else.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: 'missing' | 'failed' }

async function call<T>(token: Token, path: string, init: RequestInit = {}): Promise<Result<T>> {
  try {
    const tok = await token()
    if (!tok) return { ok: false, error: 'failed' }
    const res = await fetch(`${API_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${tok}` } })
    if (res.status === 404) return { ok: false, error: 'missing' }
    if (!res.ok) return { ok: false, error: 'failed' }
    return { ok: true, value: (await res.json()) as T }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

const id = (x: string) => encodeURIComponent(x)

export const getStats = (token: Token) => call<AdminStats>(token, '/api/admin/stats')
export const getHidden = (token: Token) => call<AdminHidden[]>(token, '/api/admin/hidden')
export const getReports = (token: Token, state: ReportState, cursor: string | null) =>
  call<AdminReportPage>(token, `/api/admin/reports?state=${state}&cursor=${id(cursor ?? '')}`)
export const findUsers = (token: Token, q: string) => call<AdminUser[]>(token, `/api/admin/users?q=${id(q)}`)

/** Everyone `userId` verified (their invite redeemed). */
export const getVouched = (token: Token, userId: string) =>
  call<AdminUser[]>(token, `/api/admin/users/${id(userId)}/verified`)

export type UserAction = 'ban' | 'unban' | 'mute' | 'unmute' | 'verify' | 'unverify' | 'unhide'
export const actOn = (token: Token, userId: string, action: UserAction) =>
  call<AdminUser>(token, `/api/admin/users/${id(userId)}/${action}`, { method: 'POST' })
/** Takes a poster down off every wall; the server closes every open report about it as actioned. */
export const removePoster = (token: Token, posterId: string) =>
  call<{ id: string; removed: boolean; closed: number }>(token, `/api/admin/posters/${id(posterId)}`, {
    method: 'DELETE',
  })
export const closeReport = (token: Token, reportId: string, how: 'dismiss' | 'action') =>
  call<AdminReportClosed>(token, `/api/admin/reports/${id(reportId)}/${how}`, { method: 'POST' })

/** Fetches the waitlist CSV with the token (a plain link cannot carry one) and hands it to the browser to save. */
export async function downloadWaitlist(token: Token): Promise<boolean> {
  try {
    const tok = await token()
    if (!tok) return false
    const res = await fetch(`${API_BASE}/api/admin/waitlist.csv`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
    if (!res.ok) return false
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = 'waitlist.csv'
    a.click()
    // After the click has been handled: revoking at once can cancel the save in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

/** A time as the owner reads it: day, month and 24-hour clock, in Jaipur. */
export const when = (at: number) =>
  new Date(at).toLocaleString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

/** Whether `user` is muted at `now`. */
export const isMuted = (user: AdminUser, now: number) => user.mutedUntil !== null && user.mutedUntil > now

/** Whole days since `at`. */
export const daysSince = (at: number, now = Date.now()) => Math.max(0, Math.floor((now - at) / 86_400_000))

export const REASONS: Record<ReportReason, StringKey> = {
  harassment: 'reportHarassment',
  hate: 'reportHate',
  spam: 'reportSpam',
  underage: 'reportUnderage',
  other: 'reportOther',
}

export const KINDS: Record<AdminReport['kind'], StringKey> = {
  person: 'adminKindPerson',
  bench: 'adminKindBench',
  chat: 'adminKindChat',
  poster: 'adminKindPoster',
}
