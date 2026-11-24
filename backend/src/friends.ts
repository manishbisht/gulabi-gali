import { benchDistrict } from './district'
import type { Env } from './env'
import { GATE_NAME } from './gate'
import { floating, notify, type Later } from './inbox'
import { allow, DAY_MS, muteGate, rateLimited } from './limits'
import { firstName } from './names'
import { activeRow, isBlocked, visibleAs, visibleRow } from './profiles'
import {
  CHAI_TTL_MS,
  type BenchKind,
  type ChaiInviteView,
  type DistrictId,
  type FriendAsk,
  type FriendLists,
  type FriendSettings,
  type FriendState,
  type FriendView,
} from './protocol'
import { pairOf } from './requests'

/*
 * Friends ("Dost banao") and "Chai pe bulao" (migration 0010).
 *
 * Consent: only two residents who are matched (an accepted chat) can be friends, and only once both said yes:
 * one asks, the other accepts or declines. A decline is never told: the asker sees it pending until it runs out.
 * Either side removes the friendship at any time, silently. It ends by itself with the match (an unmatch, a block
 * either way, a deletion), and when either is hidden or banned: the migration's triggers take it, its asks and its
 * invites, and nothing brings it back.
 *
 * Presence: a friend's row says "gali mein hai · <district>" only while they are on the street as someone others
 * can see (a resident the gate holds a slot for in that district: never a ghost, someone waiting for room, hidden
 * or banned) and have "dosto ko dikhao" on. It is read when the list is asked for (never pushed to anyone's
 * socket), and gives the district only, never where in it. Off, away or waiting all look the same: no `here`.
 *
 * Invites: while seated at a bench, a resident invites a friend there. The friend's inbox hears `chai`, which
 * pushes when no inbox is open ("Gulabi Gali: ek dost ne chai pe bulaya", naming nobody: see push.ts); the app
 * then shows who and which bench. Whether it reached them or not (invites off, hidden, blocked, a ghost, not a
 * friend), the sender gets the same answer and the same limits are spent, so the sender learns nothing.
 */

/** An ask stands this long (a declined one too, read as pending), then the cron deletes it. */
export const FRIEND_ASK_TTL_MS = 14 * DAY_MS
/** New asks per account a day. */
export const FRIEND_ASK_LIMIT = { perWindow: 20, windowMs: DAY_MS, bucket: 'friend-ask' } as const
/** Accepts, declines and removals per account an hour. */
export const FRIEND_CHANGE_LIMIT = { perWindow: 60, windowMs: 3600_000, bucket: 'friend-change' } as const
/** Switch flips per account an hour. */
export const FRIEND_SETTINGS_LIMIT = { perWindow: 30, windowMs: 3600_000, bucket: 'friend-settings' } as const
/**
 * `GET /api/friends` per account a minute: each one may ask the gate where friends are, so it stays small. A page
 * looks again at most every 30 seconds while the list is open.
 */
export const FRIEND_READ_LIMIT = { perWindow: 20, windowMs: 60_000, bucket: 'read-friends' } as const
/** `GET /api/chai` per account a minute: on each inbox (re)connect and each `chai` notice. */
export const CHAI_READ_LIMIT = { perWindow: 30, windowMs: 60_000, bucket: 'read-chai' } as const
/**
 * Invites: one per friend each 10 minutes, and five an hour in all. Every try that gets past the sender's own
 * checks counts, whether it reached anyone or not.
 */
export const CHAI_LIMIT = {
  pair: { perWindow: 1, windowMs: 10 * 60_000, bucket: 'chai-pair' },
  sender: { perWindow: 5, windowMs: 3600_000, bucket: 'chai' },
} as const
/** The most friends (and asks each way) a list carries: far more than anyone keeps. */
export const MAX_FRIENDS = 100

const MAX_ID = 200
const BENCH_KINDS: readonly BenchKind[] = ['bench', 'tapri']

const fail = (error: string, status: number) => Response.json({ error }, { status })
const noContent = () => new Response(null, { status: 204 })

