import type * as THREE from 'three'
import { CAST } from '../cast'
import { footprint } from '../kit'
import { BADI_CHAUPAR, buildBadiChaupar } from '../landmarks/badiChaupar'
import { buildHawaMahal, HAWA_MAHAL } from '../landmarks/hawaMahal'
import { buildJantarMantar, JANTAR_MANTAR } from '../landmarks/jantarMantar'
import { buildTripoliaGate, TRIPOLIA_GATE } from '../landmarks/tripoliaGate'
import type { AABB, BuildingSpec, DistrictDef, LandmarkDef, NpcDef, Paving, PropSpec, Vec2 } from '../types'

/*
 * The Walled City, 240 × 240 m, with Badi Chaupar at the origin; x is east and -z is north. A loose take
 * on the real grid: the wide Tripolia–Ramganj bazaar runs east–west through the Chaupar and Johari
 * Bazaar runs south from it (Sireh Deori north). Lanes cross each quarter at ±62. The fill is placed
 * by a seeded generator, so the city is the same on every visit.
 */

const SIZE = 240
const HALF = SIZE / 2
const WALL = 3 // city wall thickness, along the edges
const INNER = 111 // buildings stop here, leaving a lane inside the wall
const MAIN = 9 // half-width of the east–west bazaar, building line to building line
const JOHARI = 7 // half-width of the north–south bazaar
const SQUARE = BADI_CHAUPAR.square / 2
const LANE = 62 // lane centre lines, each 8 m wide
const DEEP = 12 // the deepest building in a row

const rect = (x0: number, z0: number, x1: number, z1: number): AABB => ({
  minX: Math.min(x0, x1),
  maxX: Math.max(x0, x1),
  minZ: Math.min(z0, z1),
  maxZ: Math.max(z0, z1),
})
const grow = (r: AABB, m: number): AABB => rect(r.minX - m, r.minZ - m, r.maxX + m, r.maxZ + m)
const centred = (at: Vec2, size: { w: number; d: number }) =>
  rect(at.x - size.w / 2, at.z - size.d / 2, at.x + size.w / 2, at.z + size.d / 2)
const overlaps = (a: AABB, b: AABB) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ

// ---- landmarks -------------------------------------------------------------------------------

const placed = (build: () => THREE.Group, at: Vec2) => async () => {
  const g = build()
  g.position.set(at.x, 0, at.z)
  return g
}

const HAWA_AT = { x: 36, z: -18 }
const JANTAR_AT = { x: -50, z: -36 }
const TRIPOLIA_AT = { x: -96, z: -15 }
const CHAUPAR_AT = { x: 0, z: 0 }

const landmarks: LandmarkDef[] = [
  {
    id: 'hawa-mahal',
    name: { hi: 'Hawa Mahal', en: 'Hawa Mahal' },
    story: {
      hi: '1799 mein Maharaja Sawai Pratap Singh ne banwaya — 953 jharokhe, taaki raaniyan bina dikhe bazaar ki raunak dekh sakein.',
      en: 'Built in 1799 by Maharaja Sawai Pratap Singh: 953 little windows, so the royal women could watch the bazaar without being seen.',
    },
    at: HAWA_AT,
    radius: 14,
    footprint: centred(HAWA_AT, HAWA_MAHAL),
    build: placed(buildHawaMahal, HAWA_AT),
  },
  {
    id: 'jantar-mantar',
    name: { hi: 'Jantar Mantar', en: 'Jantar Mantar' },
    story: {
      hi: 'Sawai Jai Singh II ki pathar ki observatory, 18vi sadi mein bani. Samrat Yantra ki dhoop-ghadi 27 metre oonchi hai aur lagbhag 2 second tak ka time batati hai.',
      en: "Sawai Jai Singh II's stone observatory, built in the early 1700s. The Samrat Yantra sundial stands 27 m tall and is said to tell the time to about two seconds.",
    },
    at: JANTAR_AT,
    radius: 16,
    footprint: centred(JANTAR_AT, JANTAR_MANTAR),
    build: placed(buildJantarMantar, JANTAR_AT),
  },
  {
    id: 'tripolia-gate',
    name: { hi: 'Tripolia Gate', en: 'Tripolia Gate' },
    story: {
      hi: 'Tripolia yaani teen darwaze. City Palace ka ye gate shahi parivaar ke liye reserved hai; visitors dusre gate se jaate hain.',
      en: "Tripolia means 'three gates'. This entrance to the City Palace is reserved for the royal family; visitors use other gates.",
    },
    at: TRIPOLIA_AT,
    radius: 12,
    footprint: centred(TRIPOLIA_AT, TRIPOLIA_GATE),
    build: placed(buildTripoliaGate, TRIPOLIA_AT),
  },
  {
    id: 'badi-chaupar',
    name: { hi: 'Badi Chaupar', en: 'Badi Chaupar' },
    story: {
      hi: 'Sawai Jai Singh II ne 1727 mein Jaipur ko chaupar wale grid pe basaya. 1876 mein Prince of Wales ke swagat mein shahar gulabi rang diya gaya.',
      en: 'Sawai Jai Singh II founded Jaipur in 1727 on a grid of great squares like this one. In 1876 the city was painted pink to welcome the Prince of Wales.',
    },
    at: CHAUPAR_AT,
    radius: 12,
    footprint: centred(CHAUPAR_AT, BADI_CHAUPAR),
    build: placed(buildBadiChaupar, CHAUPAR_AT),
  },
]

