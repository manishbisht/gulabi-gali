import type { Env } from './env'
import { holdEvidence } from './evidence'
import { wordsOk } from './filter/server'
import { floating, notify, type Later } from './inbox'
import { ACTIVE, activeRow, isBlocked, toPublic } from './profiles'
import { pairOf } from './requests'
import {
  MAX_MESSAGE,
  MAX_MESSAGE_LINES,
  type AvatarLookWire,
  type ChatError,
  type ChatMessage,
  type MatchView,
  type MessagePage,
} from './protocol'

/** Messages per page of a chat. */
export const PAGE_SIZE = 50
/** The most matches `GET /api/matches` returns: far more than anyone keeps, never an unbounded read. */
const MATCH_LIMIT = 100
/** A sender's messages in one match must be at least this far apart. */
export const MESSAGE_GAP_MS = 1000
/** Raw input past this many UTF-16 units is refused before any cleaning: no clean can bring it to 500. */
const MAX_RAW = 20 * MAX_MESSAGE
const MAX_ID = 200

const fail = (error: ChatError, status: number) => Response.json({ error }, { status })
const notFound = () => fail('not-found', 404)

/**
 * A chat message cleaned like a request reason (NFC, no control or format characters, each run of spaces one
 * space) but keeping its lines: blank lines at either end go, and past the tenth line the rest are joined onto
 * it with spaces, so nothing typed is lost. Null unless 1-500 code points remain.
 */
export function cleanMessage(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > MAX_RAW) return null
  const lines = x
    .normalize('NFC')
    .split(/\r\n?|\n/)
    .map((line) =>
      line
        .replace(/\s+/gu, ' ')
        .replace(/[\p{Cc}\p{Cf}]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim(),
    )
  while (lines.length && !lines[0]) lines.shift()
  while (lines.length && !lines.at(-1)) lines.pop()
  if (lines.length > MAX_MESSAGE_LINES) {
    const rest = lines
      .splice(MAX_MESSAGE_LINES - 1)
      .filter(Boolean)
      .join(' ')
    lines.push(rest)
  }
  const text = lines.join('\n')
  const points = [...text].length
  return points >= 1 && points <= MAX_MESSAGE ? text : null
}

interface Member {
  id: string
  other: string
}

/**
 * The match `matchId`, when `userId` is in it and may still act as themself (`ACTIVE`). With `both`, the other
 * side must be active too (a banned member's chat cannot be read or written). A hidden member's chat goes on,
 * for both of them: it is evidence, and the review should be fair. Null for everything else alike, so a caller
 * can only ever answer 404: whether a match exists never leaks.
 */
async function member(env: Env, userId: string, matchId: string, both: boolean): Promise<Member | null> {
  if (matchId.length > MAX_ID) return null
  const [me, match] = await Promise.all([
    activeRow(env, userId),
    env.DB.prepare('SELECT id, a, b FROM matches WHERE id = ? AND (a = ? OR b = ?)')
      .bind(matchId, userId, userId)
      .first<{ id: string; a: string; b: string }>(),
  ])
  if (!me || !match) return null
  const other = match.a === userId ? match.b : match.a
  if (both && !(await activeRow(env, other))) return null
  // A block ends the match, so this only catches a race; a blocked pair can neither read nor write.
  if (both && (await isBlocked(env, userId, other))) return null
  return { id: match.id, other }
}

interface MessageRow {
  id: string
  sender: string
  body: string
  created_at: number
}

const view = (row: MessageRow, userId: string): ChatMessage => ({
  id: row.id,
  body: row.body,
  at: row.created_at,
  mine: row.sender === userId,
})