/** One use of `limit` by `userId` (under `bucket`, when it is not the limit's own): null within it, else the 429. */
async function spend(
  env: Env,
  userId: string,
  limit: { perWindow: number; windowMs: number; bucket: string },
  now: number,
  bucket = limit.bucket,
): Promise<Response | null> {
  return (await allow(env, userId, bucket, limit.perWindow, limit.windowMs, now))
    ? null
    : rateLimited(limit.windowMs, now)
}

/** A person id from a request: a string of sane length, or null. */
const idOf = (x: unknown): string | null => (typeof x === 'string' && x && x.length <= MAX_ID ? x : null)

/** Whether `x` and `y` are friends. */
async function areFriends(env: Env, x: string, y: string): Promise<boolean> {
  const [a, b] = pairOf(x, y)
  return (
    (await env.DB.prepare('SELECT 1 AS x FROM friends WHERE a = ? AND b = ?').bind(a, b).first()) !== null
  )
}

/** A person's switches (both on without a row). */
async function settingsOf(env: Env, userId: string): Promise<FriendSettings> {
  const row = await env.DB.prepare(
    'SELECT show_presence, chai_invites FROM friend_settings WHERE user_id = ?',
  )
    .bind(userId)
    .first<{ show_presence: number; chai_invites: number }>()
  return { showPresence: row?.show_presence !== 0, chaiInvites: row?.chai_invites !== 0 }
}

/** The other person (`?1` is the asker) is someone others can see, and no block stands either way. */
const OTHER_OK = `${visibleAs('u', 'p')}
  AND NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.a = ?1 AND k.b = p.user_id) OR (k.a = p.user_id AND k.b = ?1))`

/**
 * `GET /api/friends`: the caller's friends (first names, and `here` as the module note says), the asks to them
 * and from them that still stand, and their own switches. Residents only (403 `ghost`); 429 past
 * `FRIEND_READ_LIMIT`.
 */
export async function listFriends(env: Env, userId: string, now = Date.now()): Promise<Response> {
  if (!(await activeRow(env, userId))) return fail('ghost', 403)
  const slow = await spend(env, userId, FRIEND_READ_LIMIT, now)
  if (slow) return slow
  const cutoff = now - FRIEND_ASK_TTL_MS
  const [friendRows, incoming, sent, settings] = await Promise.all([
    env.DB.prepare(
      `SELECT p.user_id AS id, p.name, COALESCE(s.show_presence, 1) AS share
       FROM friends f
       JOIN profiles p ON p.user_id = CASE WHEN f.a = ?1 THEN f.b ELSE f.a END
       JOIN users u ON u.id = p.user_id
       LEFT JOIN friend_settings s ON s.user_id = p.user_id
       WHERE (f.a = ?1 OR f.b = ?1) AND ${OTHER_OK}
       ORDER BY p.name, p.user_id LIMIT ?2`,
    )
      .bind(userId, MAX_FRIENDS)
      .all<{ id: string; name: string; share: number }>(),
    env.DB.prepare(
      `SELECT p.user_id AS id, p.name FROM friend_requests r
       JOIN profiles p ON p.user_id = r.from_id JOIN users u ON u.id = p.user_id
       WHERE r.to_id = ?1 AND r.state = 'pending' AND r.created_at > ?2 AND ${OTHER_OK}
       ORDER BY r.created_at DESC LIMIT ?3`,
    )
      .bind(userId, cutoff, MAX_FRIENDS)
      .all<{ id: string; name: string }>(),
    // A declined ask reads as pending: the asker is never told.
    env.DB.prepare(
      `SELECT p.user_id AS id, p.name FROM friend_requests r
       JOIN profiles p ON p.user_id = r.to_id JOIN users u ON u.id = p.user_id
       WHERE r.from_id = ?1 AND r.created_at > ?2 AND ${OTHER_OK}
       ORDER BY r.created_at DESC LIMIT ?3`,
    )
      .bind(userId, cutoff, MAX_FRIENDS)
      .all<{ id: string; name: string }>(),
    settingsOf(env, userId),
  ])
  // Only friends who share it are ever asked about: the gate never hears the others' ids.
  const sharing = friendRows.results.filter((r) => r.share === 1).map((r) => r.id)
  let where: Record<string, string> = {}
  if (sharing.length) {
    try {
      where = await env.GATE.get(env.GATE.idFromName(GATE_NAME)).where(sharing)
    } catch (err) {
      // The list still comes, with nobody shown out: that reads the same as everyone being away.
      console.error('friends: gate where failed', err)
    }
  }
  const friends: FriendView[] = friendRows.results.map((r) => {
    const here = r.share === 1 ? where[r.id] : undefined
    return here
      ? { id: r.id, name: firstName(r.name), here: here as DistrictId }
      : { id: r.id, name: firstName(r.name) }
  })
  const ask = (r: { id: string; name: string }): FriendAsk => ({ id: r.id, name: firstName(r.name) })
  const out: FriendLists = {
    friends,
    incoming: incoming.results.map(ask),
    sent: sent.results.map(ask),
    settings,
  }
  return Response.json(out, { headers: { 'cache-control': 'private, no-store' } })
}

