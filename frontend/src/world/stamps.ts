import type { Lang } from '../i18n/strings'
import { storage } from '../storage'
import LIST from './stamps.json'
import type { LandmarkDef, Vec2 } from './types'

const KEY = 'gg-stamps'
/** Whose set `gg-stamps` is: the account that last signed in here. Unset for a ghost's own stamps. */
const OWNER = 'gg-stamps-owner'

/**
 * Every Jaipur Darshan stamp, one per landmark across all four districts, with the landmark's name. A copy of
 * the server's `stamps.json`, which it checks every pushed id against.
 */
export const STAMPS: readonly { id: string; hi: string; en: string }[] = LIST
export const TOTAL_STAMPS = STAMPS.length

/** A stamp's landmark, by name (the id itself for one this page does not know). */
export const stampName = (id: string, lang: Lang): string => STAMPS.find((s) => s.id === id)?.[lang] ?? id

/** The landmark ids stamped so far, in the order they were collected: each known stamp once, nothing else. */
export function collected(): string[] {
  const saved = storage.getJSON<unknown>(KEY, [])
  if (!Array.isArray(saved)) return []
  return saved.filter(
    (id, i): id is string =>
      typeof id === 'string' && STAMPS.some((s) => s.id === id) && saved.indexOf(id) === i,
  )
}

/**
 * Marks this device's set as `user`'s. The set belongs to whoever signed in last, so when it was another
 * account's (a page closed without signing out) it is wiped first: the next person on a shared phone neither
 * sees nor pushes the one before's stamps. A ghost's own set (no owner) goes to whoever signs in first.
 * True when it wiped.
 */
export function claim(user: string): boolean {
  const owner = storage.get(OWNER) || null
  if (owner === user) return false
  storage.set(OWNER, user)
  if (owner === null) return false
  storage.set(KEY, '[]')
  return true
}

/** Signing out: the set and its owner go, so the device starts clean for a ghost or the next account. */
export function release(): void {
  storage.set(KEY, '[]')
  storage.set(OWNER, '')
}

/** Returns true only the first time `id` is collected. */
export function collect(id: string): boolean {
  const have = collected()
  if (have.includes(id)) return false
  storage.set(KEY, JSON.stringify([...have, id]))
  return true
}

/**
 * Adds stamps collected elsewhere (the server's set: another device's) after the ones here, known stamps only
 * and each once. True when that added any.
 */
export function mergeStamps(ids: readonly string[]): boolean {
  const have = collected()
  const added = ids.filter(
    (id, i) => !have.includes(id) && ids.indexOf(id) === i && STAMPS.some((s) => s.id === id),
  )
  if (!added.length) return false
  storage.set(KEY, JSON.stringify([...have, ...added]))
  return true
}

/** The closest landmark whose ring `pos` stands inside, or null. */
export function nearestLandmark(pos: Vec2, landmarks: LandmarkDef[]): LandmarkDef | null {
  let best: LandmarkDef | null = null
  let bestD = Infinity
  for (const l of landmarks) {
    const d = Math.hypot(pos.x - l.at.x, pos.z - l.at.z)
    if (d <= l.radius && d < bestD) {
      best = l
      bestD = d
    }
  }
  return best
}
