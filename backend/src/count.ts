import type { Env } from './env'
import { GATE_NAME } from './gate'
import type { Later } from './inbox'
import { ipLimit } from './limits'
import type { CityCount } from './protocol'

/** The edge keeps one answer this long: at most one gate read per location per 30 s. */
export const COUNT_CACHE_S = 30
/** Fewer visible people than this are never told apart: the welcome screen just says it is quiet. */
export const COUNT_FLOOR = 3

/**
 * What the welcome screen may say for `n` people on the street: 0 ("quiet") below `COUNT_FLOOR`, three to nine
 * as they are, and from ten a multiple of five, rounded down (shown as "10+"), so the number does not tick
 * with each arrival.
 */
export function roundCount(n: number): number {
  if (n < COUNT_FLOOR) return 0
  if (n < 10) return n
  return Math.floor(n / 5) * 5
}

/** The edge-cache key: one for the whole city, whatever the query string. */
export const countKey = (env: Env, fallbackOrigin = 'https://api.gulabi-gali.manishbisht.me') =>
  new Request(`${env.API_ORIGIN || fallbackOrigin}/api/count`)

/**
 * `GET /api/count`, public (no sign-in, ghosts included): how many residents others can see in the city now,
 * as `roundCount` says it. Only the gate's live slots count (see `GateDO.visible`): never a ghost, someone
 * hidden or banned, someone waiting in line, or a slot held after its socket closed. One number for the city:
 * no names, ids or districts.
 *
 * Per address through `COUNT_LIMITER` first; then the edge's copy, at most `COUNT_CACHE_S` old, so a crowd on
 * the welcome screen asks the gate once per location per 30 s. Browsers keep no copy (`no-store`), so what
 * they show is never older than the edge's. A gate that cannot be asked is a 503, cached nowhere.
 */
export async function cityCount(env: Env, request: Request, origin: string, later: Later): Promise<Response> {
  const slow = await ipLimit(env, env.COUNT_LIMITER, request)
  if (slow) return slow
  const key = countKey(env, origin)
  const hit = await caches.default.match(key).catch(() => undefined)
  if (hit) return client(hit)
  let people: number
  try {
    people = roundCount(await env.GATE.get(env.GATE.idFromName(GATE_NAME)).visible())
  } catch (err) {
    console.error('count: gate failed', err)
    return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
  const body: CityCount = { people }
  const stored = Response.json(body, { headers: { 'cache-control': `public, max-age=${COUNT_CACHE_S}` } })
  later(caches.default.put(key, stored.clone()).catch((err) => console.error('count: cache put failed', err)))
  return client(stored)
}

/** The edge's copy, as a browser gets it: no copy kept there. */
function client(res: Response): Response {
  const out = new Response(res.body, res)
  out.headers.set('cache-control', 'no-store')
  return out
}