/** Makes `x` and `y` friends in one batch, only if `y`'s pending ask to `x` still stands, they are matched and no block stands; true when it did. */
async function befriend(env: Env, x: string, y: string, now: number): Promise<boolean> {
  const [a, b] = pairOf(x, y)
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO friends (a, b, created_at)
       SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM matches WHERE a = ?1 AND b = ?2)
         AND EXISTS (SELECT 1 FROM friend_requests WHERE from_id = ?4 AND to_id = ?5 AND state = 'pending' AND created_at > ?6)
         AND NOT EXISTS (SELECT 1 FROM blocks WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1))`,
    ).bind(a, b, now, y, x, now - FRIEND_ASK_TTL_MS),
    env.DB.prepare(
      'DELETE FROM friend_requests WHERE ((from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)) AND EXISTS (SELECT 1 FROM friends WHERE a = ?3 AND b = ?4)',
    ).bind(x, y, a, b),
  ])
  return results[0]!.meta.changes > 0 || (await areFriends(env, x, y))
}

/**
 * The checks both an ask and an accept make: the caller (`me`) and `other` are residents others can see, no
 * block stands, and they are matched. Answers the caller's error, or null when all hold.
 */
async function reachable(env: Env, me: string, other: string): Promise<Response | null> {
  const [a, b] = pairOf(me, other)
  const [them, blocked, matched] = await Promise.all([
    visibleRow(env, other),
    isBlocked(env, me, other),
    env.DB.prepare('SELECT 1 AS x FROM matches WHERE a = ? AND b = ?').bind(a, b).first(),
  ])
  return !them || blocked || !matched ? fail('not-found', 404) : null
}

/**
 * `POST /api/friends {to}`: "Dost banao". 201 `{state: 'asked'}` for a new ask (the other side's inbox hears
 * `friend`; no push); 200 `{state: 'asked'}` when one already stands (pending or, unknown to the asker,
 * declined); 200 `{state: 'friends'}` when they had asked too, or already are. The caller must be a resident others
 * can see (403 `ghost`), not muted (403 `muted`); `to` someone they are matched with, who others can see, with no
 * block either way: anyone else is 404 `not-found`, alike. 400 for no `to`, or yourself; 429 past
 * `FRIEND_ASK_LIMIT`.
 */
export async function askFriend(
  env: Env,
  userId: string,
  raw: unknown,
  now = Date.now(),
  later: Later = floating,
): Promise<Response> {
  if (!(await visibleRow(env, userId))) return fail('ghost', 403)
  const muted = await muteGate(env, userId, now)
  if (muted) return muted
  const to = idOf((raw as { to?: unknown } | null)?.to)
  if (!to || to === userId) return fail('invalid', 400)
  const refused = await reachable(env, userId, to)
  if (refused) return refused
  const state = (s: FriendState, status = 200) => Response.json({ state: s }, { status })
  if (await areFriends(env, userId, to)) return state('friends')
  const cutoff = now - FRIEND_ASK_TTL_MS
  // They asked already: this is their yes.
  if (await befriend(env, userId, to, now)) {
    later(notify(env, to, { t: 'friend' }))
    return state('friends')
  }
  const mine = await env.DB.prepare(
    'SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ? AND created_at > ?',
  )
    .bind(userId, to, cutoff)
    .first()
  if (mine) return state('asked')
  const slow = await spend(env, userId, FRIEND_ASK_LIMIT, now)
  if (slow) return slow
  const [a, b] = pairOf(userId, to)
  // In one statement with the match and block checks, so a block or an unmatch landing meanwhile wins.
  const { meta } = await env.DB.prepare(
    `INSERT OR REPLACE INTO friend_requests (from_id, to_id, created_at, state)
     SELECT ?1, ?2, ?3, 'pending' WHERE EXISTS (SELECT 1 FROM matches WHERE a = ?4 AND b = ?5)
       AND NOT EXISTS (SELECT 1 FROM blocks WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1))`,
  )
    .bind(userId, to, now, a, b)
    .run()
  if (!meta.changes) return fail('not-found', 404)
  // Both asked at the same moment, each before the other's ask was written: whoever looks again now finds it.
  if (await befriend(env, userId, to, now)) {
    later(Promise.all([notify(env, to, { t: 'friend' }), notify(env, userId, { t: 'friend' })]))
    return state('friends')
  }
  later(notify(env, to, { t: 'friend' }))
  return state('asked', 201)
}

/**
 * `POST /api/friends/:id/accept`: the caller says yes to `from`'s ask. 200 `{state: 'friends'}` (the asker's inbox
 * hears `friend`). 404 `not-found` alike for no such ask (none, declined, run out), or one that can no longer be
 * met (either side hidden, banned, blocked, the match gone); 403 `ghost`; 429 past `FRIEND_CHANGE_LIMIT`.
 */
export async function acceptFriend(
  env: Env,
  userId: string,
  from: string,
  now = Date.now(),
  later: Later = floating,
): Promise<Response> {
  if (!(await visibleRow(env, userId))) return fail('ghost', 403)
  if (!idOf(from) || from === userId) return fail('not-found', 404)
  const slow = await spend(env, userId, FRIEND_CHANGE_LIMIT, now)
  if (slow) return slow
  const refused = await reachable(env, userId, from)
  if (refused) return refused
  if (!(await befriend(env, userId, from, now))) return fail('not-found', 404)
  later(notify(env, from, { t: 'friend' }))
  return Response.json({ state: 'friends' satisfies FriendState })
}

/** `POST /api/friends/:id/decline`: 204, whatever there was. The asker is never told (see `listFriends`). */
export async function declineFriend(
  env: Env,
  userId: string,
  from: string,
  now = Date.now(),
): Promise<Response> {
  if (!(await activeRow(env, userId))) return fail('ghost', 403)
  if (!idOf(from)) return noContent()
  const slow = await spend(env, userId, FRIEND_CHANGE_LIMIT, now)
  if (slow) return slow
  await env.DB.prepare(
    "UPDATE friend_requests SET state = 'declined' WHERE from_id = ? AND to_id = ? AND state = 'pending'",
  )
    .bind(from, userId)
    .run()
  return noContent()
}

/**
 * `DELETE /api/friends/:id`: the friendship with `id` ends (its invites with it), and any ask the caller made them
 * is taken back. 204, also when there was nothing; nobody is told. Anyone signed in may remove theirs.
 */
export async function removeFriend(
  env: Env,
  userId: string,
  id: string,
  now = Date.now(),
): Promise<Response> {
  if (!idOf(id)) return noContent()
  const slow = await spend(env, userId, FRIEND_CHANGE_LIMIT, now)
  if (slow) return slow
  const [a, b] = pairOf(userId, id)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM friends WHERE a = ? AND b = ?').bind(a, b),
    env.DB.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').bind(userId, id),
  ])
  return noContent()
}

/**
 * `PUT /api/me/friend-settings {showPresence?, chaiInvites?}`: 200 with both switches as they now stand. At least
 * one, each a boolean (400 `invalid`); residents only (403 `ghost`); 429 past `FRIEND_SETTINGS_LIMIT`.
 */
export async function putFriendSettings(
  env: Env,
  userId: string,
  raw: unknown,
  now = Date.now(),
): Promise<Response> {
  if (!(await activeRow(env, userId))) return fail('ghost', 403)
  const body = (typeof raw === 'object' && raw !== null ? raw : null) as Record<string, unknown> | null
  const show = body?.showPresence
  const chai = body?.chaiInvites
  const ok = (x: unknown) => x === undefined || typeof x === 'boolean'
  if (!body || (show === undefined && chai === undefined) || !ok(show) || !ok(chai))
    return fail('invalid', 400)
  const slow = await spend(env, userId, FRIEND_SETTINGS_LIMIT, now)
  if (slow) return slow
  const was = await settingsOf(env, userId)
  const next: FriendSettings = {
    showPresence: show === undefined ? was.showPresence : (show as boolean),
    chaiInvites: chai === undefined ? was.chaiInvites : (chai as boolean),
  }
  await env.DB.prepare(
    `INSERT INTO friend_settings (user_id, show_presence, chai_invites) VALUES (?1, ?2, ?3)
     ON CONFLICT (user_id) DO UPDATE SET show_presence = ?2, chai_invites = ?3`,
  )
    .bind(userId, next.showPresence ? 1 : 0, next.chaiInvites ? 1 : 0)
    .run()
  return Response.json(next)
}

/** The pair limit's bucket: the friend's id is hashed, so the counters table never holds who was invited. */
async function pairBucket(to: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(to))
  const hex = [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${CHAI_LIMIT.pair.bucket}:${hex}`
}

