import type { Lang } from '../i18n/strings'
import { storage } from '../storage'
import LIST from './stamps.json'
import type { LandmarkDef, Vec2 } from './types'

const KEY = 'gg-stamps'

/**
 * Every Jaipur Darshan stamp, one per landmark across all four districts, with the landmark's name. A copy of
 * the server's `stamps.json`, which it checks every pushed id against.
 */
export const STAMPS: readonly { id: string; hi: string; en: string }[] = LIST
export const TOTAL_STAMPS = STAMPS.length

/** A stamp's landmark, by name (the id itself for one this page does not know). */
export const stampName = (id: string, lang: Lang): string => STAMPS.find((s) => s.id === id)?.[lang] ?? id

/** The landmark ids stamped so far, in the order they were collected. */
export function collected(): string[] {
  const saved = storage.getJSON<unknown>(KEY, [])
  return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
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
