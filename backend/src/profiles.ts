import { devSlug, mintDevToken } from './auth'
import type { Env } from './env'
import { cleanName } from './names'
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

const MAX_STATUS = 80
const MAX_ABOUT = 200
const MAX_LINK = 200

interface ProfileRow {
  user_id: string
  name: string
  look: string
  home_area: string
  status: string
  here_for: string | null
  about: string
  adult: number
  pledge: number
  pause_requests: number
}

/**
 * The only shape a ghost-safe surface (the map, a nearby list) may carry. Fields are named one by one, so a
 * new private field on a profile can never leak by spreading.
 */
export function toPublic(p: PublicPerson): PublicPerson {
  return { id: p.id, name: p.name, look: { ...p.look }, status: p.status }
}

function toFull(row: ProfileRow): FullProfile {
  return {
    id: row.user_id,
    name: row.name,
    look: JSON.parse(row.look) as AvatarLookWire,
    status: row.status,
    homeArea: row.home_area as HomeArea,
    hereFor: row.here_for as HereFor | null,
    about: row.about,
    pauseRequests: row.pause_requests === 1,
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

function cleanText(x: unknown, max: number): string | null {
  if (x === undefined || x === null) return ''
  if (typeof x !== 'string') return null
  // Control characters (but not newlines in `about`) are never wanted.
  const text = x
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === '\n' ? c : ''))
    .trim()
  return [...text].length <= max ? text : null
}

/** https only, at most 200 characters, no credentials. */
export function cleanLink(x: unknown): string | null | undefined {
  if (x === undefined || x === null || x === '') return null
  if (typeof x !== 'string' || x.length > MAX_LINK) return undefined
  try {
    const url = new URL(x)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    return x
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
  link: string | null
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
  const status = cleanText(b.status, MAX_STATUS)
  if (status === null) fields.push('status')
  if (!HOME_AREAS.includes(b.homeArea as never)) fields.push('homeArea')
  const hereFor = b.hereFor ?? null
  if (hereFor !== null && !HERE_FOR.includes(hereFor as never)) fields.push('hereFor')
  const about = cleanText(b.about, MAX_ABOUT)
  if (about === null) fields.push('about')
  const link = cleanLink(b.link)
  if (link === undefined) fields.push('link')
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
      link: link!,
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
  return { id: userId, profile: row ? toFull(row) : null, complete: row ? isComplete(row) : false }
}

export async function putProfile(env: Env, userId: string, raw: unknown): Promise<Response> {
  const parsed = parseProfile(raw)
  if (!parsed.ok) return Response.json({ error: 'invalid', fields: parsed.fields }, { status: 400 })
  const p = parsed.value
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)').bind(userId, now),
    env.DB.prepare(
      `INSERT INTO profiles (user_id, name, look, home_area, status, here_for, about, link, adult, pledge, pause_requests, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, look = excluded.look, home_area = excluded.home_area,
         status = excluded.status, here_for = excluded.here_for, about = excluded.about, link = excluded.link,
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
      p.link,
      p.adult ? 1 : 0,
      p.pledge ? 1 : 0,
      p.pauseRequests ? 1 : 0,
      now,
    ),
  ])
  return Response.json(await getMe(env, userId))
}

export async function getProfile(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT p.* FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? AND u.banned = 0',
  )
    .bind(id)
    .first<ProfileRow>()
  if (!row || !isComplete(row)) return Response.json({ error: 'not found' }, { status: 404 })
  return Response.json(toFull(row))
}

/** DEV_AUTH only: trade a name for a dev token. The caller has already checked the flag. */
export async function devLogin(env: Env, raw: unknown): Promise<Response> {
  const name = cleanName((raw as { name?: unknown } | null)?.name)
  const slug = name ? devSlug(name) : ''
  if (!slug) return Response.json({ error: 'invalid', fields: ['name'] }, { status: 400 })
  return Response.json({ token: await mintDevToken(env, slug) })
}