/** What every invite that gets past the sender's own checks is answered, delivered or not. */
const SENT = () => Response.json({ sent: true }, { status: 202 })

/**
 * `POST /api/chai {to, bench, kind}`: "Chai pe bulao". The caller must be a resident others can see (403
 * `ghost`), not muted (403 `muted`), and sit at `bench` now as one (409 `not-seated`); `bench` a real bench id and
 * `kind` `bench` or `tapri` (400 `invalid`). `CHAI_LIMIT` is spent (429 `rate`): the hour's before the seat
 * check, the friend's after it. From there on the answer is
 * always 202 `{sent: true}`: the invite is written and the friend's inbox hears `chai` (a push when none is open)
 * only when `to` is a friend, a resident others can see, with no block either way and invites on; otherwise
 * nothing happens at all.
 */
export async function sendChai(
  env: Env,
  userId: string,
  raw: unknown,
  now = Date.now(),
  later: Later = floating,
): Promise<Response> {
  if (!(await visibleRow(env, userId))) return fail('ghost', 403)
  const muted = await muteGate(env, userId, now)
  if (muted) return muted
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const to = idOf(body.to)
  const bench = typeof body.bench === 'string' ? body.bench : ''
  const district = bench ? benchDistrict(bench) : null
  const kind = BENCH_KINDS.find((k) => k === body.kind)
  if (!to || to === userId || !district || !kind) return fail('invalid', 400)
  // The hour's allowance before the seat check: a try never wakes a district more often than it allows.
  const slow = await spend(env, userId, CHAI_LIMIT.sender, now)
  if (slow) return slow
  let sits = false
  try {
    sits = await env.DISTRICT.get(env.DISTRICT.idFromName(district)).seatedAt(bench, userId)
  } catch (err) {
    console.error('chai: seat check failed', err)
  }
  if (!sits) return fail('not-seated', 409)
  const tooSoon = await spend(env, userId, CHAI_LIMIT.pair, now, await pairBucket(to))
  if (tooSoon) return tooSoon
  // Everything below is about the friend: none of it may change the answer.
  const [them, blocked, friends, theirs] = await Promise.all([
    visibleRow(env, to),
    isBlocked(env, userId, to),
    areFriends(env, userId, to),
    settingsOf(env, to),
  ])
  if (!them || blocked || !friends || !theirs.chaiInvites) return SENT()
  const [a, b] = pairOf(userId, to)
  // One live invite per pair, written only while the friendship stands (a removal or block meanwhile wins).
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM chai_invites WHERE from_id = ? AND to_id = ?').bind(userId, to),
    env.DB.prepare(
      `INSERT INTO chai_invites (id, from_id, to_id, bench, kind, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM friends WHERE a = ?7 AND b = ?8)`,
    ).bind(crypto.randomUUID(), userId, to, bench, kind, now, a, b),
  ])
  // The sender passed `visibleRow` above (a hidden person cannot invite), so this one may push.
  if (results[1]!.meta.changes) later(notify(env, to, { t: 'chai' }, { push: true }))
  return SENT()
}