// ---- buildings -------------------------------------------------------------------------------

/** mulberry32: a tiny seeded generator, so the layout never changes between visits. */
function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = seeded(1727)
const between = (lo: number, hi: number) => lo + rand() * (hi - lo)

/** The Jantar Mantar compound, walled on four sides with a gate onto the bazaar. */
const COMPOUND = rect(-73, -57, -28, -MAIN)

/** An open patch across the bazaar from Hawa Mahal, where you step back to take in the whole facade. */
const HAWA_VIEW = rect(HAWA_AT.x - 14, MAIN, HAWA_AT.x + 14, MAIN + 14)

/** Kept free of fill: the landmarks with a little breathing room, the Jantar Mantar compound, the view. */
const KEEP_OUT: AABB[] = [...landmarks.map((l) => grow(l.footprint, 3)), grow(COMPOUND, 1), HAWA_VIEW]

const buildings: BuildingSpec[] = []

const fits = (b: AABB) =>
  b.minX >= -INNER &&
  b.maxX <= INNER &&
  b.minZ >= -INNER &&
  b.maxZ <= INNER &&
  !KEEP_OUT.some((k) => overlaps(b, k)) &&
  !buildings.some((o) => overlaps(b, footprint(o)))

/** How a row looks: bazaars are mostly arcaded shops, lanes mostly havelis. */
type Mix = 'bazaar' | 'lane'

function building(mix: Mix, w: number, d: number): Omit<BuildingSpec, 'x' | 'z' | 'rot'> {
  const r = rand()
  const style = mix === 'bazaar' ? (r < 0.72 ? 'shop' : 'haveli') : r < 0.82 ? 'haveli' : 'shop'
  const floors = (style === 'shop' ? 2 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 3)) as 2 | 3 | 4
  const tint = rand() < 0.12 ? 'terracotta' : 'pink'
  return { w, d, floors, style, tint }
}

/**
 * Buildings shoulder to shoulder along one side of a street, facing it. `front` is the building line,
 * `facing` the way the street faces look; `from`..`to` runs along the street.
 */
function row(from: number, to: number, front: number, facing: 'n' | 's' | 'e' | 'w', mix: Mix) {
  let at = from
  while (to - at >= 6) {
    const w = Math.min(Math.round(between(7, mix === 'bazaar' ? 10 : 12)), to - at)
    const d = Math.round(between(9, DEEP))
    const mid = at + w / 2
    const spec: BuildingSpec =
      facing === 's'
        ? { ...building(mix, w, d), x: mid, z: front - d / 2 }
        : facing === 'n'
          ? { ...building(mix, w, d), x: mid, z: front + d / 2, rot: 180 }
          : facing === 'e'
            ? { ...building(mix, w, d), x: front - d / 2, z: mid, rot: 270 }
            : { ...building(mix, w, d), x: front + d / 2, z: mid, rot: 90 }
    if (fits(footprint(spec))) {
      buildings.push(spec)
      at += w
    } else {
      at += 1 // something is in the way: try a little further along
    }
  }
}

/** Stretches along a street between the Chaupar (or its corner rows) and the inner lane, split by lanes. */
const stretches = (start: number): [number, number][] => [
  [-INNER, -LANE - 4],
  [-LANE + 4, -start],
  [start, LANE - 4],
  [LANE + 4, INNER],
]

