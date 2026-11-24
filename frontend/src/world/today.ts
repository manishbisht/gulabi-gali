import type { TodayRecord } from '../net/protocol'
import { storage } from '../storage'
import { STAMPS } from './stamps'

/*
 * "Aaj ka Darshan": one small goal a day, the same for everyone on a given IST day (so friends can talk about
 * it), picked from the date alone. Every goal can be done alone, as a ghost, on a quiet day: none needs another
 * person, a sign-in, or the monkey (whom anyone may have switched off). Doing it adds a day to a streak, kept on
 * this device for a ghost and on the server for a resident (see the Worker's today.ts). Nothing here nags: no
 * push, no reminder; the chip just shows the day's goal and whether it is done.
 */

/** What a goal asks. `darshan` names a landmark (a stamp id); the rest are things any district has. */
export type GoalKind = 'darshan' | 'tapri' | 'ride' | 'auto' | 'photo' | 'roof' | 'map' | 'animal'

/**
 * The kinds, in a fixed order the daily pick shuffles. Their ids are stable: never renamed, only added to (an
 * addition reshuffles the days to come, never the days gone).
 */
export const GOAL_KINDS: readonly GoalKind[] = [
  'darshan',
  'tapri',
  'ride',
  'auto',
  'photo',
  'roof',
  'map',
  'animal',
]

/** A day's goal. `id` is the kind, or `darshan:<stamp>` for a landmark. */
export interface Goal {
  id: string
  kind: GoalKind
  /** The landmark's stamp id, for `darshan`. */
  stamp?: string
}

/**
 * Something the player just did, from the existing events (see `deeds.ts`): reaching a landmark's ring, a
 * tapri or bench in reach, a metro or bus ride arrived, an auto ride ended at its stop, a photo taken, up on a
 * rooftop, a place picked on the map, a street animal befriended.
 */
export type Deed = { kind: 'darshan'; stamp: string } | { kind: Exclude<GoalKind, 'darshan'> }

const IST_OFFSET_MS = 5.5 * 3600_000
const DAY_MS = 24 * 3600_000

/** YYYY-MM-DD of the instant `ms` on the IST calendar, wherever the phone is. */
export const istDay = (ms: number): string => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10)

/** The calendar day before `day` (YYYY-MM-DD). */
export const dayBefore = (day: string): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)

/** When the IST day holding `ms` ends, in ms: the chip turns over to the next goal then. */
export const nextIstMidnight = (ms: number): number =>
  Math.floor((ms + IST_OFFSET_MS) / DAY_MS + 1) * DAY_MS - IST_OFFSET_MS

/** FNV-1a, 32 bits. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** The kinds in the order of round `round` (one round is as many days as there are kinds). */
function roundOrder(round: number): GoalKind[] {
  const order = [...GOAL_KINDS]
  let seed = hash(`gg-today:${round}`)
  for (let i = order.length - 1; i > 0; i--) {
    seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) >>> 0
    const j = seed % (i + 1)
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

/** The round's order, turned so its first day is never the same kind as the round before's last. */
function rounds(round: number): GoalKind[] {
  const order = roundOrder(round)
  const before = roundOrder(round - 1)
  if (order[0] === before[before.length - 1]) [order[0], order[1]] = [order[1]!, order[0]!]
  return order
}

/**
 * The goal of IST day `day` (YYYY-MM-DD): every kind once in each run of `GOAL_KINDS.length` days, in an order
 * shuffled from the round number, never the same kind two days running. A darshan day's landmark goes round the
 * stamps in their order, one per round.
 */
export function goalFor(day: string): Goal {
  const n = Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS)
  const round = Math.floor(n / GOAL_KINDS.length)
  const kind = rounds(round)[n - round * GOAL_KINDS.length]!
  if (kind !== 'darshan') return { id: kind, kind }
  const stamp = STAMPS[((round % STAMPS.length) + STAMPS.length) % STAMPS.length]!.id
  return { id: `darshan:${stamp}`, kind, stamp }
}

/** A goal from its id (the test override), or null for an id that is not one. */
export function goalById(id: string): Goal | null {
  const [kind, stamp] = id.split(':')
  if (kind === 'darshan') return stamp && STAMPS.some((s) => s.id === stamp) ? { id, kind, stamp } : null
  return GOAL_KINDS.includes(kind as GoalKind) && !stamp ? { id, kind: kind as GoalKind } : null
}

/** Whether `deed` does `goal`. */
export const meets = (goal: Goal, deed: Deed): boolean =>
  goal.kind === deed.kind && (deed.kind !== 'darshan' || deed.stamp === goal.stamp)

/** No day done yet. */
export const NO_RECORD: TodayRecord = { last: '', streak: 0, best: 0 }

/**
 * The record once `day`'s goal is done: the same day again changes nothing, the day after `last` adds one to the
 * run, any other day starts it again at 1; `best` keeps the longest. (The server works it out the same way for
 * a resident.)
 */
export function advance(r: TodayRecord, day: string): TodayRecord {
  if (r.last === day) return r
  const streak = r.last === dayBefore(day) ? r.streak + 1 : 1
  return { last: day, streak, best: Math.max(r.best, streak) }
}

/** The run as it stands on `day`: kept while it was done today or yesterday, 0 once a day has been missed. */
export const liveStreak = (r: TodayRecord, day: string): number =>
  r.last === day || r.last === dayBefore(day) ? r.streak : 0

/** From this many days in a row the stamps chip wears a small marigold accent. */
export const STREAK_ACCENT = 3

const KEY = 'gg-today'

/** A record as saved, or none for anything that is not one. */
export function asRecord(raw: unknown): TodayRecord | null {
  const r = raw as Partial<TodayRecord> | null
  if (!r || typeof r !== 'object') return null
  const { last, streak, best } = r
  if (typeof last !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(last)) return null
  if (!Number.isInteger(streak) || !Number.isInteger(best) || streak! < 1 || best! < streak!) return null
  return { last, streak: streak!, best: best! }
}

/** A ghost's record, on this device. */
export const localRecord = (): TodayRecord => asRecord(storage.getJSON<unknown>(KEY, null)) ?? NO_RECORD

export const saveLocalRecord = (r: TodayRecord): void => storage.set(KEY, JSON.stringify(r))

/** A resident's day done here but not yet confirmed by the server: tried again on the next load, today only. */
const pendingKey = (user: string) => `gg-today-pending:${user}`
export const pendingDay = (user: string): string => storage.get(pendingKey(user)) ?? ''
export const setPendingDay = (user: string, day: string): void => storage.set(pendingKey(user), day)
