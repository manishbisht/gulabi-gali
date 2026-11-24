import type { FestivalId } from './net/protocol'
import { goalById, type Goal } from './world/today'

/*
 * What an e2e spec may stand in for through the address bar: only in a build made with `VITE_TEST_HOOKS=1` (the
 * e2e build) and with `gg-test=1` in the address. A production build folds both to null, so a shared link can
 * never change what someone's city shows.
 */

/** `?gg-festival=<id>` stands in for the live festival; `known` is the festivals this page can show. */
export function festivalOverride(known: Readonly<Record<string, unknown>>): FestivalId | null {
  if (import.meta.env.VITE_TEST_HOOKS !== '1') return null
  const q = new URLSearchParams(location.search)
  const id = q.get('gg-festival')
  return q.get('gg-test') === '1' && id && Object.hasOwn(known, id) ? (id as FestivalId) : null
}

/** `?gg-today=<goal id>` stands in for the day's own "Aaj ka Darshan" goal. */
export function todayOverride(): Goal | null {
  if (import.meta.env.VITE_TEST_HOOKS !== '1') return null
  const q = new URLSearchParams(location.search)
  const id = q.get('gg-today')
  return q.get('gg-test') === '1' && id ? goalById(id) : null
}
