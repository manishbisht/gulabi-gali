import { endMatch } from './chat'
import type { Env } from './env'
import { floating, notify, type Later } from './inbox'
import { refreshUser } from './refresh'

/**
 * `DELETE /api/me`: the person's account is erased, and they can start again with a blank profile. 204, also
 * when there was nothing left to delete (running it twice changes nothing).
 *
 * - Every match ends through `endMatch(..., 'delete')`: its last 30 messages are held as evidence (the
 *   `held_evidence` rows the cron deletes after 30 days) before the match and its messages go. The other
 *   person hears `unmatched`.
 * - Then one D1 batch deletes the profile, every request in either direction, any match left, the invites they
 *   own, the blocks they made and their counters. Blocks other people made against them stay: they keep the
 *   blocker safe if this id comes back.
 * - Reports they filed keep their evidence, with `reporter` set to `'deleted'`; reports about them stay until
 *   closed (the cron purges their evidence on the usual schedule).
 * - The `users` row goes last, in that batch. It stays (as a tombstone with `verified` cleared) only while a
 *   moderator's hide or mute on it still holds, so deleting is never a way out of one. A banned person gets 403
 *   before this runs (see `bannedGate`).
 * - Their live sockets, and their inbox, close with `LIVE_CLOSE.deleted`, and the gate forgets them.
 *
 * The Clerk sign-in account is not touched: that is Clerk's, deleted there.
 */
export async function deleteAccount(
  env: Env,
  userId: string,
  later: Later = floating,
  now = Date.now(),
): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT a, b FROM matches WHERE a = ?1 OR b = ?1')
    .bind(userId)
    .all<{ a: string; b: string }>()
  for (const m of results) {
    const other = m.a === userId ? m.b : m.a
    const matchId = await endMatch(env, userId, other, 'delete', now)
    if (matchId) later(notify(env, other, { t: 'unmatched', matchId }))
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM matches WHERE a = ?1 OR b = ?1').bind(userId),
    env.DB.prepare('DELETE FROM requests WHERE from_id = ?1 OR to_id = ?1').bind(userId),
    env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM invites WHERE owner = ?').bind(userId),
    env.DB.prepare('DELETE FROM blocks WHERE a = ?').bind(userId),
    env.DB.prepare('DELETE FROM counters WHERE user_id = ?').bind(userId),
    env.DB.prepare("UPDATE reports SET reporter = 'deleted' WHERE reporter = ?").bind(userId),
    env.DB.prepare('UPDATE users SET verified = 0, verified_by = NULL WHERE id = ?').bind(userId),
    env.DB.prepare(
      'DELETE FROM users WHERE id = ?1 AND hidden = 0 AND banned = 0 AND (muted_until IS NULL OR muted_until <= ?2)',
    ).bind(userId, now),
  ])
  await refreshUser(env, userId, 'delete')
  return new Response(null, { status: 204 })
}
