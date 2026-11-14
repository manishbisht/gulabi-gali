import { deleteAccount } from './account'
import { handleAdmin } from './admin'
import { resolveUser } from './auth'
import { blockUser, listBlocks, unblockUser } from './blocks'
import { listMatches, listMessages, postMessage, unmatch } from './chat'
import { allowedOrigin, corsHeaders } from './cors'
import { openDistrict } from './district'
import type { Env } from './env'
import { listEnded, purgeEvidence } from './evidence'
import { GATE_NAME, joinWaitlist, purgeWaitlist } from './gate'
import { hashedList } from './filter/server'
import { floating, openInbox, type Later } from './inbox'
import { inviteIpLimit, ipLimit, muteGate, purgeCounters, readLimit } from './limits'
import type { CitySnapshot } from './protocol'
import { listPosters, pinPoster, purgePosters, removeOwnPoster } from './posters'
import { fileReport, purgeReportEvidence } from './reports'
import { devVerify, listInvites, redeemInvite } from './trust'
import { activeRow, bannedGate, devLogin, getMe, userExists, getProfile, putProfile } from './profiles'
import { acceptRequest, expireRequests, ignoreRequest, listRequests, sendRequest } from './requests'
import { defaultSnapshot, fetchSnapshot } from './weather'

const CITY_KEY = 'now'
const CITY_CACHE = 'public, max-age=300'
/** KV drops a snapshot after this, so an outage can never leave yesterday's sky up for long. */
const KV_TTL_S = 3 * 3600
/** A stored snapshot older than this is a miss: the cron has stopped and the sun times are suspect. */
const MAX_AGE_MS = 2 * 3600 * 1000

function json(
  body: unknown,
  status: number,
  origin: string | null,
  extra?: Record<string, string>,
): Response {
  const headers = { ...(origin ? corsHeaders(origin) : {}), ...extra }
  return Response.json(body, { status, headers })
}

export async function refreshCity(env: Env, fetcher: typeof fetch, now: Date): Promise<CitySnapshot> {
  const snapshot = await fetchSnapshot(fetcher, now)
  await env.CITY.put(CITY_KEY, JSON.stringify(snapshot), { expirationTtl: KV_TTL_S })
  return snapshot
}

export async function handleCity(
  env: Env,
  fetcher: typeof fetch,
  now: Date,
  origin: string | null = null,
  timeoutMs?: number,
): Promise<Response> {
  const headers = { 'cache-control': CITY_CACHE }
  // A failed or garbled KV read is just a cache miss.
  const stored = await env.CITY.get<CitySnapshot>(CITY_KEY, 'json').catch(() => null)
  const age = stored ? now.getTime() - Date.parse(stored.fetchedAt) : Infinity
  if (stored && age <= MAX_AGE_MS) return json(stored, 200, origin, headers)
  try {
    const live = await fetchSnapshot(fetcher, now, timeoutMs)
    // Serve the live snapshot even if storing it fails.
    await env.CITY.put(CITY_KEY, JSON.stringify(live), { expirationTtl: KV_TTL_S }).catch(() => undefined)
    return json(live, 200, origin, headers)
  } catch {
    return json(defaultSnapshot(now), 200, origin, headers)
  }
}

function withCors(res: Response, origin: string | null): Response {
  if (!origin) return res
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(corsHeaders(origin))) out.headers.set(k, v)
  return out
}

/** The biggest JSON body any route reads: a profile is a few hundred bytes, so this is generous. */
const MAX_BODY = 16 * 1024