// The great bazaars, both sides.
for (const [a, b] of stretches(SQUARE)) {
  row(a, b, -MAIN, 's', 'bazaar')
  row(a, b, MAIN, 'n', 'bazaar')
}
for (const [a, b] of stretches(MAIN + DEEP)) {
  row(a, b, -JOHARI, 'e', 'bazaar')
  row(a, b, JOHARI, 'w', 'bazaar')
}
// The lanes: the rows whose fronts face south, towards the camera (it looks north), plus a few more.
for (const [a, b] of stretches(JOHARI + DEEP)) {
  row(a, b, LANE - 4, 's', 'lane')
  if (a > 0) row(a, b, -LANE - 4, 's', 'lane')
}
for (const [a, b] of stretches(MAIN + DEEP)) {
  if (a < 0) row(a, b, LANE - 4, 'e', 'lane')
  if (b > 0) row(a, b, -LANE + 4, 'w', 'lane')
}

/** An axis-aligned run of wall from one corner to the other. */
function wall(r: AABB, floors: 1 | 2, tint: 'pink' | 'terracotta' = 'pink'): BuildingSpec {
  const w = r.maxX - r.minX
  const d = r.maxZ - r.minZ
  const x = (r.minX + r.maxX) / 2
  const z = (r.minZ + r.maxZ) / 2
  return w >= d
    ? { x, z, w, d, floors, style: 'wall', tint }
    : { x, z, w: d, d: w, floors, style: 'wall', tint, rot: 90 }
}

// The city wall, in segments along the edges (north and south run the full width).
for (let i = 0; i < 4; i++) {
  const x0 = -HALF + i * 60
  buildings.push(wall(rect(x0, -HALF, x0 + 60, -HALF + WALL), 2, 'terracotta'))
  buildings.push(wall(rect(x0, HALF - WALL, x0 + 60, HALF), 2, 'terracotta'))
  const z0 = -HALF + WALL + i * ((SIZE - 2 * WALL) / 4)
  const z1 = z0 + (SIZE - 2 * WALL) / 4
  buildings.push(wall(rect(-HALF, z0, -HALF + WALL, z1), 2, 'terracotta'))
  buildings.push(wall(rect(HALF - WALL, z0, HALF, z1), 2, 'terracotta'))
}

// The Jantar Mantar compound wall, open to the bazaar in the middle.
const C = COMPOUND
const T = 1
buildings.push(
  wall(rect(C.minX, C.minZ, C.maxX, C.minZ + T), 1),
  wall(rect(C.minX, C.minZ + T, C.minX + T, C.maxZ), 1),
  wall(rect(C.maxX - T, C.minZ + T, C.maxX, C.maxZ), 1),
  wall(rect(C.minX + T, C.maxZ - T, JANTAR_AT.x - 6, C.maxZ), 1),
  wall(rect(JANTAR_AT.x + 6, C.maxZ - T, C.maxX - T, C.maxZ), 1),
)

// ---- ground ----------------------------------------------------------------------------------

const ROAD = 6 // half-width of the main bazaar's carriageway; the rest is footpath
const JOHARI_ROAD = 3.5
const KERB = 0.25
const paving: Paving[] = [
  // carriageways, stopping at the Chaupar's paved square
  { ...rect(-HALF, -ROAD, -SQUARE, ROAD), color: 'road' },
  { ...rect(SQUARE, -ROAD, HALF, ROAD), color: 'road' },
  { ...rect(-JOHARI_ROAD, -HALF, JOHARI_ROAD, -SQUARE), color: 'road' },
  { ...rect(-JOHARI_ROAD, SQUARE, JOHARI_ROAD, HALF), color: 'road' },
  // white kerbs
  ...[-1, 1].flatMap((s): Paving[] => [
    { ...rect(-HALF, s * ROAD, -SQUARE, s * (ROAD + KERB)), color: 'white' },
    { ...rect(SQUARE, s * ROAD, HALF, s * (ROAD + KERB)), color: 'white' },
    { ...rect(s * JOHARI_ROAD, -HALF, s * (JOHARI_ROAD + KERB), -SQUARE), color: 'white' },
    { ...rect(s * JOHARI_ROAD, SQUARE, s * (JOHARI_ROAD + KERB), HALF), color: 'white' },
  ]),
  // the Jantar Mantar courtyard
  { ...grow(rect(C.minX + T, C.minZ + T, C.maxX - T, C.maxZ - T), -0.5), color: 'white' },
]

// ---- props -----------------------------------------------------------------------------------

