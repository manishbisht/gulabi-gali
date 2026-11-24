import { CALENDAR, type FestivalEntry } from './festivals.data'
import type { FestivalId } from './protocol'

export type { FestivalEntry }

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** YYYY-MM-DD of the given instant on the IST calendar. */
export function istDay(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** YYYY-MM-DDTHH:MM of the given instant on the IST clock. */
function istMinute(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16)
}

/**
 * Whether `at` (an IST minute) falls in the entry: a day-only entry holds its whole first and last days; a timed
 * one (New Year's evening to morning) starts at its start minute and has ended by its end minute.
 */
function holds(e: FestivalEntry, at: string): boolean {
  const day = at.slice(0, 10)
  const started = e.start.length > 10 ? at >= e.start : day >= e.start
  const ended = e.end.length > 10 ? at >= e.end : day > e.end
  return started && !ended
}

/** New Year's night on the IST clock, any year: 31 December from 18:00 to 06:00 on 1 January. */
function newYearNight(at: string): boolean {
  const monthDayTime = at.slice(5) // MM-DDTHH:MM
  return monthDayTime >= '12-31T18:00' || monthDayTime < '01-01T06:00'
}

/**
 * The festival at `now` on the IST calendar: New Year's night every year, else the table's entry (where two
 * overlap, the one listed first wins).
 */
export function festivalOn(now: Date, calendar: FestivalEntry[] = CALENDAR): FestivalId | null {
  const at = istMinute(now)
  if (newYearNight(at)) return 'newyear'
  return calendar.find((e) => holds(e, at))?.id ?? null
}

/** The festivals `/api/city` named before it had a version: a page that asks without `?v=2` knows only these. */
const FESTIVALS_V1: readonly FestivalId[] = ['sankranti', 'holi', 'gangaur', 'teej', 'diwali', 'jlf']

/**
 * The festival as a page asking with API version `version` can take it. Pages built before New Year existed
 * throw on a festival id they do not know, so anything newer than the first six goes only to `v >= 2`. A future
 * festival id goes behind a new version the same way (see docs/deployment.md).
 */
export function festivalForVersion(id: FestivalId | null, version: number): FestivalId | null {
  if (id === null || version >= 2) return id
  return FESTIVALS_V1.includes(id) ? id : null
}
