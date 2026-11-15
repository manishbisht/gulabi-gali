import { endMatch } from './chat'
import type { Env } from './env'
import { floating, notify, type Later } from './inbox'
import { allow, rateLimited } from './limits'
import { firstName } from './names'
import { posterOwner } from './posters'
import type { BlockListEntry } from './protocol'
import { refreshUser } from './refresh'

const MAX_ID = 200
/** Blocks and unblocks one account may make in an hour, together: far more than anyone needs to stay safe. */
export const BLOCKS_PER_HOUR = 30
const HOUR_MS = 3600_000
/** One block or unblock against `BLOCKS_PER_HOUR`: null while within it, else the 429. */
const blockLimit = async (env: Env, userId: string, now = Date.now()): Promise<Response | null> =>
  (await allow(env, userId, 'block', BLOCKS_PER_HOUR, HOUR_MS, now)) ? null : rateLimited(HOUR_MS, now)
/** The most blocked people `GET /api/blocks` lists: far more than anyone blocks, never an unbounded read. */
const LIST_LIMIT = 500

const fail = (error: string, status: number) => Response.json({ error }, { status })
/** A block's handle on the block list: random, so it says nothing of whom it blocks. */
const newHandle = () => crypto.randomUUID().replace(/-/g, '')
const noContent = () => new Response(null, { status: 204 })

/**
 * `POST /api/blocks {id}` (or `{poster}`: the poster's owner, also after it came down: see `posterOwner`): 204
 * (blocking twice, or an id that does not exist, changes nothing and tells nothing). A poster nobody remembers is
 * 404 `gone`: the block did not happen, and the page says so. Blocking yourself is 400. Blocks and unblocks share
 * `BLOCKS_PER_HOUR` per account (429 `rate`): each one wakes every district and two inboxes. Otherwise: the
 * block is written (with a fresh handle for the block list), every request between the two goes, any match ends
 * (held as evidence first; only the blocker's own tabs hear `unmatched`), and both people's live state is
 * refreshed, so each stops seeing the other at once and, on a shared bench, the blocked one is stood up. The
 * blocked person is told nothing, and a poster's owner's id never reaches the blocker.
 */
export async function blockUser(
  env: Env,
  userId: string,
  raw: unknown,
  later: Later = floating,
  now = Date.now(),
): Promise<Response> {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as { id?: unknown; poster?: unknown }
  const named = body.id ?? body.poster
  if (typeof named !== 'string' || !named || named.length > MAX_ID) return fail('invalid', 400)
  if (body.id !== undefined && body.poster !== undefined) return fail('invalid', 400)
  // From a poster, the person is its owner: their id never reaches the page, the poster's is enough.
  const id = body.poster !== undefined ? await posterOwner(env, named) : named
  if (id === userId) return fail('invalid', 400)
  const slow = await blockLimit(env, userId, now)
  if (slow) return slow
  if (id === null) return fail('gone', 404)
  const exists = await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(id).first()
  if (!exists) return noContent()
  // Their first name as of now is all the list will ever show of them (never live profile data).
  const profile = await env.DB.prepare('SELECT name FROM profiles WHERE user_id = ?')
    .bind(id)
    .first<{ name: string }>()
  const name = profile ? firstName(profile.name) : ''
  await env.DB.prepare('INSERT OR IGNORE INTO blocks (a, b, created_at, name, handle) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, id, now, name, newHandle())
    .run()
  // Also on a repeat: it finishes what a block that stopped half way left undone.
  const matchId = await endMatch(env, userId, id, 'block', now)
  if (matchId) later(notify(env, userId, { t: 'unmatched', matchId }))
  await Promise.all([refreshUser(env, userId, 'block'), refreshUser(env, id, 'block')])
  return noContent()
}

/**
 * `DELETE /api/blocks/:handle`: lifts the caller's block that the block list calls `handle`. 204 (also for a
 * handle that names none of theirs, an id included: nothing tells whether it did), or 429 `rate` past
 * `BLOCKS_PER_HOUR`. Nothing comes back with it: no match, no request.
 */
export async function unblockUser(env: Env, userId: string, handle: string): Promise<Response> {
  if (handle.length > MAX_ID) return noContent()
  const slow = await blockLimit(env, userId)
  if (slow) return slow
  const gone = await env.DB.prepare('DELETE FROM blocks WHERE a = ? AND handle = ? RETURNING b')
    .bind(userId, handle)
    .first<{ b: string }>()
  if (gone) await Promise.all([refreshUser(env, userId, 'block'), refreshUser(env, gone.b, 'block')])
  return noContent()
}

/**
 * `GET /api/blocks`: the blocks the caller made, newest first: each one's handle and the first name saved at
 * block time (or null). Never the blocked person's id (see `BlockListEntry`).
 */
export async function listBlocks(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT handle, name FROM blocks WHERE a = ? ORDER BY created_at DESC LIMIT ?',
  )
    .bind(userId, LIST_LIMIT)
    .all<{ handle: string; name: string }>()
  const out: BlockListEntry[] = results.map((r) => ({ handle: r.handle, name: r.name || null }))
  return Response.json(out)
}
