import { devSlug, mintDevToken } from './auth'
import type { Env } from './env'
import { wordsOk } from './filter/server'
import { cleanName, firstName } from './names'
import {
  HEADS,
  HERE_FOR,
  HOME_AREAS,
  OUTFITS,
  type AvatarLookWire,
  type FullProfile,
  type HereFor,
  type HomeArea,
  type Me,
  type PublicPerson,
} from './protocol'

export const MAX_STATUS = 80
const MAX_ABOUT = 200
const MAX_LINK = 200

export interface ProfileRow {
  user_id: string
  name: string
  look: string
  home_area: string
  status: string
  here_for: string | null
  about: string
  link: string | null
  adult: number
  pledge: number
  pause_requests: number
}

/**
 * The only shape a ghost-safe surface (the map, a nearby list) may carry. Fields are named one by one, so a
 * new private field on a profile can never leak by spreading, and the name is cut to a first name (see
 * `firstName`). Applying it twice changes nothing.
 */
export function toPublic(p: PublicPerson): PublicPerson {
  return { id: p.id, name: firstName(p.name), look: { ...p.look }, status: p.status }
}

/** `withLink`: the viewer is verified, or it is the owner's own profile. Everyone else never gets the link. */
function toFull(row: ProfileRow, withLink = false): FullProfile {
  return {
    id: row.user_id,
    name: row.name,
    look: JSON.parse(row.look) as AvatarLookWire,
    status: row.status,
    homeArea: row.home_area as HomeArea,
    hereFor: row.here_for as HereFor | null,
    about: row.about,
    pauseRequests: row.pause_requests === 1,
    ...(withLink && row.link ? { link: row.link } : {}),
  }
}

const isComplete = (row: ProfileRow) => row.adult === 1 && row.pledge === 1

function parseLook(x: unknown): AvatarLookWire | null {
  if (typeof x !== 'object' || x === null) return null
  const { skin, outfit, head } = x as Record<string, unknown>
  if (!Number.isInteger(skin) || (skin as number) < 0 || (skin as number) > 4) return null
  if (!OUTFITS.includes(outfit as never) || !HEADS.includes(head as never)) return null
  return {
    skin: skin as AvatarLookWire['skin'],
    outfit: outfit as AvatarLookWire['outfit'],
    head: head as AvatarLookWire['head'],
  }
}

export function cleanText(x: unknown, max: number, oneLine = false): string | null {
  if (x === undefined || x === null) return ''
  if (typeof x !== 'string') return null
  // Control characters are never wanted; `about` alone may keep its newlines, a `oneLine` field loses them.
  const text = x
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' && !oneLine ? c : ''))
    .trim()
  return [...text].length <= max ? text : null
}

/**
 * https only, at most 200 characters, no credentials, no control or format characters. Answers the normalised
 * `href` (what is stored), null for no link, or undefined for one that is not allowed.
 */
export function cleanLink(x: unknown): string | null | undefined {
  if (x === null || x === '') return null
  if (typeof x !== 'string' || x.length > MAX_LINK || /[\p{Cc}\p{Cf}\s]/u.test(x)) return undefined
  try {
    const url = new URL(x)
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > MAX_LINK)
      return undefined
    return url.href
  } catch {
    return undefined
  }
}

type Parsed = {
  name: string
  look: AvatarLookWire
  status: string
  homeArea: HomeArea
  hereFor: HereFor | null
  about: string
  /** undefined: the request left `link` out, so the stored one stays. */
  link: string | null | undefined
  adult: boolean
  pledge: boolean
  pauseRequests: boolean
}

export function parseProfile(raw: unknown): { ok: true; value: Parsed } | { ok: false; fields: string[] } {
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const fields: string[] = []
  const name = cleanName(b.name)
  if (!name) fields.push('name')
  const look = parseLook(b.look)
  if (!look) fields.push('look')
  const status = cleanText(b.status, MAX_STATUS, true)
  if (status === null) fields.push('status')
  if (!HOME_AREAS.includes(b.homeArea as never)) fields.push('homeArea')
  const hereFor = b.hereFor ?? null
  if (hereFor !== null && !HERE_FOR.includes(hereFor as never)) fields.push('hereFor')
  const about = cleanText(b.about, MAX_ABOUT)
  if (about === null) fields.push('about')
  const keepLink = !('link' in b) || b.link === undefined
  const link = keepLink ? undefined : cleanLink(b.link)
  if (!keepLink && link === undefined) fields.push('link')
  if (typeof b.adult !== 'boolean') fields.push('adult')
  if (typeof b.pledge !== 'boolean') fields.push('pledge')
  if (b.pauseRequests !== undefined && typeof b.pauseRequests !== 'boolean') fields.push('pauseRequests')
  if (fields.length) return { ok: false, fields }
  return {
    ok: true,
    value: {
      name: name!,
      look: look!,
      status: status!,
      homeArea: b.homeArea as HomeArea,
      hereFor: hereFor as HereFor | null,
      about: about!,
      link,
      adult: b.adult as boolean,
      pledge: b.pledge as boolean,
      pauseRequests: b.pauseRequests === true,
    },
  }
}

