import { CAST } from '../cast'
import { DISTRICT_NAMES } from '../districtNames'
import { AMER_FORT, buildAmerFort, PALACE } from '../landmarks/amerFort'
import { roofAt } from '../rooftop'
import type { BuildingSpec, DistrictDef, LandmarkDef, NpcDef, Paving, PropSpec } from '../types'
import { centred, createFill, grow, rect, wall, type Facing } from './layout'

/*
 * Amer, 200 × 200 m; x is east and -z is north. The fort stands on its hill across the north, the lake at its
 * feet, and the road from the city runs east–west along the south of the lake. From the road a broad stone path
 * goes north along the lake's east shore, past the stalls, to the gate at the foot of the ramp. Between the road
 * and the lake, a garden and a low rampart with a bastion on it, whose roof looks across the water at the
 * palace. The old town's havelis and shops fill the west, the east and south of the road. No metro comes here:
 * the bus stops by the road.
 */

const SIZE = 200
const HALF = SIZE / 2
const INNER = 96
const NORTH = 40 // the road's north edge
const SOUTH = 50 // and its south one
const KERB = 0.25

/** The hill the fort stands on, the gate in its south-east corner. */
const FORT_AT = { x: 3, z: -64 }
const FORT = centred(FORT_AT, AMER_FORT)
/** The lake below the fort: water, nobody walks in. */
const LAKE = rect(-44, -38, 28, 14)
/** The path up to the gate, along the lake's east shore; and the garden between the road and the lake. */
const PATH = rect(30, FORT.maxZ, 50, NORTH)
const GARDEN = rect(-44, 17, 28, NORTH)
/** The bus stand's forecourt, on the road's north side: the shelter faces the road across it. */
const STATION_PLAZA = rect(56, NORTH - 10, 72, NORTH)
const LANE = 80 // an east–west lane through the town south of the road; 6 m wide
const CROSS = 4 // half-width of the street running south from the road

// ---- landmarks -------------------------------------------------------------------------------

const landmarks: LandmarkDef[] = [
  {
    id: 'amer-fort',
    name: { hi: 'Amer ka Qila', en: 'Amer Fort' },
    story: {
      hi: 'Aravalli ki pahadi pe bana ye qila Kachhwaha rajaon ki raajdhani tha, Jaipur basne se pehle. Neeche Maota jheel hai, aur upar tak ek lambi chadhai.',
      en: 'On an Aravalli hill, this fort was the Kachhwaha capital before Jaipur was built. Maota Lake lies at its feet, and a long ramp climbs to the top.',
    },
    // at the gate, where the walk up starts
    at: { x: 38, z: -34 },
    radius: 9,
    footprint: FORT,
    build: async () => {
      const g = buildAmerFort()
      g.position.set(FORT_AT.x, 0, FORT_AT.z)
      return g
    },
  },
]

// ---- buildings -------------------------------------------------------------------------------

/** The bastion on the rampart: its roof is the viewpoint over the lake (see `roof`). */
const BASTION: BuildingSpec = { x: -10, z: 20.5, w: 10, d: 9, floors: 3, style: 'haveli', tint: 'ochre' }
/** The low rampart along the lake's south shore, either side of the bastion. */
const RAMPART = [wall(rect(-44, 15, -15, 16.2), 1, 'sandstone'), wall(rect(-5, 15, 28, 16.2), 1, 'sandstone')]

const KEEP_OUT = [
  grow(FORT, 3),
  grow(LAKE, 2),
  rect(PATH.minX, -HALF, PATH.maxX + 2, NORTH),
  GARDEN,
  rect(-HALF, NORTH, HALF, SOUTH + 4),
  rect(-HALF, LANE - 3, HALF, LANE + 3),
  rect(-CROSS, SOUTH, CROSS, HALF),
  STATION_PLAZA,
]

const { buildings, rand, row } = createFill(1727, rect(-INNER, -INNER, INNER, INNER), KEEP_OUT)
buildings.push(BASTION, ...RAMPART)

/** The old town: havelis and shops in sandstone, ochre and a little pink; now and then a temple. */
const town = (w: number, d: number): Omit<BuildingSpec, 'x' | 'z' | 'rot'> => {
  const r = rand()
  if (r < 0.06 && w >= 8) return { w, d, floors: 2, style: 'temple', tint: 'white' }
  const t = rand()
  const tint = t < 0.45 ? 'sandstone' : t < 0.8 ? 'ochre' : t < 0.92 ? 'pink' : 'white'
  if (r < 0.45) return { w, d, floors: (1 + Math.floor(rand() * 2)) as 1 | 2, style: 'shop', tint }
  return { w, d, floors: (2 + Math.floor(rand() * 2)) as 2 | 3, style: 'haveli', tint }
}
const townRow = (from: number, to: number, front: number, facing: Facing) =>
  row(from, to, front, facing, town, { w: [7, 11], d: [8, 10] })

// along the road, north side, either side of the lake
townRow(-INNER, -50, NORTH, 's')
townRow(52, INNER, NORTH, 's')
// the path's east side, and the lane on the lake's west
townRow(-INNER, NORTH, 52, 'w')
townRow(-INNER, NORTH, -50, 'e')
// south of the road, and the lane behind
townRow(-INNER, INNER, SOUTH + 4, 'n')
townRow(-INNER, INNER, LANE - 3, 's')
townRow(-INNER, INNER, LANE + 3, 'n')