/** The cursor for the page before `row`: its time and id (ties on time are ordered by id), base64url. */
function writeCursor(row: MessageRow): string {
  return btoa(`${row.created_at}:${row.id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function readCursor(cursor: string): { at: number; id: string } | null {
  if (!/^[A-Za-z0-9_-]{1,300}$/.test(cursor)) return null
  let text: string
  try {
    text = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return null
  }
  const m = text.match(/^(\d{1,16}):([\x21-\x7e]{1,200})$/)
  return m ? { at: Number(m[1]), id: m[2] } : null
}

/**
 * `GET /api/matches`: the asker's matches with someone still active on the other side (`ACTIVE`), most recently
 * active first. A match with someone hidden since stays, with their first-name public face: hiding stops new
 * contact (the map, the profile card, new requests and matches), not a chat already going, which the other
 * member can still read, write, report or end.
 */
export async function listMatches(env: Env, userId: string): Promise<Response> {
  if (!(await activeRow(env, userId))) return fail('ghost', 403)
  // One query: the other side's profile and each match's last message come in by join.
  const { results } = await env.DB.prepare(
    `SELECT m.id, p.user_id, p.name, p.look, p.status,
            l.body AS last_body, l.created_at AS last_at, l.sender AS last_sender
     FROM matches m
     JOIN profiles p ON p.user_id = CASE WHEN m.a = ?1 THEN m.b ELSE m.a END
     JOIN users u ON u.id = p.user_id
     LEFT JOIN messages l ON l.id = (
       SELECT id FROM messages WHERE match_id = m.id ORDER BY created_at DESC, id DESC LIMIT 1)
     WHERE (m.a = ?1 OR m.b = ?1) AND ${ACTIVE}
       AND NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.a = ?1 AND k.b = p.user_id) OR (k.b = ?1 AND k.a = p.user_id))
     ORDER BY COALESCE(l.created_at, m.created_at) DESC, m.id DESC
     LIMIT ?2`,
  )
    .bind(userId, MATCH_LIMIT)
    .all<{
      id: string
      user_id: string
      name: string
      look: string
      status: string
      last_body: string | null
      last_at: number | null
      last_sender: string | null
    }>()
  const out: MatchView[] = results.map((r) => {
    const person = toPublic({
      id: r.user_id,
      name: r.name,
      look: JSON.parse(r.look) as AvatarLookWire,
      status: r.status,
    })
    return r.last_at === null
      ? { id: r.id, person }
      : { id: r.id, person, last: { body: r.last_body!, at: r.last_at, mine: r.last_sender === userId } }
  })
  return Response.json(out)
}

/** `GET /api/matches/:id/messages?before=`: up to `PAGE_SIZE` messages, newest last. */
export async function listMessages(
  env: Env,
  userId: string,
  matchId: string,
  before: string | null,
): Promise<Response> {
  const match = await member(env, userId, matchId, true)
  if (!match) return notFound()
  const cursor = before ? readCursor(before) : null
  if (before && !cursor) return fail('invalid', 400)
  const stmt = cursor
    ? env.DB.prepare(
        `SELECT id, sender, body, created_at FROM messages
         WHERE match_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      ).bind(match.id, cursor.at, cursor.at, cursor.id, PAGE_SIZE + 1)
    : env.DB.prepare(
        'SELECT id, sender, body, created_at FROM messages WHERE match_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      ).bind(match.id, PAGE_SIZE + 1)
  const { results } = await stmt.all<MessageRow>()
  const rows = results.slice(0, PAGE_SIZE).reverse()
  const page: MessagePage = {
    messages: rows.map((r) => view(r, userId)),
    before: results.length > PAGE_SIZE ? writeCursor(rows[0]) : null,
  }
  return Response.json(page)
}

/**
 * `POST /api/matches/:id/messages {body}`: 201 with the message as the sender sees it, and a nudge to the other
 * member's inbox. A sender gets one message a second per match (429 `rate`), checked in the same statement as
 * the insert, so two at once cannot both slip through.
 */
