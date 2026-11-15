import { CALENDAR, type FestivalEntry } from './festivals.data'
import type { FestivalId } from './protocol'

export type { FestivalEntry }

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** YYYY-MM-DD of the given instant on the IST calendar. */
export function istDay(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** The festival on `now`'s IST day. Where two entries overlap, the one listed first in the calendar wins. */
export function festivalOn(now: Date, calendar: FestivalEntry[] = CALENDAR): FestivalId | null {
  const day = istDay(now)
  return calendar.find((e) => e.start <= day && day <= e.end)?.id ?? null
}