// ---- ground ----------------------------------------------------------------------------------

const paving: Paving[] = [
  { ...rect(-HALF, NORTH, HALF, SOUTH), color: 'road' },
  { ...rect(-HALF, NORTH - KERB, HALF, NORTH), color: 'white' },
  { ...rect(-HALF, SOUTH, HALF, SOUTH + KERB), color: 'white' },
  { ...rect(-HALF, LANE - 2.5, HALF, LANE + 2.5), color: 'road' },
  { ...rect(-CROSS + 0.5, SOUTH, CROSS - 0.5, HALF), color: 'road' },
  { ...GARDEN, color: 'grass' },
  // the ghat round the lake, the water, and the garden island in it
  { ...grow(LAKE, 1.5), color: 'white' },
  { ...LAKE, color: 'glass' },
  { ...rect(-16, -18, 0, -6), color: 'white' },
  { ...rect(-15, -17, -1, -7), color: 'grass' },
  // the stone path up to the gate
  { ...rect(34, FORT.maxZ, 44, NORTH), color: 'white' },
  {
    ...rect(STATION_PLAZA.minX + 0.5, STATION_PLAZA.minZ + 0.5, STATION_PLAZA.maxX - 0.5, NORTH),
    color: 'white',
  },
]

// ---- props -----------------------------------------------------------------------------------

const props: PropSpec[] = [
  // the bus stand, facing the road (there is no metro here)
  { kind: 'bus-stop', at: { x: 64, z: 36.5 } },
  // stalls along the path up: chai, and lac bangles
  ...[-22, -6, 10].map((z): PropSpec => ({ kind: 'tapri', at: { x: 50, z }, rot: 90 })),
  { kind: 'tapri', at: { x: -36, z: 38 }, rot: 180 },
  // the garden: benches looking at the rampart, trees and lamps
  ...[-28, 12].map((x): PropSpec => ({ kind: 'bench', at: { x, z: 26 }, rot: 180 })),
  { kind: 'bench', at: { x: 32, z: 4 }, rot: 270 },
  ...[-38, -22, 4, 20].map((x): PropSpec => ({ kind: 'tree', at: { x, z: 34 } })),
  ...[-30, -14, 6, 22].map((x): PropSpec => ({ kind: 'lamp', at: { x, z: 38.6 } })),
  ...[-30, -14, 2, 18].map((z): PropSpec => ({ kind: 'lamp', at: { x: 46, z } })),
  { kind: 'poster-wall', at: { x: 46, z: 30 }, rot: 90 },
  // autos waiting on the road by the path
  { kind: 'auto', at: { x: 20, z: 42.6 }, rot: 90 },
  { kind: 'auto', at: { x: 24, z: 42.6 }, rot: 90 },
  { kind: 'auto', at: { x: -60, z: 47.4 }, rot: 270 },
]

// ---- the cast --------------------------------------------------------------------------------

const npcs: NpcDef[] = [
  // the guide walks visitors up the path to the gate and back
  {
    ...CAST.gopal,
    route: [
      { x: 38, z: 30 },
      { x: 38, z: -28 },
    ],
    speed: 0.9,
  },
  // the bangle maker steps out between her stall and the next
  {
    ...CAST.shabnam,
    route: [
      { x: 44.5, z: -2 },
      { x: 44.5, z: 6 },
    ],
    speed: 0.6,
  },
]

const amer: DistrictDef = {
  id: 'amer',
  name: DISTRICT_NAMES.amer,
  size: SIZE,
  // At the foot of the path, looking north up it to the gate, the lake and the fort on its hill to the left.
  spawn: { x: 34, z: 31 },
  station: { x: 64, z: 39.5 },
  centre: { x: 0, z: 30 },
  /** The road along the lake, out and back. */
  processionRoute: [
    { x: -40, z: 45.5 },
    { x: 40, z: 45.5 },
    { x: 40, z: 48 },
    { x: -40, z: 48 },
  ],
  /** Where the street dogs, cats and the district's cow live: open ground, clear of every collider. */
  animals: {
    dogs: [
      { x: 40, z: 20 },
      { x: 34, z: -12 },
      { x: -20, z: 30 },
      { x: 8, z: 22 },
    ],
    cats: [
      { x: -34, z: 22 },
      { x: 42, z: 0 },
    ],
    cow: { x: 2, z: 30 },
  },
  ground: 'sandstone',
  paving,
  buildings,
  landmarks,
  npcs,
  props,
  /** Where the path leaves the road, halfway up it, and in the garden by the road. */
  signposts: [
    { x: 33, z: 37.5 },
    { x: 33, z: -16 },
    { x: -20, z: 37.5 },
  ],
  /** The bastion on the rampart: its roof looks north across the lake at the palace. */
  roof: roofAt(buildings, BASTION, 1, { x: FORT_AT.x + PALACE.x, z: FORT_AT.z + PALACE.z }),
  water: [LAKE],
}

export default amer
