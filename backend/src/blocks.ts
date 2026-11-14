import { endMatch } from './chat'
import type { Env } from './env'
import { floating, notify, type Later } from './inbox'
import { firstName } from './names'
import { refreshUser } from './refresh'

/**
 * What the block list shows of someone: an id and the first name saved when they were blocked, or null when
 * none was (they had no profile then): the page says "someone" in the reader's language.
 */
export interface BlockedPerson {
  id: string
  name: string | null
}

const MAX_ID = 200
/** The most blocked people `GET /api/blocks` lists: far more than anyone blocks, never an unbounded read. */
const LIST_LIMIT = 500

const fail = (error: string, status: number) => Response.json({ error }, { status })
const noContent = () => new Response(null, { status: 204 })

/**
 * `POST /api/blocks {id}`: always 204 (blocking twice, or someone who does not exist, changes nothing and tells
 * nothing). Blocking yourself is 400. Otherwise: the block is written, every request between the two goes, any
 * match ends (held as evidence first; only the blocker's own tabs hear `unmatched`), and both people's live
 * state is refreshed, so each stops seeing the other at once and, on a shared bench, the blocked one is stood
 * up. The blocked person is told nothing.
 */
export async function blockUser(
  env: Env,
  userId: string,
  raw: unknown,
  later: Later = floating,
  now = Date.now(),
): Promise<Response> {
  const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : null
  if (typeof id !== 'string' || !id || id.length > MAX_ID) return fail('invalid', 400)
  if (id === userId) return fail('invalid', 400)
  const exists = await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(id).first()
  if (!exists) return noContent()
  // Their first name as of now is all the list will ever show of them (never live profile data).
  const profile = await env.DB.prepare('SELECT name FROM profiles WHERE user_id = ?')
    .bind(id)
    .first<{ name: string }>()
  const name = profile ? firstName(profile.name) : ''
  await env.DB.prepare('INSERT OR IGNORE INTO blocks (a, b, created_at, name) VALUES (?, ?, ?, ?)')
    .bind(userId, id, now, name)
    .run()
  // Also on a repeat: it finishes what a block that stopped half way left undone.
  const matchId = await endMatch(env, userId, id, 'block', now)
  if (matchId) later(notify(env, userId, { t: 'unmatched', matchId }))
  await Promise.all([refreshUser(env, userId, 'block'), refreshUser(env, id, 'block')])
  return noContent()
}

/** `DELETE /api/blocks/:id`: always 204. Nothing comes back with it: no match, no request. */
export async function unblockUser(env: Env, userId: string, id: string): Promise<Response> {
  if (id.length > MAX_ID) return noContent()
  const { meta } = await env.DB.prepare('DELETE FROM blocks WHERE a = ? AND b = ?').bind(userId, id).run()
  if (meta.changes) await Promise.all([refreshUser(env, userId, 'block'), refreshUser(env, id, 'block')])
  return noContent()
}

/** `GET /api/blocks`: the people the caller has blocked, newest first: id and the first name saved at block time (or null). */
export async function listBlocks(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT b, name FROM blocks WHERE a = ? ORDER BY created_at DESC LIMIT ?',
  )
    .bind(userId, LIST_LIMIT)
    .all<{ b: string; name: string }>()
  const out: BlockedPerson[] = results.map((r) => ({ id: r.b, name: r.name || null }))
  return Response.json(out)
}
