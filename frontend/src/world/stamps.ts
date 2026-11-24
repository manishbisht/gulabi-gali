import type { Lang } from '../i18n/strings'
import { storage } from '../storage'
import LIST from './stamps.json'
import type { LandmarkDef, Vec2 } from './types'

const KEY = 'gg-stamps'
/** Whose set `gg-stamps` is: the account that last signed in here. Unset for a ghost's own stamps. */
const OWNER = 'gg-stamps-owner'

/**
 * Every Jaipur Darshan stamp, one per landmark across every district, with the landmark's name. A copy of
 * the server's `stamps.json`, which it checks every pushed id against.
 */
export const STAMPS: readonly { id: string; hi: string; en: string }[] = LIST
export const TOTAL_STAMPS = STAMPS.length

/** A stamp's landmark, by name (the id itself for one this page does not know). */
export const stampName = (id: string, lang: Lang): string => STAMPS.find((s) => s.id === id)?.[lang] ?? id

/** The landmark ids stamped so far, in the order they were collected: each known stamp once, nothing else. */
export function collected(): string[] {
  return idsAt(KEY)
}

/** What `user` may see of the device's set before `claim` has run: nothing while it is tagged to someone else. */
export function collectedFor(user: string): string[] {
  const owner = storage.get(OWNER) || null
  return owner !== null && owner !== user ? [] : collected()
}

/** Where an account's stamps wait while someone else (or nobody) is signed in on this device. */
const stashKey = (user: string) => `gg-stamps-of:${user}`

/** The known stamp ids in a saved list, each once. */
function idsAt(key: string): string[] {
  const saved = storage.getJSON<unknown>(key, [])
  if (!Array.isArray(saved)) return []
  return saved.filter(
    (id, i): id is string =>
      typeof id === 'string' && STAMPS.some((s) => s.id === id) && saved.indexOf(id) === i,
  )
}

const union = (a: readonly string[], b: readonly string[]) => [...a, ...b.filter((id) => !a.includes(id))]

/**
 * Takes the set off the street when it belongs to an account: it moves to that account's own stash (kept, so
 * the same account gets it back and pushes what the server never confirmed), and the device's set and its owner
 * clear. Nothing is lost, and nobody else sees or pushes it. An untagged set (a ghost's, or an account with no
 * profile yet) is left where it is.
 */
export function park(): void {
  const owner = storage.get(OWNER) || null
  if (owner === null) return
  const held = collected()
  if (held.length) storage.set(stashKey(owner), JSON.stringify(union(idsAt(stashKey(owner)), held)))
  storage.set(KEY, '[]')
  storage.set(OWNER, '')
}

/**
 * `user` has a profile: the device's set is theirs now. An untagged set (collected as a ghost, or before the
 * profile was done) becomes theirs; one tagged to the same account stays; one tagged to a different account is
 * parked first (see `park`). Whatever this account left in its stash comes back. True when the set changed.
 */
export function claim(user: string): boolean {
  const owner = storage.get(OWNER) || null
  let changed = false
  if (owner !== null && owner !== user) {
    park()
    changed = true
  }
  storage.set(OWNER, user)
  const back = idsAt(stashKey(user))
  if (back.length) {
    storage.set(KEY, JSON.stringify(union(collected(), back)))
    storage.set(stashKey(user), '[]')
    changed = true
  }
  return changed
}

/** Signing out with every stamp confirmed on the server: the set and its owner go, nothing is left behind. */
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