/**
 * `GET /api/chai`: the invites to the caller that still stand (`CHAI_TTL_MS`, not dismissed), newest first, from
 * friends others can see with no block either way: the sender's first name, the bench and its district. Residents
 * only (403 `ghost`); 429 past `CHAI_READ_LIMIT`.
 */
export async function listChai(env: Env, userId: string, now = Date.now()): Promise<Response> {
  if (!(await activeRow(env, userId))) return fail('ghost', 403)
  const slow = await spend(env, userId, CHAI_READ_LIMIT, now)
  if (slow) return slow
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.bench, i.kind, i.created_at, p.name FROM chai_invites i
     JOIN profiles p ON p.user_id = i.from_id JOIN users u ON u.id = p.user_id
     WHERE i.to_id = ?1 AND i.dismissed = 0 AND i.created_at > ?2 AND ${OTHER_OK}
       AND EXISTS (SELECT 1 FROM friends f WHERE (f.a = ?1 AND f.b = i.from_id) OR (f.a = i.from_id AND f.b = ?1))
     ORDER BY i.created_at DESC LIMIT ?3`,
  )
    .bind(userId, now - CHAI_TTL_MS, MAX_FRIENDS)
    .all<{ id: string; bench: string; kind: BenchKind; created_at: number; name: string }>()
  const out: ChaiInviteView[] = []
  for (const r of results) {
    const district = benchDistrict(r.bench)
    if (district)
      out.push({
        id: r.id,
        name: firstName(r.name),
        bench: r.bench,
        kind: r.kind,
        district,
        at: r.created_at,
      })
  }
  return Response.json(out, { headers: { 'cache-control': 'private, no-store' } })
}

/** `DELETE /api/chai/:id`: "Abhi nahi" (or "Chalo", once on the way). 204, whatever there was; the sender is not told. */
export async function dismissChai(env: Env, userId: string, id: string): Promise<Response> {
  if (!idOf(id)) return noContent()
  await env.DB.prepare('UPDATE chai_invites SET dismissed = 1 WHERE id = ? AND to_id = ?')
    .bind(id, userId)
    .run()
  return noContent()
}

/** Statements that forget every friendship, ask, switch and invite of `userId` (account deletion). */
export const forgetFriendsOf = (env: Env, userId: string): D1PreparedStatement[] => [
  env.DB.prepare('DELETE FROM friends WHERE a = ?1 OR b = ?1').bind(userId),
  env.DB.prepare('DELETE FROM friend_requests WHERE from_id = ?1 OR to_id = ?1').bind(userId),
  env.DB.prepare('DELETE FROM friend_settings WHERE user_id = ?').bind(userId),
  env.DB.prepare('DELETE FROM chai_invites WHERE from_id = ?1 OR to_id = ?1').bind(userId),
]

/** The cron's sweep: asks past `FRIEND_ASK_TTL_MS`, invites past `CHAI_TTL_MS`. One D1 call. */
export async function purgeFriends(env: Env, now = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM friend_requests WHERE created_at <= ?').bind(now - FRIEND_ASK_TTL_MS),
    env.DB.prepare('DELETE FROM chai_invites WHERE created_at <= ?').bind(now - CHAI_TTL_MS),
  ])
}
