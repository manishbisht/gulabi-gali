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

/** The festival at `now` on the IST calendar. Where two entries overlap, the one listed first in the calendar wins. */
export function festivalOn(now: Date, calendar: FestivalEntry[] = CALENDAR): FestivalId | null {
  const at = istMinute(now)
  return calendar.find((e) => holds(e, at))?.id ?? null
}