/** The parsed body, or null when it is not JSON or is over `MAX_BODY` (read in chunks, so a big one is never held). */
async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return null
  const reader = request.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY) {
      void reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

/**
 * Clerk does the sign-in; the call that would create an account row (the first `/api/me`, or a profile saved
 * without one) is what counts against the address's sign-in limit. Null while within it, or when the account exists.
 */
async function bootstrapLimit(env: Env, request: Request, userId: string): Promise<Response | null> {
  return (await userExists(env, userId)) ? null : ipLimit(env, env.SIGNIN_LIMITER, request)
}

/**
 * `POST /api/dev/gate {maxLive, clear?}`, DEV_AUTH only: sets the city's cap (null: back to `MAX_LIVE`) and,
 * with `clear`, empties the gate. For the e2e run, whose other specs need more than one resident at a time.
 */
async function devGate(env: Env, raw: unknown): Promise<Response> {
  const { maxLive, clear } = (raw ?? {}) as { maxLive?: unknown; clear?: unknown }
  if (!(maxLive === null || (typeof maxLive === 'number' && Number.isInteger(maxLive) && maxLive >= 0)))
    return Response.json({ error: 'invalid' }, { status: 400 })
  const gate = env.GATE.get(env.GATE.idFromName(GATE_NAME))
  return Response.json(await gate.configure({ maxLive, clear: clear === true }))
}

async function handleApi(request: Request, env: Env, url: URL, later: Later): Promise<Response> {
  const { method } = request
  const { pathname } = url
  // Every write counts against its address, whoever signed it (dev login included): a flood ceiling, not a
  // per-person quota (many people share one carrier address), so it is roomy.
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    const slow = await ipLimit(env, env.WRITES_LIMITER, request)
    if (slow) return slow
  }
  if (pathname === '/api/dev/login') {
    if (env.DEV_AUTH !== '1' || method !== 'POST')
      return Response.json({ error: 'not found' }, { status: 404 })
    const slow = await ipLimit(env, env.SIGNIN_LIMITER, request)
    if (slow) return slow
    return devLogin(env, await readJson(request))
  }
  if (pathname === '/api/dev/verify') {
    if (env.DEV_AUTH !== '1' || method !== 'POST')
      return Response.json({ error: 'not found' }, { status: 404 })
    return devVerify(env, await readJson(request))
  }
  if (pathname === '/api/dev/gate') {
    if (env.DEV_AUTH !== '1' || method !== 'POST')
      return Response.json({ error: 'not found' }, { status: 404 })
    return devGate(env, await readJson(request))
  }
  // No sign-in: someone the full city turned away may have no account (see `joinWaitlist`).
  if (pathname === '/api/waitlist' && method === 'POST')
    return joinWaitlist(env, request, await readJson(request))
  const user = await resolveUser(request, env)
  // Before the 401: signed out, signed in or not an admin, the console is a plain 404 (see `handleAdmin`).
  if (pathname.startsWith('/api/admin/')) return handleAdmin(request, env, url, user, later)
  // Public, ghosts included; with a token it is that person's own list (see `listPosters`).
  const posters = pathname.match(/^\/api\/districts\/([^/]+)\/posters$/)
  if (posters && method === 'GET') return listPosters(env, posters[1]!, user?.id ?? null)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (pathname === '/api/me' && method === 'GET') {
    const slow = (await bootstrapLimit(env, request, user.id)) ?? (await bannedGate(env, user.id))
    return slow ?? Response.json(await getMe(env, user.id))
  }
  if (pathname === '/api/me' && method === 'DELETE') return deleteAccount(env, user.id, later)
  if (pathname === '/api/me/profile' && method === 'PUT')
    return (
      (await bootstrapLimit(env, request, user.id)) ??
      (await bannedGate(env, user.id)) ??
      (await muteGate(env, user.id)) ??
      putProfile(env, user.id, await readJson(request))
    )
  if (pathname === '/api/invites' && method === 'GET') return listInvites(env, user.id)
  if (pathname === '/api/invites/redeem' && method === 'POST') {
    // Per address as well as per person (which `redeemInvite` counts): one person cannot spread guesses over accounts.
    const slow = await inviteIpLimit(env, request)
    if (slow) return slow
    return redeemInvite(env, user.id, await readJson(request), later)
  }
  if (pathname === '/api/blocks' && method === 'GET') return listBlocks(env, user.id)
  if (pathname === '/api/blocks' && method === 'POST')
    return blockUser(env, user.id, await readJson(request), later)
  const unblock = pathname.match(/^\/api\/blocks\/([^/]+)$/)
  if (unblock && method === 'DELETE') {
    try {
      return await unblockUser(env, user.id, decodeURIComponent(unblock[1]))
    } catch {
      return new Response(null, { status: 204 })
    }
  }
  if (pathname === '/api/ended' && method === 'GET') return listEnded(env, user.id)
  if (pathname === '/api/posters' && method === 'POST')
    return pinPoster(env, user.id, await readJson(request), later)
  const poster = pathname.match(/^\/api\/posters\/([^/]+)$/)
  if (poster && method === 'DELETE') {
    let id: string
    try {
      id = decodeURIComponent(poster[1]!)
    } catch {
      return Response.json({ error: 'not found' }, { status: 404 })
    }
    return removeOwnPoster(env, user.id, id, later)
  }
  if (pathname === '/api/reports' && method === 'POST')
    return fileReport(env, user.id, await readJson(request), later)
  if (pathname === '/api/requests' && method === 'POST')
    return (
      (await muteGate(env, user.id)) ?? sendRequest(env, user.id, await readJson(request), Date.now(), later)
    )
  if (pathname === '/api/requests' && method === 'GET')
    return (await readLimit(env, user.id, 'requests')) ?? Response.json(await listRequests(env, user.id))
  const act = pathname.match(/^\/api\/requests\/([^/]+)\/(accept|ignore)$/)
  if (act && method === 'POST') {
    const rid = act[1]
    return act[2] === 'accept'
      ? acceptRequest(env, user.id, rid, Date.now(), later)
      : ignoreRequest(env, user.id, rid)
  }
  if (pathname === '/api/matches' && method === 'GET') return listMatches(env, user.id)
  // Every route under one match answers 404 to anyone not in it, whatever the method.
  const chat = pathname.match(/^\/api\/matches\/([^/]+)(\/messages)?$/)
  if (chat) {
    const [, mid, messages] = chat
    if (messages && method === 'GET') return listMessages(env, user.id, mid, url.searchParams.get('before'))
    if (messages && method === 'POST')
      return (
        (await muteGate(env, user.id)) ??
        postMessage(env, user.id, mid, await readJson(request), Date.now(), later)
      )
    if (!messages && method === 'DELETE') return unmatch(env, user.id, mid, later)
  }
  const match = pathname.match(/^\/api\/profiles\/([^/]+)$/)
  if (match && method === 'GET') {
    // A full profile is for residents only: a token alone (no profile, half a one, a ban) is still a ghost.
    if (!(await activeRow(env, user.id))) return Response.json({ error: 'ghost' }, { status: 403 })
    const limited = await readLimit(env, user.id, 'profile')
    if (limited) return limited
    let id: string
    try {
      id = decodeURIComponent(match[1])
    } catch {
      return Response.json({ error: 'not found' }, { status: 404 })
    }
    return getProfile(env, id, user.id)
  }
  return Response.json({ error: 'not found' }, { status: 404 })
}

