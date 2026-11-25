import type { DistrictId } from '../net/protocol'
import { SITE_URL } from '../ui/inviteShare'
import { benchesOf, type Pose } from './benches'
import type { MapTarget } from './cityMap'
import { PLAYER_RADIUS } from '../player/player'
import { DISTRICTS, type District } from './district'
import { wallsOf } from './posters'
import { showOfId, watchSpot } from './shows'
import { TAXI } from './taxi'
import type { AABB, Vec2 } from './types'

/*
 * Links to a place ("Bulao"): `https://…/p/<district>/<place>/`, a small static page made at build time (see
 * `src/preview/pages.ts`) whose tags draw a card for the place in WhatsApp, Instagram or X, and which forwards a
 * visitor at once to `/?at=<district>:<place>`, the address the app reads (and old links still carry). A link
 * names a place and nothing else: not who shared it, when, or from where. Opening one enters that district and
 * stands the visitor at the place (after "Padharo"); a place the district does not have falls back to the
 * normal spawn.
 *
 * Place ids are the map's (see `mapItems`): a landmark's id, `metro`, `viewpoint`, `show-<kind>`, `poster-<n>`; a bench or tapri is
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

/** The path of a place's preview page (see `src/preview/pages.ts`), from the site's root. */
export const placePath = (district: DistrictId, place: string) => `/p/${district}/${place}/`

/** Where that page sends a visitor on: the app, told the place by `?at=` (`readPlaceLink`). */
export const placeForward = (district: DistrictId, place: string) => `/?${PARAM}=${district}:${place}`

/** The link that stands whoever opens it at `place` in `district`: its preview page, which forwards them on. */
export const placeUrl = (district: DistrictId, place: string) => `${SITE_URL}${placePath(district, place)}`

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
 * Where a link to `place` stands the visitor in a district, and the way they face: by a landmark (facing its
 * building) where the
 * auto-taxi sets riders down (in its ring, so its card opens), at the metro station, at a named viewpoint's
 * stair, by a bench or tapri (in
 * reach to sit) or in front of a poster wall, clear of everything. Null for a place the district does not have,
 * or (never, in the districts as built: see the tests) one with no clear spot by it.
 */
export function placeSpot(district: Pick<District, 'def' | 'colliders'>, place: string): Pose | null {
  const { def, colliders } = district
  if (place === 'metro') return { x: def.station.x, z: def.station.z, ry: 0 }
  if (place === 'viewpoint') {
    // at the stair's foot, where E climbs, facing as coming down the stair does (see RoofDef.foot)
    const { roof } = def
    if (!roof || !def.roofName) return null
    const foot = roof.foot ?? roof.out
    return { x: roof.stair.x, z: roof.stair.z, ry: Math.atan2(foot.x, foot.z) }
  }
  const landmark = def.landmarks.find((l) => l.id === place)
  if (landmark) {
    const drop = TAXI[def.id].drops[landmark.id]
    if (!drop) return null
    // facing the building (its footprint's middle), not `at`: a fort's `at` is its gate's ring, which the drop
    // can stand beyond, and facing it would turn the visitor's back on the fort
    const { minX, maxX, minZ, maxZ } = landmark.footprint
    return { x: drop.x, z: drop.z, ry: Math.atan2((minX + maxX) / 2 - drop.x, (minZ + maxZ) / 2 - drop.z) }
  }
  // a street show: where its audience stands, facing it (open ground by the show's own placement rules)
  const show = showOfId(def, place)
  if (show) {
    const spot = watchSpot(show)
    return clear(spot.x, spot.z, colliders) ? spot : null
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