export async function postMessage(
  env: Env,
  userId: string,
  matchId: string,
  raw: unknown,
  now = Date.now(),
  later: Later = floating,
): Promise<Response> {
  const match = await member(env, userId, matchId, true)
  if (!match) return notFound()
  const body = cleanMessage(typeof raw === 'object' && raw !== null ? (raw as { body?: unknown }).body : null)
  if (body === null) return fail('invalid', 400)
  if (!wordsOk(body)) return Response.json({ error: 'words', field: 'body' }, { status: 400 })
  const id = crypto.randomUUID()
  const { meta } = await env.DB.prepare(
    `INSERT INTO messages (id, match_id, sender, body, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5
     WHERE EXISTS (SELECT 1 FROM matches WHERE id = ?2)
       AND NOT EXISTS (SELECT 1 FROM messages WHERE match_id = ?2 AND sender = ?3 AND created_at > ?6)`,
  )
    .bind(id, match.id, userId, body, now, now - MESSAGE_GAP_MS)
    .run()
  if (!meta.changes) {
    // Either too soon, or the match went (an unmatch) since it was read.
    const still = await env.DB.prepare('SELECT 1 AS x FROM matches WHERE id = ?').bind(match.id).first()
    return still ? fail('rate', 429) : notFound()
  }
  later(notify(env, match.other, { t: 'message', matchId: match.id, id }))
  const sent: ChatMessage = { id, body, at: now, mine: true }
  return Response.json(sent, { status: 201 })
}

/**
 * `DELETE /api/matches/:id`: the match ends for both people (see `endMatch`), and the other one is told.
 */
export async function unmatch(
  env: Env,
  userId: string,
  matchId: string,
  later: Later = floating,
): Promise<Response> {
  const match = await member(env, userId, matchId, false)
  if (!match) return notFound()
  // The other side unmatched first.
  if ((await endMatch(env, userId, match.other, 'unmatch')) !== match.id) return notFound()
  later(notify(env, match.other, { t: 'unmatched', matchId: match.id }))
  return new Response(null, { status: 204 })
}

/**
 * Ends the match between `userId` and `other`, in one batch: its latest messages are held as evidence (see
 * `holdEvidence`), then the match goes, and its messages with it (cascade). Answers the match id when this
 * call ended it, or null when there was none (never matched, or the other side ended it first). Nobody is
 * notified here: that is the caller's.
 *
 * - `unmatch`: the accepted requests that made it go too; an ignored one stays and blocks for its 14 days.
 *   In their place the other person gets an ignored request to the one who unmatched, dated now: the same
 *   14-day block a decline gives, so they cannot ask straight back, while the one who unmatched may ask again
 *   whenever they like. It carries an empty reason (a real one is 10 to 140 characters), which is how
 *   `listRequests` knows to leave it out.
 * - `block`: every request between them goes, whatever its state; the block itself keeps them apart.
 */
export async function endMatch(
  env: Env,
  userId: string,
  other: string,
  why: 'unmatch' | 'block',
  now = Date.now(),
): Promise<string | null> {
  const [a, b] = pairOf(userId, other)
  const match = await env.DB.prepare('SELECT id FROM matches WHERE a = ? AND b = ?')
    .bind(a, b)
    .first<{ id: string }>()
  const requests =
    why === 'unmatch'
      ? [
          // Only while the match is still there: if the other side unmatched first, theirs is the block that
          // stands.
          env.DB.prepare(
            `INSERT INTO requests (id, from_id, to_id, reason, created_at, state)
             SELECT ?1, ?2, ?3, '', ?4, 'ignored' WHERE EXISTS (SELECT 1 FROM matches WHERE id = ?5)`,
          ).bind(crypto.randomUUID(), other, userId, now, match?.id ?? ''),
          env.DB.prepare(
            `DELETE FROM requests WHERE state = 'accepted'
             AND ((from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1))`,
          ).bind(userId, other),
        ]
      : [
          env.DB.prepare(
            // Not the ignored ones: a decline or an unmatch's 14-day cooldown outlives a block and an unblock.
            `DELETE FROM requests WHERE state != 'ignored'
             AND ((from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1))`,
          ).bind(userId, other),
        ]
  if (!match) {
    // Nothing to end, but a block still clears the requests.
    if (why === 'block') await env.DB.batch(requests)
    return null
  }
  const results = await env.DB.batch([
    holdEvidence(env, match.id, userId, other, now),
    ...requests,
    env.DB.prepare('DELETE FROM matches WHERE id = ?').bind(match.id),
  ])
  return results.at(-1)!.meta.changes ? match.id : null
}
