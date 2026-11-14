import { storage } from '../storage'
import type { LandmarkDef, Vec2 } from './types'

const KEY = 'gg-stamps'

/** One stamp per landmark across all four districts. Only the Walled City's exist so far. */
export const TOTAL_STAMPS = 9

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
