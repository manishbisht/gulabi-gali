import { allowedOrigin, corsHeaders } from './cors'
import type { Env } from './env'
import type { CitySnapshot } from './protocol'
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request.headers.get('Origin'))
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: origin ? corsHeaders(origin) : undefined })
    }
    const { pathname } = new URL(request.url)
    if (pathname === '/health') return json({ ok: true }, 200, origin)
    if (pathname === '/api/city') return handleCity(env, fetch, new Date(), origin)
    return json({ error: 'not found' }, 404, origin)
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refreshCity(env, fetch, new Date()))
  },
} satisfies ExportedHandler<Env>