export { DistrictDO } from './district'
export { InboxDO } from './inbox'
export { GateDO } from './gate'

export default {
  /** `ctx` is missing only when a test calls this directly; then notices just run (see `floating`). */
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const origin = allowedOrigin(request.headers.get('Origin'))
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: origin ? corsHeaders(origin) : undefined })
    }
    const url = new URL(request.url)
    const { pathname } = url
    if (pathname === '/health') return json({ ok: true }, 200, origin)
    if (pathname === '/api/filter/words.json') {
      // Public: hashes only, so the page can hint before sending. The server stays the authority.
      return json({ hashes: await hashedList() }, 200, origin, { 'cache-control': 'public, max-age=86400' })
    }
    if (pathname === '/api/city') return handleCity(env, fetch, new Date(), origin)
    const live = pathname.match(/^\/api\/districts\/([^/]+)\/live$/)
    if (live || pathname === '/api/inbox') {
      // Every socket open counts, ghosts and reconnects included.
      const slow = await ipLimit(env, env.SOCKETS_LIMITER, request)
      if (slow) return slow
      return live ? openDistrict(request, env, live[1]) : openInbox(request, env)
    }
    const later: Later = ctx ? (work) => ctx.waitUntil(work) : floating
    if (pathname.startsWith('/api/')) return withCors(await handleApi(request, env, url, later), origin)
    return json({ error: 'not found' }, 404, origin)
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshCity(env, fetch, new Date()))
    // A failed sweep is only logged: it must not take the city refresh with it, and the next run tries again.
    ctx.waitUntil(expireRequests(env).catch((err) => console.error('request sweep failed', err)))
    ctx.waitUntil(purgeEvidence(env).catch((err) => console.error('evidence sweep failed', err)))
    ctx.waitUntil(purgeReportEvidence(env).catch((err) => console.error('report sweep failed', err)))
    ctx.waitUntil(purgeCounters(env).catch((err) => console.error('counter sweep failed', err)))
    ctx.waitUntil(purgeWaitlist(env).catch((err) => console.error('waitlist sweep failed', err)))
    ctx.waitUntil(purgePosters(env).catch((err) => console.error('poster sweep failed', err)))
  },
} satisfies ExportedHandler<Env>
