import { CAST } from '../cast'
import { DISTRICT_NAMES } from '../districtNames'
import { buildWtp, WTP } from '../landmarks/wtp'
import { roofAt } from '../rooftop'
import type { BuildingSpec, DistrictDef, LandmarkDef, NpcDef, Paving, PropSpec } from '../types'
import { centred, createFill, grow, placed, rect, type Facing } from './layout'

/*
 * Malviya Nagar and WTP, 200 × 200 m; x is east and -z is north. JLN Marg runs east–west across the
 * south of the district, and World Trade Park stands north of it behind a wide paved forecourt. Around
 * it, a grid of streets lined with modern blocks and coaching centres.
 */

const SIZE = 200
const HALF = SIZE / 2
const INNER = 96
const NORTH = 36 // JLN Marg's north building line
const SOUTH = 56 // and its south one
const ROAD = [40, 52] as const
const STREETS = [44, 78] as const // north–south street centre lines, at ±; each 12 m between building lines
const LANES = [-77, -41, 81] as const // east–west lane centre lines; each 6 m wide
const CROSS = 4 // half-width of the street running south from JLN Marg
const KERB = 0.25

const WTP_AT = { x: 0, z: -3 }
/** The paved court in front of WTP, open to JLN Marg. */
const FORECOURT = rect(-30, WTP_AT.z + WTP.d / 2, 30, NORTH)

// ---- landmarks -------------------------------------------------------------------------------

const landmarks: LandmarkDef[] = [
  {
    id: 'wtp',
    name: { hi: 'World Trade Park', en: 'World Trade Park' },
    story: {
      hi: 'JLN Marg pe 2012 mein khula ye mall. Iske do block hain, north aur south, beech mein ek sadak — aur upar ek pul jo dono ko jodta hai.',
      en: 'This mall on JLN Marg opened in 2012. It has two blocks, north and south, with a street between them and a bridge joining the two.',
    },
    at: WTP_AT,
    radius: 18,
    footprint: centred(WTP_AT, WTP),
    build: placed(buildWtp, WTP_AT),
  },
]

// ---- buildings -------------------------------------------------------------------------------

/** The metro entrance's forecourt, on JLN Marg's south side. */
const STATION_PLAZA = rect(-48, SOUTH, -32, SOUTH + 12)

const KEEP_OUT = [
  grow(landmarks[0]!.footprint, 3),
  FORECOURT,
  rect(-HALF, NORTH, HALF, SOUTH),
  ...STREETS.flatMap((x) => [rect(-x - 6, -HALF, -x + 6, NORTH), rect(x - 6, -HALF, x + 6, NORTH)]),
  ...LANES.map((z) => rect(-HALF, z - 3, HALF, z + 3)),
  rect(-CROSS, SOUTH, CROSS, HALF),
  STATION_PLAZA,
]

const { buildings, rand, row } = createFill(2012, rect(-INNER, -INNER, INNER, INNER), KEEP_OUT)

/** Mostly modern blocks of flats and offices; one in three a coaching centre with its signboard. */
const block = (w: number, d: number): Omit<BuildingSpec, 'x' | 'z' | 'rot'> => {
  if (rand() < 0.3)
    return { w, d, floors: (2 + Math.floor(rand() * 2)) as 2 | 3, style: 'shop', tint: 'white' }
  const t = rand()
  const tint = t < 0.4 ? 'white' : t < 0.7 ? 'sandstone' : t < 0.85 ? 'teal' : 'terracotta'
  return { w, d, floors: (3 + Math.floor(rand() * 2)) as 3 | 4, style: 'modern', tint }
}
const blockRow = (from: number, to: number, front: number, facing: Facing) =>
  row(from, to, front, facing, block, { w: [9, 14], d: [10, 12] })

// JLN Marg, both sides
blockRow(-INNER, INNER, NORTH, 's')
blockRow(-INNER, INNER, SOUTH, 'n')
// the north–south streets, both sides of each
for (const x of STREETS) {
  for (const s of [-1, 1]) {
    blockRow(-INNER, NORTH, s * (x - 6), s < 0 ? 'w' : 'e')
    blockRow(-INNER, NORTH, s * (x + 6), s < 0 ? 'e' : 'w')
  }
}
// the lanes, both sides
for (const z of LANES) {
  blockRow(-INNER, INNER, z - 3, 's')
  blockRow(-INNER, INNER, z + 3, 'n')
}

// ---- ground ----------------------------------------------------------------------------------

const paving: Paving[] = [
  { ...rect(-HALF, ROAD[0], HALF, ROAD[1]), color: 'road' },
  { ...rect(-HALF, ROAD[0] - KERB, HALF, ROAD[0]), color: 'white' },
  { ...rect(-HALF, ROAD[1], HALF, ROAD[1] + KERB), color: 'white' },
  ...STREETS.flatMap((x): Paving[] => [
    { ...rect(-x - 4, -HALF, -x + 4, ROAD[0]), color: 'road' },
    { ...rect(x - 4, -HALF, x + 4, ROAD[0]), color: 'road' },
  ]),
  ...LANES.map((z): Paving => ({ ...rect(-HALF, z - 2.5, HALF, z + 2.5), color: 'road' })),
  { ...rect(-CROSS + 0.5, ROAD[1], CROSS - 0.5, HALF), color: 'road' },
  { ...FORECOURT, color: 'white' },
  { ...grow(STATION_PLAZA, -0.5), color: 'white' },
]

