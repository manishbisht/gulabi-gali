import type { StringKey } from '../i18n/strings'
import type { AABB, DistrictDef, ShowKind, ShowSpec, Vec2 } from './types'

/*
 * The street shows: a kathputli (string puppet) stage, a ravanhatta player and, in the evening, a troupe of
 * kalbelia-style dancers with a dholak. Each stands where its district's definition puts it (`DistrictDef.shows`)
 * and holds an idle pose until the player comes near; then it performs for under half a minute, with a tune made
 * on the page. Client-only: nothing is sent, nobody else sees whether a show is playing for you.
 *
 * This file is the small part every page carries: where the shows are, when, and their names. The figures, the
 * tunes and the performance itself are a lazy chunk (`src/shows/`), fetched on entering a district that has one.
 *
 * E's priority order (see `createInteraction`) is untouched: a show takes no key. It starts by walking up, and
 * "Taali bajao" is a button. A show stands at least `NEAR_M` clear of everything E answers to (see the tests).
 */

export type { ShowKind, ShowSpec }

export const SHOW_KINDS: readonly ShowKind[] = ['kathputli', 'ravanhatta', 'dancers']

/** Within this many metres of an idle show, it begins. */
export const NEAR_M = 8
/** Further than this and a show stops; a performance counts as watched only if the player never went this far. */
export const STAY_M = 14
/** How long each performance lasts, in seconds of game time. */
export const SHOW_S: Record<ShowKind, number> = { kathputli: 25, ravanhatta: 26, dancers: 27 }
/** "Taali bajao" stays this long after the last note: that is when people clap. */
export const CLAP_AFTER_S = 8
/** The ground a show takes, as a circle round its `at`, in metres. */
export const SHOW_RADIUS: Record<ShowKind, number> = { kathputli: 1.8, ravanhatta: 1.1, dancers: 3.4 }
/** Where a link or the test stands a watcher: this far out of the show's front. */
export const WATCH_OUT: Record<ShowKind, number> = { kathputli: 4.2, ravanhatta: 3.4, dancers: 6 }

/** The dancers come out from an hour before sunset to two hours after. */
const EVENING_BEFORE_MS = 60 * 60_000
const EVENING_AFTER_MS = 2 * 60 * 60_000

export const showsOf = (def: Pick<DistrictDef, 'shows'>): readonly ShowSpec[] => def.shows ?? []

/** A show's id on the map and in a link: one of a kind per district. */
export const showId = (kind: ShowKind) => `show-${kind}`

/** The show a map or link id names, if it is one. */
export function showOfId(def: Pick<DistrictDef, 'shows'>, id: string): ShowSpec | undefined {
  return showsOf(def).find((s) => showId(s.kind) === id)
}

/** The way a show faces (unit): its `rot` turns it as a prop's does, clockwise seen from above, front +z. */
export function showFront(spec: Pick<ShowSpec, 'rot'>): Vec2 {
  const a = (-(spec.rot ?? 0) * Math.PI) / 180
  // rounded, so a quarter turn is exactly along an axis
  return { x: Math.round(Math.sin(a) * 1e6) / 1e6 + 0, z: Math.round(Math.cos(a) * 1e6) / 1e6 + 0 }
}

/** Where to stand to watch: out of the show's front, facing it. */
export function watchSpot(spec: ShowSpec): { x: number; z: number; ry: number } {
  const f = showFront(spec)
  const out = WATCH_OUT[spec.kind]
  return { x: spec.at.x + f.x * out, z: spec.at.z + f.z * out, ry: Math.atan2(-f.x, -f.z) }
}

/** Whether the evening's show is out at `now`, given today's sunset (an ISO instant, from the city snapshot). */
export function eveningOn(now: Date, sunsetIso: string): boolean {
  const set = Date.parse(sunsetIso)
  if (!Number.isFinite(set)) return false
  const t = now.getTime()
  return t >= set - EVENING_BEFORE_MS && t <= set + EVENING_AFTER_MS
}

/** Whether a show is on the street at `now`: the dancers only in the evening, the others always. */
export const showOn = (kind: ShowKind, now: Date, sunsetIso: string) =>
  kind !== 'dancers' || eveningOn(now, sunsetIso)

/**
 * What nobody walks through: the puppet stage with its puppeteer, the seated musician, the dholak player at the
 * back of the dancers' ground (the dancers themselves are walked through, as a procession is). Turned with the show.
 */
export function showColliders(spec: ShowSpec): AABB[] {
  const f = showFront(spec)
  /** A box `w` wide and `d` deep whose middle is `back` metres behind the show's `at`. */
  const boxAt = (w: number, d: number, back: number): AABB => {
    const cx = spec.at.x - f.x * back
    const cz = spec.at.z - f.z * back
    // along x the front runs with z, and the other way about
    const hx = (Math.abs(f.z) * w + Math.abs(f.x) * d) / 2
    const hz = (Math.abs(f.x) * w + Math.abs(f.z) * d) / 2
    return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz }
  }
  if (spec.kind === 'kathputli') return [boxAt(2.6, 1.9, 0.3)]
  if (spec.kind === 'ravanhatta') return [boxAt(0.9, 0.9, 0)]
  return [boxAt(0.9, 0.9, DHOLAK_BACK)]
}
/** The dholak player sits this far behind the middle of the dancers' ground. */
export const DHOLAK_BACK = 2.5

/**
 * Each show's name on the map and in a link (the dancers' says when they are out), its card's title, and the
 * card's two lines about the craft.
 */
export const SHOW_TEXT: Record<
  ShowKind,
  { name: StringKey; title: StringKey; lines: readonly [StringKey, StringKey] }
> = {
  kathputli: {
    name: 'showKathputli',
    title: 'showKathputli',
    lines: ['showKathputliCraft', 'showKathputliHow'],
  },
  ravanhatta: {
    name: 'showRavanhatta',
    title: 'showRavanhatta',
    lines: ['showRavanhattaCraft', 'showRavanhattaHow'],
  },
  dancers: { name: 'showDancers', title: 'showDancersTitle', lines: ['showDancersCraft', 'showDancersHow'] },
}

// ---- watched to the end ------------------------------------------------------------------------

type Listener = (kind: ShowKind) => void
const listeners = new Set<Listener>()

/**
 * Called at the moment a performance finishes with the player having stayed near (within `STAY_M`) from its
 * first note to its last. The hook for "Aaj ka Darshan" and the like: local to this page, never sent.
 */
export function showWatched(kind: ShowKind): void {
  for (const fn of [...listeners])
    try {
      fn(kind)
    } catch {
      // one broken listener must not break the show that told it
    }
}

/** Listens for `showWatched`; returns the way to stop. */
export function onShowWatched(fn: Listener): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
