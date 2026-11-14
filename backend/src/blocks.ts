import { endMatch } from './chat'
import type { Env } from './env'
import { floating, notify, type Later } from './inbox'
import type { PublicPerson } from './protocol'
import { toPublic, type ProfileRow } from './profiles'
import { refreshUser } from './refresh'

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
  await env.DB.prepare('INSERT OR IGNORE INTO blocks (a, b, created_at) VALUES (?, ?, ?)')
    .bind(userId, id, now)
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

/** `GET /api/blocks`: the people the caller has blocked, newest first, by first name. */
export async function listBlocks(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT p.* FROM blocks k JOIN profiles p ON p.user_id = k.b WHERE k.a = ? ORDER BY k.created_at DESC LIMIT ?`,
  )
    .bind(userId, LIST_LIMIT)
    .all<ProfileRow>()
  const out: PublicPerson[] = results.map((r) =>
    toPublic({ id: r.user_id, name: r.name, look: JSON.parse(r.look), status: r.status }),
  )
  return Response.json(out)
}