// ---- props -----------------------------------------------------------------------------------

const props: PropSpec[] = [
  // the metro entrance, opening east across its forecourt
  { kind: 'station', at: { x: -44, z: 61 }, rot: 270 },
  // coaching posters and the chai stalls outside the coaching centres
  ...[-88, -62, 62, 88].map((x): PropSpec => ({ kind: 'poster-wall', at: { x, z: 37.2 } })),
  { kind: 'poster-wall', at: { x: 20, z: 54.8 }, rot: 180 },
  { kind: 'tapri', at: { x: -70, z: 37.6 } },
  { kind: 'tapri', at: { x: 70, z: 37.6 } },
  { kind: 'tapri', at: { x: 28, z: 54.4 }, rot: 180 },
  // the forecourt: lamps, benches and a few trees
  ...[-27, -14, 14, 27].map((x): PropSpec => ({ kind: 'lamp', at: { x, z: 33.6 } })),
  ...[-20, 20].map((x): PropSpec => ({ kind: 'bench', at: { x, z: 22 } })),
  ...[-27, 27].map((x): PropSpec => ({ kind: 'tree', at: { x, z: 22 } })),
  // lamps along JLN Marg's north footpath
  ...[-78, -54, -36, 36, 54, 78].map((x): PropSpec => ({ kind: 'lamp', at: { x, z: 39.6 } })),
  // trees along the lanes and streets
  ...[-60, -20, 20, 60].flatMap((x): PropSpec[] =>
    LANES.slice(0, 2).map((z): PropSpec => ({ kind: 'tree', at: { x, z: z + 2.2 } })),
  ),
  ...[-60, -20, 20, 60].map((x): PropSpec => ({ kind: 'tree', at: { x, z: LANES[2] - 2.2 } })),
  // autos and a car-free Sunday street for cricket
  { kind: 'auto', at: { x: -14, z: 42.6 }, rot: 90 },
  { kind: 'auto', at: { x: -18, z: 42.6 }, rot: 90 },
  { kind: 'auto', at: { x: 40, z: 49.4 }, rot: 270 },
  { kind: 'auto', at: { x: 2, z: 72 } },
]

// ---- the cast --------------------------------------------------------------------------------

const npcs: NpcDef[] = [
  // the gully cricket captain walks out his pitch on the lane south of the road
  {
    ...CAST.farhan,
    route: [
      { x: -34, z: LANES[2] },
      { x: -12, z: LANES[2] },
    ],
    speed: 1.1,
  },
  // the developer takes a chai break across WTP's forecourt
  {
    ...CAST.neha,
    route: [
      { x: -12, z: 28 },
      { x: 12, z: 28 },
    ],
    speed: 0.8,
  },
]

const malviyaNagar: DistrictDef = {
  id: 'malviya-nagar',
  name: DISTRICT_NAMES['malviya-nagar'],
  size: SIZE,
  // On JLN Marg, looking north across the forecourt at WTP.
  spawn: { x: 6, z: 46 },
  station: { x: -40.4, z: 61 },
  centre: { x: 0, z: 27 },
  /** A short stretch of JLN Marg, out along its carriageway and back. */
  processionRoute: [
    { x: -10, z: 45 },
    { x: 34, z: 45 },
    { x: 34, z: 50 },
    { x: -10, z: 50 },
  ],
  /** Where the street dogs, cats and the district's cow live: open ground, clear of every collider. */
  animals: {
    dogs: [
      { x: 0, z: 44 },
      { x: 10, z: 40 },
      { x: -6, z: 34 },
      { x: 10, z: 26 },
    ],
    cats: [
      { x: -10, z: 24 },
      { x: 0, z: 16 },
    ],
    cow: { x: 0, z: 26 },
  },
  ground: 'sandstone',
  paving,
  buildings,
  landmarks,
  npcs,
  props,
  /** On JLN Marg before WTP's forecourt, and where the side streets meet it. */
  signposts: [
    { x: -5, z: 38 },
    { x: -39, z: 37.5 },
    { x: 39, z: 37.5 },
  ],
  /** A three-storey block on JLN Marg by the street running south: its roof looks across the road at WTP. */
  roof: roofAt(buildings, { x: -11, z: 61.5 }, -1, WTP_AT),
  /** Gali cricket where the lane meets the street south of JLN Marg: the pitch its captain walks out. */
  cricket: { stumps: { x: -3.5, z: LANES[2] }, bowler: { x: -10.5, z: LANES[2] } },
}

export default malviyaNagar
