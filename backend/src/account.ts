import { endMatch } from './chat'
import type { Env } from './env'
import { GATE_NAME } from './gate'
import { floating, notify, type Later } from './inbox'
import { forgetOwner, takeDownAllOf, tellRemoved, type Placed } from './posters'
import { refreshUser } from './refresh'
import { AUTO_HIDE, COUNTED_REPORTS } from './reports'

/** How many times `deleteAccount` looks again for a match made while it was running. */
const MATCH_PASSES = 3

/**
 * `DELETE /api/me`: the person's account is erased, and they can start again with a blank profile. 204, also
 * when there was nothing left to delete (running it twice changes nothing). A banned person may delete too.
 *
 * - Every match ends through `endMatch(..., 'delete')`: its last 30 messages are held as evidence (the
 *   `held_evidence` rows the cron deletes after 30 days) before the match and its messages go. The other
 *   person hears `unmatched`. Matches are looked for again (at most `MATCH_PASSES` times), so one made while
 *   this ran is held too.
 * - Then one D1 batch deletes the profile, every pending or accepted request in either direction, any match
 *   left, the invites they own, their posters (off every wall at once) and what was remembered of them for
 *   blocking from a poster that came down (`poster_owners`), the blocks they made and their counters. `ignored` requests stay with their
 *   reason blanked: they are the 14-day cooldowns (a decline, an unmatch), which a delete must not wipe, and
 *   the cron sweeps them. Blocks other people made against them stay (their saved name blanked): they keep the
 *   blocker safe if this id comes back.
 * - Reports they filed keep their evidence, with `reporter` set to `'deleted'`; reports about them stay until
 *   closed.
 * - The `users` row is deleted last, in that batch. It stays as a tombstone (`verified` cleared) while anything
 *   it must remember holds: a ban, a hide (or enough counted reports to auto-hide, which hides them now), a
 *   mute, or a cooldown row (which the `requests` foreign key ties to it). So deleting is no way out of any of
 *   them: a banned id that returns is still banned.
 * - Their live sockets, and their inbox, close with `LIVE_CLOSE.deleted`, and the gate forgets them (also
 *   when no socket is open).
 *
 * The Clerk sign-in account is not touched: that is Clerk's, deleted there.
 */
export async function deleteAccount(
  env: Env,
  userId: string,
  later: Later = floating,
  now = Date.now(),
): Promise<Response> {
  for (let pass = 0; pass < MATCH_PASSES; pass++) {
    const { results } = await env.DB.prepare('SELECT a, b FROM matches WHERE a = ?1 OR b = ?1')
      .bind(userId)
      .all<{ a: string; b: string }>()
    if (!results.length) break
    for (const m of results) {
      const other = m.a === userId ? m.b : m.a
      const matchId = await endMatch(env, userId, other, 'delete', now)
      if (matchId) later(notify(env, other, { t: 'unmatched', matchId }))
    }
  }
  const counted = await env.DB.prepare(
    `SELECT COUNT(DISTINCT reporter) AS n FROM reports WHERE ${COUNTED_REPORTS}`,
  )
    .bind(userId, now - AUTO_HIDE.windowMs)
    .first<{ n: number }>()
  const posters = takeDownAllOf(env, userId)
  const statements = [
    // Enough reports to hide them: they are hidden now, so the tombstone below keeps it.
    env.DB.prepare('UPDATE users SET hidden = 1 WHERE id = ?1 AND ?2 = 1').bind(
      userId,
      (counted?.n ?? 0) >= AUTO_HIDE.reporters ? 1 : 0,
    ),
    env.DB.prepare('DELETE FROM matches WHERE a = ?1 OR b = ?1').bind(userId),
    env.DB.prepare("DELETE FROM requests WHERE state != 'ignored' AND (from_id = ?1 OR to_id = ?1)").bind(
      userId,
    ),
    env.DB.prepare(
      "UPDATE requests SET reason = '' WHERE state = 'ignored' AND (from_id = ?1 OR to_id = ?1)",
    ).bind(userId),
    env.DB.prepare('DELETE FROM profiles WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM invites WHERE owner = ?').bind(userId),
    posters,
    // After `posters`: its trigger has just remembered them, and they must not be.
    forgetOwner(env, userId),
    env.DB.prepare('DELETE FROM blocks WHERE a = ?').bind(userId),
    env.DB.prepare("UPDATE blocks SET name = '' WHERE b = ?").bind(userId),
    env.DB.prepare('DELETE FROM counters WHERE user_id = ?').bind(userId),
    env.DB.prepare("UPDATE reports SET reporter = 'deleted' WHERE reporter = ?").bind(userId),
    env.DB.prepare('UPDATE users SET verified = 0, verified_by = NULL WHERE id = ?').bind(userId),
    env.DB.prepare(
      `DELETE FROM users WHERE id = ?1 AND hidden = 0 AND banned = 0 AND (muted_until IS NULL OR muted_until <= ?2)
       AND NOT EXISTS (SELECT 1 FROM requests WHERE from_id = ?1 OR to_id = ?1)`,
    ).bind(userId, now),
  ]
  const done = await env.DB.batch(statements)
  await Promise.all([
    refreshUser(env, userId, 'delete'),
    tellRemoved(env, done[statements.indexOf(posters)]!.results as Placed[]),
  ])
  try {
    await env.GATE.get(env.GATE.idFromName(GATE_NAME)).forget(userId)
  } catch (err) {
    console.error('account: gate forget failed', err)
  }
  return new Response(null, { status: 204 })
}