export async function getMe(env: Env, userId: string): Promise<Me> {
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)')
    .bind(userId, Date.now())
    .run()
  const row = await env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?')
    .bind(userId)
    .first<ProfileRow>()
  const verified = await env.DB.prepare('SELECT verified FROM users WHERE id = ?')
    .bind(userId)
    .first<{ verified: number }>()
  return {
    id: userId,
    // Your own link is yours to see and edit, verified or not.
    profile: row ? toFull(row, true) : null,
    complete: row ? isComplete(row) : false,
    verified: verified?.verified === 1,
  }
}

export async function putProfile(env: Env, userId: string, raw: unknown): Promise<Response> {
  const parsed = parseProfile(raw)
  if (!parsed.ok) return Response.json({ error: 'invalid', fields: parsed.fields }, { status: 400 })
  const p = parsed.value
  // After the clean: what is stored and shown is what is checked. The link is a URL, never word-filtered.
  const field = (['name', 'status', 'about'] as const).find((f) => !wordsOk(p[f], f))
  if (field) return Response.json({ error: 'words', field }, { status: 400 })
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)').bind(userId, now),
    env.DB.prepare(
      `INSERT INTO profiles (user_id, name, look, home_area, status, here_for, about, link, adult, pledge, pause_requests, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, look = excluded.look, home_area = excluded.home_area,
         status = excluded.status, here_for = excluded.here_for, about = excluded.about,
         link = CASE WHEN ? = 1 THEN excluded.link ELSE profiles.link END,
         adult = excluded.adult, pledge = excluded.pledge, pause_requests = excluded.pause_requests,
         updated_at = excluded.updated_at`,
    ).bind(
      userId,
      p.name,
      JSON.stringify(p.look),
      p.homeArea,
      p.status,
      p.hereFor,
      p.about,
      p.link ?? null,
      p.adult ? 1 : 0,
      p.pledge ? 1 : 0,
      p.pauseRequests ? 1 : 0,
      now,
      p.link === undefined ? 0 : 1,
    ),
  ])
  return Response.json(await getMe(env, userId))
}

/**
 * The two residency rules, as SQL over `profiles p JOIN users u ON u.id = p.user_id`. Every residency check uses
 * one of them (through `activeRow`, `visibleRow` and `loadResident`):
 *
 * - `ACTIVE`, acting as yourself: a complete profile (adult and pledge), not banned. A hidden person is still
 *   active: they see their own requests and matches, keep their chats going and keep their inbox.
 * - `VISIBLE`, being seen by anyone new: active and not hidden. On the map, as a profile, in someone else's
 *   requests, and as someone a new request or match can reach. A match that already exists outlives a hide
 *   (see `listMatches`).
 */
export const ACTIVE = 'u.banned = 0 AND p.adult = 1 AND p.pledge = 1'
export const VISIBLE = `${ACTIVE} AND u.hidden = 0`

const rowWhere = (env: Env, id: string, rule: string) =>
  env.DB.prepare(
    `SELECT p.* FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? AND ${rule}`,
  )
    .bind(id)
    .first<ProfileRow>()

/** The profile row of someone who may act as themself (see `ACTIVE`). Anyone else is a ghost. */
export const activeRow = (env: Env, id: string): Promise<ProfileRow | null> => rowWhere(env, id, ACTIVE)

/** The profile row of someone others may see (see `VISIBLE`). */
export const visibleRow = (env: Env, id: string): Promise<ProfileRow | null> => rowWhere(env, id, VISIBLE)

/** Another person's profile for `viewerId`, who carries the link only when verified. */
export async function getProfile(env: Env, id: string, viewerId: string): Promise<Response> {
  const row = await visibleRow(env, id)
  if (!row) return Response.json({ error: 'not found' }, { status: 404 })
  const viewer = await env.DB.prepare('SELECT verified FROM users WHERE id = ?')
    .bind(viewerId)
    .first<{ verified: number }>()
  return Response.json(toFull(row, viewer?.verified === 1))
}

/** The public face of a profile row. */
export const publicOf = (row: ProfileRow): PublicPerson => toPublic(toFull(row))

/** What the map (or anyone else) may show of a resident, or null for anyone it must not show (see `VISIBLE`). */
export async function loadResident(env: Env, id: string): Promise<PublicPerson | null> {
  const row = await visibleRow(env, id)
  return row ? publicOf(row) : null
}

/** DEV_AUTH only: trade a name for a dev token. The caller has already checked the flag. */
export async function devLogin(env: Env, raw: unknown): Promise<Response> {
  const name = cleanName((raw as { name?: unknown } | null)?.name)
  const slug = name ? devSlug(name) : ''
  if (!slug) return Response.json({ error: 'invalid', fields: ['name'] }, { status: 400 })
  return Response.json({ token: await mintDevToken(env, slug) })
}
