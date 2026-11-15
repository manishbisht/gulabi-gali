import type { DistrictId } from '../net/protocol'
import { SITE_URL } from '../ui/inviteShare'
import { benchesOf, type Pose } from './benches'
import type { MapTarget } from './cityMap'
import { PLAYER_RADIUS } from '../player/player'
import { DISTRICTS, type District } from './district'
import { wallsOf } from './posters'
import { TAXI } from './taxi'
import type { AABB, Vec2 } from './types'

/*
 * Links to a place ("Bulao"): `https://…/?at=<district>:<place>`. A link names a place and nothing else: not
 * who shared it, when, or from where. Opening one enters that district and stands the visitor at the place
 * (after "Padharo"); a place the district does not have falls back to the normal spawn.
 *
 * Place ids are the map's (see `mapItems`): a landmark's id, `metro`, `poster-<n>`; a bench or tapri is
 * `bench-<n>` / `tapri-<n>`, its number as the server counts seats (the map's `<district>:<n>` without the
 * district, which the link already says).
 */

const PARAM = 'at'
const PLACE = /^[a-z0-9-]{1,40}$/

/** The id a link uses for a place on the map. */
export function linkId(item: Pick<MapTarget, 'id' | 'kind'>): string {
  if (item.kind === 'bench' || item.kind === 'tapri') return `${item.kind}-${item.id.split(':').pop()}`
  return item.id
}

/** The link that stands whoever opens it at `place` in `district`. */
export const placeUrl = (district: DistrictId, place: string) => `${SITE_URL}/?${PARAM}=${district}:${place}`

/** The place a page's query string (`location.search`) links to, or null when it names none, or none sane. */
export function readPlaceLink(search: string): { district: DistrictId; place: string } | null {
  const at = new URLSearchParams(search).get(PARAM)
  const split = at?.indexOf(':') ?? -1
  if (!at || split < 0) return null
  const district = DISTRICTS.find((d) => d === at.slice(0, split))
  const place = at.slice(split + 1)
  return district && PLACE.test(place) ? { district, place } : null
}

/**
 * Takes `?at=` out of the address bar, keeping anything else, once the link has been followed: a reload, or
 * the page's own address shared on, is then not the link.
 */
export function dropPlaceLink(): void {
  const url = new URL(location.href)
  if (!url.searchParams.has(PARAM)) return
  url.searchParams.delete(PARAM)
  history.replaceState(history.state, '', url)
}

/** How far out from a bench's or tapri's middle a link may stand someone: all within reach to sit. */
const SEAT_OUT = [1.6, 1.9, 2.2] as const
/** And from a poster wall's middle, on the side its posters face: all within reach to read it. */
const WALL_OUT = [1.6, 2, 2.4] as const
/** Ways round a prop to try, in turn, from straight in front of it (radians off its front). */
const AROUND = [
  0,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 2,
  -Math.PI / 2,
  (3 * Math.PI) / 4,
  (-3 * Math.PI) / 4,
  Math.PI,
]

const clear = (x: number, z: number, colliders: readonly AABB[]) =>
  !colliders.some(
    (c) =>
      x > c.minX - PLAYER_RADIUS &&
      x < c.maxX + PLAYER_RADIUS &&
      z > c.minZ - PLAYER_RADIUS &&
      z < c.maxZ + PLAYER_RADIUS,
  )

/**
 * The first clear point round a prop turned `rot` degrees (its front is its +z), trying straight in front first,
 * then further round (only as far as `turns` goes), each at the distances in `outs`; facing the prop. Null when
 * every one is blocked. A turned prop's collider is its loose square, so straight out from its corner may be
 * blocked within reach while the side is clear.
 */
function besideProp(
  at: Vec2,
  rot: number,
  outs: readonly number[],
  turns: readonly number[],
  colliders: readonly AABB[],
): Pose | null {
  // The turn props are drawn with (see `seatPose`): `rot` degrees clockwise seen from above.
  const front = (-rot * Math.PI) / 180
  for (const turn of turns)
    for (const out of outs) {
      const x = at.x + out * Math.sin(front + turn)
      const z = at.z + out * Math.cos(front + turn)
      if (clear(x, z, colliders)) return { x, z, ry: Math.atan2(at.x - x, at.z - z) }
    }
  return null
}

/**
 * Where a link to `place` stands the visitor in a district, and the way they face: by a landmark where the
 * auto-taxi sets riders down (in its ring, so its card opens), at the metro station, by a bench or tapri (in
 * reach to sit) or in front of a poster wall, clear of everything. Null for a place the district does not have,
 * or (never, in the districts as built: see the tests) one with no clear spot by it.
 */
export function placeSpot(district: Pick<District, 'def' | 'colliders'>, place: string): Pose | null {
  const { def, colliders } = district
  if (place === 'metro') return { x: def.station.x, z: def.station.z, ry: 0 }
  const landmark = def.landmarks.find((l) => l.id === place)
  if (landmark) {
    const drop = TAXI[def.id].drops[landmark.id]
    if (!drop) return null
    return { x: drop.x, z: drop.z, ry: Math.atan2(landmark.at.x - drop.x, landmark.at.z - drop.z) }
  }
  const seat = /^(bench|tapri)-(\d+)$/.exec(place)
  if (seat) {
    const bench = benchesOf(def).find((b) => b.id === `${def.id}:${seat[2]}` && b.kind === seat[1])
    return bench ? besideProp(bench.at, bench.rot, SEAT_OUT, AROUND, colliders) : null
  }
  const poster = /^poster-(\d+)$/.exec(place)
  if (poster) {
    const wall = wallsOf(def).find((w) => w.index === Number(poster[1]))
    return wall ? besideProp(wall.at, wall.rot, WALL_OUT, AROUND.slice(0, 3), colliders) : null
  }
  return null
}