const props: PropSpec[] = [
  // the metro entrance at the Chaupar's south-west corner, opening onto Johari Bazaar
  { kind: 'station', at: { x: -11, z: 11 }, rot: 270 },
  // tapris: chai at the Chaupar, by Hawa Mahal and down Johari Bazaar
  { kind: 'tapri', at: { x: -12, z: -12 }, rot: 45 },
  { kind: 'tapri', at: { x: 12.5, z: 12.5 }, rot: 315 },
  { kind: 'tapri', at: { x: 56, z: -7.4 } },
  { kind: 'tapri', at: { x: 5.8, z: -40 }, rot: 90 },
  { kind: 'tapri', at: { x: -5.6, z: 36 }, rot: 270 },
  // poster walls, empty for now
  { kind: 'poster-wall', at: { x: -6, z: 48 }, rot: 270 },
  { kind: 'poster-wall', at: { x: 6, z: -48 }, rot: 90 },
  { kind: 'poster-wall', at: { x: -40, z: 7.8 }, rot: 180 },
  // autos waiting for a fare
  { kind: 'auto', at: { x: -30, z: 4.6 }, rot: 90 },
  { kind: 'auto', at: { x: -34, z: 4.6 }, rot: 90 },
  { kind: 'auto', at: { x: 24, z: -4.6 }, rot: 270 },
  { kind: 'auto', at: { x: 80, z: 4.6 }, rot: 90 },
  { kind: 'auto', at: { x: 2.6, z: 54 } },
  { kind: 'auto', at: { x: -2.6, z: 30 }, rot: 180 },
  { kind: 'auto', at: { x: -2.6, z: 84 }, rot: 180 },
  { kind: 'auto', at: { x: 2.6, z: -76 } },
  // a chai stall and a bench on the patch facing Hawa Mahal
  { kind: 'tapri', at: { x: 46, z: 19 }, rot: 180 },
  { kind: 'bench', at: { x: 30, z: 20 }, rot: 180 },
  // benches around the Chaupar
  { kind: 'bench', at: { x: 9.5, z: -14 } },
  { kind: 'bench', at: { x: -9.5, z: -14 } },
  { kind: 'bench', at: { x: 14, z: 9 }, rot: 90 },
  // neem trees at the Chaupar, in the Jantar Mantar court and along the lanes
  { kind: 'tree', at: { x: 13, z: -12 } },
  { kind: 'tree', at: { x: -13.5, z: 14.5 } },
  { kind: 'tree', at: { x: -67, z: -15 } },
  { kind: 'tree', at: { x: -33, z: -15 } },
  { kind: 'tree', at: { x: -67, z: -51 } },
  { kind: 'tree', at: { x: -33, z: -51 } },
  { kind: 'tree', at: { x: -30, z: 62 } },
  { kind: 'tree', at: { x: 30, z: 62 } },
  { kind: 'tree', at: { x: 90, z: 62 } },
  { kind: 'tree', at: { x: -90, z: 62 } },
  { kind: 'tree', at: { x: 40, z: -62 } },
  { kind: 'tree', at: { x: 90, z: -62 } },
  { kind: 'tree', at: { x: -62, z: 90 } },
  { kind: 'tree', at: { x: 62, z: -90 } },
  // lamps along both bazaars' footpaths: the main bazaar's north side only (so they never stand
  // between the camera and the player), and clear of the landmarks' fronts
  ...[18, 56, 78, 108].flatMap((x): PropSpec[] => [
    { kind: 'lamp', at: { x, z: -7.6 } },
    { kind: 'lamp', at: { x: -x, z: -7.6 } },
  ]),
  ...[26, 44, 82, 100].flatMap((z): PropSpec[] =>
    [-1, 1].flatMap((s): PropSpec[] => [
      { kind: 'lamp', at: { x: -5.8, z: s * z } },
      { kind: 'lamp', at: { x: 5.8, z: s * z } },
    ]),
  ),
]

// ---- the cast --------------------------------------------------------------------------------

const npcs: NpcDef[] = [
  // the lassiwala works the stretch of Johari Bazaar just north of where you arrive
  {
    ...CAST.ramesh,
    route: [
      { x: 1, z: 38 },
      { x: 1, z: 20 },
    ],
    speed: 0.8,
  },
  // the blue-pottery kaarigar strolls the west end of the main bazaar
  {
    ...CAST.imran,
    route: [
      { x: -62, z: -2 },
      { x: -46, z: -2 },
    ],
    speed: 0.9,
  },
  // the auto driver paces between the autos waiting west of the Chaupar
  {
    ...CAST.raju,
    route: [
      { x: -28, z: 1 },
      { x: -18, z: 1 },
      { x: -18, z: -3 },
    ],
    speed: 1,
  },
]

const walledCity: DistrictDef = {
  id: 'walled-city',
  name: { hi: 'Gulabi Shahar', en: 'Pink City' },
  size: SIZE,
  // Halfway up Johari Bazaar, looking north between the shops to the Chaupar's fountain.
  spawn: { x: 1.5, z: 44 },
  station: { x: -7.2, z: 11 },
  ground: 'sandstone',
  paving,
  buildings,
  landmarks,
  npcs,
  props,
}

export default walledCity
