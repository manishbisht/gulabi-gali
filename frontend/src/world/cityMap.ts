import type * as THREE from 'three'
import { t, type Lang, type StringKey } from '../i18n/strings'
import { benchesOf } from './benches'
import { stopName } from './metroRide'
import type { Remote } from './people'
import { wallsOf } from './posters'
import { SHOW_TEXT, showId, showsOf } from './shows'
import type { AABB, DistrictDef, Vec2 } from './types'

/*
 * The city map and the compass, as data and arithmetic: the places a district's map shows, the bearing and
 * distance to a picked one, and the people it may show (only those drawn on the street now).
 */

/** Within this many metres of a target, it has been reached and the compass clears. */
export const ARRIVE_M = 6

export type MapItemKind =
  'landmark' | 'metro' | 'viewpoint' | 'show' | 'cricket' | 'bench' | 'tapri' | 'poster'
/** The kinds there are many of in a district, numbered in their names. */
type Numbered = 'bench' | 'tapri' | 'poster'

/** The cricket pitch's id on the map and in a link: a district has one at most. */
export const CRICKET_ID = 'cricket'

/** A place on the map that can be picked as the compass's target. */
export interface MapTarget {
  /** Unique within the district. */
  id: string
  kind: MapItemKind
  name: Record<Lang, string>
  at: Vec2
  /** A landmark's footprint: distance is to its edge, since its middle is inside the building. */
  area?: AABB
}

export interface MapItem extends MapTarget {
  /** Landmarks only: whether this visitor holds its stamp. */
  stamped?: boolean
}

const NAMES: Record<Numbered, StringKey> = {
  bench: 'mapBench',
  tapri: 'mapTapri',
  poster: 'mapPoster',
}

/** A place's name in both languages; `n` numbers one of many (`Chai tapri 2`), so a screen reader tells them apart. */
const named = (kind: Numbered, n?: number): Record<Lang, string> => ({
  hi: t(NAMES[kind], 'hi', { n: n ?? '' }),
  en: t(NAMES[kind], 'en', { n: n ?? '' }),
})

/**
 * Every place on a district's map: its landmarks (with `stamped`), the metro, a named rooftop viewpoint (at its
 * stair), its street shows (the evening's dancers too, by day: the name says when), its gali cricket pitch (at
 * the middle of the strip, under the id `cricket`), its benches and tapris, its poster walls.
 */
export function mapItems(def: DistrictDef, stamped: readonly string[]): MapItem[] {
  const count = { bench: 0, tapri: 0 }
  return [
    ...def.landmarks.map((l): MapItem => ({
      id: l.id,
      kind: 'landmark',
      name: l.name,
      at: l.at,
      area: l.footprint,
      stamped: stamped.includes(l.id),
    })),
    // under the same id and kind everywhere; a bus-only district's is a bus stand, and says so
    { id: 'metro', kind: 'metro', name: stopName(def.id), at: def.station },
    ...(def.roof && def.roofName
      ? [{ id: 'viewpoint', kind: 'viewpoint', name: def.roofName, at: def.roof.stair } satisfies MapItem]
      : []),
    ...showsOf(def).map((s): MapItem => ({
      id: showId(s.kind),
      kind: 'show',
      name: { hi: t(SHOW_TEXT[s.kind].name, 'hi'), en: t(SHOW_TEXT[s.kind].name, 'en') },
      at: s.at,
    })),
    ...(def.cricket
      ? [
          {
            id: CRICKET_ID,
            kind: 'cricket',
            name: { hi: t('mapCricket', 'hi'), en: t('mapCricket', 'en') },
            at: {
              x: (def.cricket.stumps.x + def.cricket.bowler.x) / 2,
              z: (def.cricket.stumps.z + def.cricket.bowler.z) / 2,
            },
          } satisfies MapItem,
        ]
      : []),
    ...benchesOf(def).map((b): MapItem => ({
      id: b.id,
      kind: b.kind,
      name: named(b.kind, ++count[b.kind]),
      at: b.at,
    })),
    ...wallsOf(def).map((w): MapItem => ({
      id: `poster-${w.index}`,
      kind: 'poster',
      name: named('poster', w.index + 1),
      at: w.at,
    })),
  ]
}

/** How far `pos` is from the target, in metres: to the edge of its area (0 inside), else to its point. */
export function targetDistance(pos: Vec2, t: MapTarget): number {
  const a = t.area
  if (!a) return Math.hypot(t.at.x - pos.x, t.at.z - pos.z)
  const dx = Math.max(a.minX - pos.x, 0, pos.x - a.maxX)
  const dz = Math.max(a.minZ - pos.z, 0, pos.z - a.maxZ)
  return Math.hypot(dx, dz)
}

/** The way from `from` to `to`, in degrees clockwise from north (-z): north 0, east 90, south 180, west 270. */
export function bearing(from: Vec2, to: Vec2): number {
  const deg = (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI
  return deg < 0 ? deg + 360 : deg
}

/** The way the camera looks, as a bearing. `scratch` is reused, so a frame allocates nothing. */
export function viewHeading(camera: THREE.Camera, scratch: THREE.Vector3): number {
  camera.getWorldDirection(scratch)
  const deg = (Math.atan2(scratch.x, -scratch.z) * 180) / Math.PI
  return deg < 0 ? deg + 360 : deg
}

/** How far to turn an arrow drawn pointing ahead (up the screen) so it points at `target`: degrees, -180 to 180. */
export function compassAngle(target: number, view: number): number {
  const d = (((target - view) % 360) + 360) % 360
  return d > 180 ? d - 360 : d
}

/**
 * Privacy: the people a map may show. Only those the street draws now: people the server listed as visible
 * to this viewer (never a ghost, someone hidden, or anyone blocked either way, who the server takes off with
 * a `leave`), and within the range their bodies are drawn in. Never the viewer, who is not among them. Plain
 * points: no names, ids or looks.
 */
export function mapPeople(people: readonly Remote[]): Vec2[] {
  const dots: Vec2[] = []
  for (const { body } of people) if (body.visible) dots.push({ x: body.position.x, z: body.position.z })
  return dots
}
