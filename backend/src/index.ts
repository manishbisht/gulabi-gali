import { resolveUser } from './auth'
import { allowedOrigin, corsHeaders } from './cors'
import { openDistrict } from './district'
import type { Env } from './env'
import type { CitySnapshot } from './protocol'
import { devLogin, getMe, getProfile, putProfile } from './profiles'
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

async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null)
}

async function handleApi(request: Request, env: Env, pathname: string): Promise<Response> {
  const { method } = request
  if (pathname === '/api/dev/login') {
    if (env.DEV_AUTH !== '1' || method !== 'POST')
      return Response.json({ error: 'not found' }, { status: 404 })
    return devLogin(env, await readJson(request))
  }
  const user = await resolveUser(request, env)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (pathname === '/api/me' && method === 'GET') return Response.json(await getMe(env, user.id))
  if (pathname === '/api/me/profile' && method === 'PUT')
    return putProfile(env, user.id, await readJson(request))
  const match = pathname.match(/^\/api\/profiles\/([^/]+)$/)
  if (match && method === 'GET') {
    try {
      return await getProfile(env, decodeURIComponent(match[1]))
    } catch {
      return Response.json({ error: 'not found' }, { status: 404 })
    }
  }
  return Response.json({ error: 'not found' }, { status: 404 })
}

export { DistrictDO } from './district'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request.headers.get('Origin'))
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: origin ? corsHeaders(origin) : undefined })
    }
    const { pathname } = new URL(request.url)
    if (pathname === '/health') return json({ ok: true }, 200, origin)
    if (pathname === '/api/city') return handleCity(env, fetch, new Date(), origin)
    const live = pathname.match(/^\/api\/districts\/([^/]+)\/live$/)
    if (live) return openDistrict(request, env, live[1])
    if (pathname.startsWith('/api/')) return withCors(await handleApi(request, env, pathname), origin)
    return json({ error: 'not found' }, 404, origin)
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshCity(env, fetch, new Date()))
  },
} satisfies ExportedHandler<Env>
