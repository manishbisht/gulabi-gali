import type { Env } from './env'
import { istDay } from './festivals'
import { todayLimit } from './limits'
import { activeRow } from './profiles'
import type { TodayRecord } from './protocol'

/*
 * "Aaj ka Darshan": one small goal a day, the same for everyone (the page picks it from the IST date; see the
 * frontend's world/today.ts). The server never learns or checks which goal it was, only that the page says
 * today's is done: it keeps the day and works out the run of days itself, so a page cannot set a streak, mark
 * another day, or fill in a day it missed. A ghost's record stays on their device.
 */

/** The IST day before `day` (YYYY-MM-DD). */
function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 24 * 3600_000).toISOString().slice(0, 10)
}

/** A resident's record, or undefined before their first day. */
export async function todayOf(env: Env, userId: string): Promise<TodayRecord | undefined> {
  const row = await env.DB.prepare('SELECT last_day, streak, best FROM user_today WHERE user_id = ?')
    .bind(userId)
    .first<{ last_day: string; streak: number; best: number }>()
  return row ? { last: row.last_day, streak: row.streak, best: row.best } : undefined
}

/**
 * `PUT /api/me/today {day}`: today's goal is done. `day` must be today's IST date as the server reckons it
 * (`now`), else 400 `invalid`; nothing else in the body is read. The same day again changes nothing; the day
 * after `last` adds one to the run; any later day starts it again at 1. `best` keeps the longest. One upsert, so
 * two devices at once agree. A resident only (`ACTIVE`; a hidden one too): anyone else 403 `ghost` (a banned
 * one 403 `banned`, the route's `bannedGate`); 429 past `TODAY_LIMIT`. Answers the record.
 */
export async function putToday(env: Env, userId: string, raw: unknown, now = Date.now()): Promise<Response> {
  if (!(await activeRow(env, userId))) return Response.json({ error: 'ghost' }, { status: 403 })
  const slow = await todayLimit(env, userId, now)
  if (slow) return slow
  const day = istDay(new Date(now))
  if ((raw as { day?: unknown } | null)?.day !== day)
    return Response.json({ error: 'invalid' }, { status: 400 })
  const run = 'CASE WHEN last_day = ?2 THEN streak WHEN last_day = ?3 THEN streak + 1 ELSE 1 END'
  const row = await env.DB.prepare(
    `INSERT INTO user_today (user_id, last_day, streak, best) VALUES (?1, ?2, 1, 1)
     ON CONFLICT (user_id) DO UPDATE SET streak = ${run}, best = MAX(best, ${run}), last_day = ?2
     RETURNING last_day, streak, best`,
  )
    .bind(userId, day, dayBefore(day))
    .first<{ last_day: string; streak: number; best: number }>()
  if (!row) return Response.json({ error: 'invalid' }, { status: 400 })
  return Response.json({ last: row.last_day, streak: row.streak, best: row.best } satisfies TodayRecord)
}
