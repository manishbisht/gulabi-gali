import type { Env } from './env'
import { activeRow } from './profiles'
import type { EndedChat } from './protocol'

/** A chat report carries this many of the match's latest messages. */
export const EVIDENCE_MESSAGES = 30
/** Held evidence is kept this long after the match ended, then the cron deletes it. */
export const HOLD_MS = 30 * 24 * 3600 * 1000

/** One message as a report carries it: who sent it, what it said, and when. Admins only. */
export interface HeldMessage {
  from: string
  body: string
  at: number
}

/** A chat's evidence: who the reporter was talking to, and the latest messages, oldest first. */
export interface ChatEvidence {
  other: string
  messages: HeldMessage[]
}

const oldestFirst = (x: HeldMessage, y: HeldMessage) => x.at - y.at

/**
 * The statement that keeps match `matchId`'s latest messages before it is deleted: for a batch that ends the
 * match (an unmatch, a block, a deletion), ahead of the delete. It writes only while the match is still
 * there, so of two ends racing only the one that wins holds a copy. `owner` ended it; `other` is the other side.
 * `names` are each side's first name as of now (empty for none), all the "Ended chats" list will show.
 */
export function holdEvidence(
  env: Env,
  matchId: string,
  owner: string,
  other: string,
  now = Date.now(),
  names: { owner: string; other: string } = { owner: '', other: '' },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO held_evidence (id, owner, other, match_id, messages, created_at, owner_name, other_name)
     SELECT ?1, ?2, ?3, ?4, (
       SELECT json_group_array(json_object('from', sender, 'body', body, 'at', created_at)) FROM (
         SELECT sender, body, created_at FROM messages WHERE match_id = ?4
         ORDER BY created_at DESC, id DESC LIMIT ?6)), ?5, ?7, ?8
     WHERE EXISTS (SELECT 1 FROM matches WHERE id = ?4)`,
  ).bind(crypto.randomUUID(), owner, other, matchId, now, EVIDENCE_MESSAGES, names.owner, names.other)
}

/** The most ended chats `GET /api/ended` lists: far more than 30 days bring, never an unbounded read. */
const ENDED_LIMIT = 100

/**
 * `GET /api/ended`: the caller's chats that ended in the last 30 days (an unmatch, a block, a deletion, by
 * either side), newest first, so a chat can still be reported once it is gone from the chat list: the other
 * person's id and the first name saved when it ended (null for none), never live profile data. Only a resident
 * (403 `ghost`), like reporting.
 */
export async function listEnded(env: Env, userId: string, now = Date.now()): Promise<Response> {
  if (!(await activeRow(env, userId))) return Response.json({ error: 'ghost' }, { status: 403 })
  const { results } = await env.DB.prepare(
    `SELECT match_id, created_at, CASE WHEN owner = ?1 THEN other ELSE owner END AS person,
       CASE WHEN owner = ?1 THEN other_name ELSE owner_name END AS name
     FROM held_evidence WHERE (owner = ?1 OR other = ?1) AND created_at > ?2
     ORDER BY created_at DESC LIMIT ?3`,
  )
    .bind(userId, now - HOLD_MS, ENDED_LIMIT)
    .all<{ match_id: string; created_at: number; person: string; name: string }>()
  const out: EndedChat[] = results.map((r) => ({
    matchId: r.match_id,
    person: { id: r.person, name: r.name || null },
    endedAt: r.created_at,
  }))
  return Response.json(out)
}

/**
 * What a chat report by `reporter` about `matchId` carries, assembled on the server only: the match's latest
 * messages while it lasts and the reporter is in it, or what was held when it ended, for 30 days. Null for a
 * match the reporter was never in, or one that ended more than 30 days ago.
 */
export async function chatEvidence(
  env: Env,
  reporter: string,
  matchId: string,
  now = Date.now(),
): Promise<ChatEvidence | null> {
  const match = await env.DB.prepare('SELECT a, b FROM matches WHERE id = ?1 AND (a = ?2 OR b = ?2)')
    .bind(matchId, reporter)
    .first<{ a: string; b: string }>()
  if (match) {
    const { results } = await env.DB.prepare(
      `SELECT sender AS "from", body, created_at AS at FROM messages WHERE match_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
      .bind(matchId, EVIDENCE_MESSAGES)
      .all<HeldMessage>()
    return { other: match.a === reporter ? match.b : match.a, messages: results.reverse() }
  }
  const held = await env.DB.prepare(
    `SELECT owner, other, messages FROM held_evidence
     WHERE match_id = ?1 AND (owner = ?2 OR other = ?2) AND created_at > ?3
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(matchId, reporter, now - HOLD_MS)
    .first<{ owner: string; other: string; messages: string }>()
  if (!held) return null
  // Held newest first; turned round, then sorted (stably) in case the copy came out in another order.
  const messages = (JSON.parse(held.messages) as HeldMessage[]).reverse().sort(oldestFirst)
  return { other: held.owner === reporter ? held.other : held.owner, messages }
}

/** The cron's sweep: evidence held for 30 days goes. */
export async function purgeEvidence(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare('DELETE FROM held_evidence WHERE created_at <= ?')
    .bind(now - HOLD_MS)
    .run()
}
