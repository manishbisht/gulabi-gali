import { t } from '../../i18n/strings'
import { CAST } from '../cast'
import { DISTRICT_NAMES } from '../districtNames'
import { buildCityBelow } from '../landmarks/cityBelow'
import { buildNahargarhFort, NAHARGARH_FORT } from '../landmarks/nahargarhFort'
import { roofAt } from '../rooftop'
import type { BuildingSpec, DistrictDef, LandmarkDef, NpcDef, Paving, PropSpec, RoofDef } from '../types'
import { centred, createFill, grow, rect, wall, type Facing } from './layout'

/*
 * Nahargarh, 200 × 200 m on the Aravalli ridge above the city; x is east and -z is north. The fort's square of
 * walls stands across the north, its gateway facing south onto a forecourt. The ridge road comes in from the east
 * along the south, past the bus stand, bends north at the west end and runs back east along the forecourt; from
 * the bend a path goes west to the terrace on the ridge's edge. There a low parapet runs along the drop, and the
 * bastion on the terrace is the sunset point: from its roof the whole city lies below, to the west. Between the
 * roads, scrub and a few trees; walls along the ridge; dhabas and the old quarters fill the rest. No metro comes
 * up here: the bus stops by the road.
 */

const SIZE = 200
const HALF = SIZE / 2
const INNER = 96
const KERB = 0.25

/** The ridge road, along the south from the east edge; the bend north at its west end; and the road along the forecourt. */
const ROAD = rect(-38, 44, HALF, 52)
const BEND = rect(-38, -28, -30, 52)
const UPPER = rect(-38, -28, 60, -20)

/** The fort on the ridge, its gateway on the forecourt. */
const FORT_AT = { x: 12, z: -64 }
const FORT = centred(FORT_AT, NAHARGARH_FORT)
/** The open court before the gateway, from the fort to the upper road. */
const COURT = rect(-6, FORT.maxZ, 30, UPPER.minZ)
/** The terrace along the ridge's edge, and the path to it from the bend. */
const TERRACE = rect(-97, -26, -56, 26)
const PATH = rect(-56, -5, -38, 5)
/** The scrub between the roads. */
const SCRUB = rect(-30, -20, 60, 44)
/** The bus stand's forecourt, on the road's north side: the shelter faces the road across it. */
const STATION_PLAZA = rect(62, 34, 78, 44)

// ---- landmarks -------------------------------------------------------------------------------

const landmarks: LandmarkDef[] = [
  {
    id: 'nahargarh-fort',
    name: { hi: 'Nahargarh ka Qila', en: 'Nahargarh Fort' },
    story: {
      hi: 'Aravalli ki dhaar pe ye qila Sawai Jai Singh ne 1734 mein banwaya, shahar ki hifazat ke liye. Andar Madhavendra Bhawan hai, aur deewaron se poora Gulabi Shahar neeche bichha dikhta hai.',
      en: 'Sawai Jai Singh II built this fort on the Aravalli ridge in 1734 to guard the city. Madhavendra Bhawan stands inside, and from its walls the whole Pink City lies spread out below.',
    },
    // on the forecourt, before the gateway
    at: { x: 12, z: -40 },
    radius: 9,
    footprint: FORT,
    build: async () => {
      const g = buildNahargarhFort()
      g.position.set(FORT_AT.x, 0, FORT_AT.z)
      return g
    },
  },
]

// ---- buildings -------------------------------------------------------------------------------

/** The bastion on the terrace, its front to the west: its roof is the sunset point (see `roof`). */
const BASTION: BuildingSpec = {
  x: -82,
  z: 0,
  w: 10,
  d: 9,
  floors: 3,
  style: 'haveli',
  tint: 'ochre',
  rot: 90,
}
/** The fort's walls running on along the ridge, north and south of everything. */
const RIDGE_WALLS = [
  wall(rect(-96, -94, -24, -92.8), 1, 'sandstone'),
  wall(rect(48, -94, 96, -92.8), 1, 'sandstone'),
  wall(rect(-96, 92.8, 96, 94), 1, 'sandstone'),
]

const KEEP_OUT = [
  grow(FORT, 3),
  grow(COURT, 1),
  grow(TERRACE, 3),
  grow(PATH, 3),
  SCRUB,
  rect(-HALF, ROAD.minZ, HALF, ROAD.maxZ + 4),
  rect(BEND.minX - 4, BEND.minZ - 1, BEND.maxX + 1, BEND.maxZ),
  rect(UPPER.minX, UPPER.minZ - 4, UPPER.maxX + 6, UPPER.maxZ + 1),
  STATION_PLAZA,
  rect(-HALF, -HALF, HALF, -88), // the ridge walls' line, north
  rect(-HALF, 88, HALF, HALF), // and south
]

const { buildings, rand, row } = createFill(1734, rect(-INNER, -INNER, INNER, INNER), KEEP_OUT)
buildings.push(BASTION, ...RIDGE_WALLS)

/** Up here: dhabas and stalls in sandstone and ochre, the old quarters' havelis, little pink. */
const ridge = (w: number, d: number): Omit<BuildingSpec, 'x' | 'z' | 'rot'> => {
  const r = rand()
  const t = rand()
  const tint = t < 0.5 ? 'sandstone' : t < 0.85 ? 'ochre' : t < 0.95 ? 'white' : 'pink'
  if (r < 0.5) return { w, d, floors: 1, style: 'shop', tint }
  return { w, d, floors: (1 + Math.floor(rand() * 2)) as 1 | 2, style: 'haveli', tint }
}
const ridgeRow = (from: number, to: number, front: number, facing: Facing) =>
  row(from, to, front, facing, ridge, { w: [7, 11], d: [7, 9] })

// along the ridge road: its south side, and its north side past the bus stand
ridgeRow(-34, INNER, ROAD.maxZ + 4, 'n')
ridgeRow(STATION_PLAZA.maxX + 1, INNER, ROAD.minZ, 's')
// the east end: facing the scrub, and the upper road's north side past the fort
ridgeRow(-16, 32, 66, 'w')
ridgeRow(FORT.maxX + 4, INNER, UPPER.minZ - 4, 's')
// the old quarters either side of the terrace, facing it
ridgeRow(-INNER, -44, TERRACE.maxZ + 4, 'n')
ridgeRow(-INNER, -44, TERRACE.minZ - 4, 's')

// ---- ground ----------------------------------------------------------------------------------

const paving: Paving[] = [
  { ...ROAD, color: 'road' },
  { ...BEND, color: 'road' },
  { ...UPPER, color: 'road' },
  { ...rect(ROAD.minX, ROAD.minZ - KERB, HALF, ROAD.minZ), color: 'white' },
  { ...rect(ROAD.minX, ROAD.maxZ, HALF, ROAD.maxZ + KERB), color: 'white' },
  // scrub: patches of green between the roads
  { ...rect(-26, -14, 4, 20), color: 'grass' },
  { ...rect(22, 0, 56, 38), color: 'grass' },
  // the forecourt, the path and the terrace, paved in lime-white
  { ...COURT, color: 'white' },
  { ...PATH, color: 'white' },
  { ...TERRACE, color: 'white' },
  { ...rect(TERRACE.minX + 2, -3, TERRACE.minX + 10, 3), color: 'sandstone' },
  {
    ...rect(STATION_PLAZA.minX + 0.5, STATION_PLAZA.minZ + 0.5, STATION_PLAZA.maxX - 0.5, ROAD.minZ),
    color: 'white',
  },
]

// ---- props -----------------------------------------------------------------------------------

const props: PropSpec[] = [
  // the bus stand, facing the road (there is no metro up here)
  { kind: 'bus-stop', at: { x: 70, z: 36.5 } },
  // chai: on the terrace's north side, and by the upper road
  { kind: 'tapri', at: { x: -66, z: -22 } },
  { kind: 'tapri', at: { x: 40, z: -15 }, rot: 180 },
  // benches on the terrace, by the parapet, looking west at the sunset
  ...[-12, 12].map((z): PropSpec => ({ kind: 'bench', at: { x: -93, z }, rot: 90 })),
  { kind: 'bench', at: { x: -12, z: 24 }, rot: 180 },
  // the poster wall on the forecourt's west side, facing it
  { kind: 'poster-wall', at: { x: -4.5, z: -34 }, rot: 270 },
  // trees in the scrub, clear of the way up to the gateway
  ...[
    [-22, -8],
    [-14, 6],
    [-4, -12],
    [-20, 30],
    [24, -10],
    [30, 18],
    [46, 4],
    [50, 30],
    [34, 34],
    [-2, 32],
  ].map(([x, z]): PropSpec => ({ kind: 'tree', at: { x: x!, z: z! } })),
  // lamps along the terrace and the forecourt road
  ...[-20, 20].map((z): PropSpec => ({ kind: 'lamp', at: { x: -60, z } })),
  ...[-4, 28].map((x): PropSpec => ({ kind: 'lamp', at: { x, z: -18 } })),
  ...[-10, 40].map((x): PropSpec => ({ kind: 'lamp', at: { x, z: 42.6 } })),
  // autos waiting on the road by the bus stand
  { kind: 'auto', at: { x: 52, z: 46.6 }, rot: 90 },
  { kind: 'auto', at: { x: 56, z: 46.6 }, rot: 90 },
]

// ---- the cast --------------------------------------------------------------------------------

const npcs: NpcDef[] = [
  // the corn seller works the forecourt before the gateway
  {
    ...CAST.bhanwar,
    route: [
      { x: 2, z: -31 },
      { x: 26, z: -31 },
    ],
    speed: 0.6,
  },
  // the photography student paces the terrace, waiting for the light
  {
    ...CAST.tara,
    route: [
      { x: -72, z: -16 },
      { x: -72, z: 16 },
    ],
    speed: 0.8,
  },
]

/**
 * `roof`, faced up its stair at the stair's foot: the chase camera, 7 m behind, then hangs over the open terrace
 * in front of the bastion. Faced out, it sat inside the stair's flight; faced along the side, against the front wall.
 */
const upTheStair = (roof: RoofDef): RoofDef => ({ ...roof, foot: { x: -roof.out.x, z: -roof.out.z } })

const nahargarh: DistrictDef = {
  id: 'nahargarh',
  name: DISTRICT_NAMES.nahargarh,
  size: SIZE,
  // Off the bus, on the road's edge, looking north across the scrub at the fort on the ridge.
  spawn: { x: 50, z: 40 },
  station: { x: 70, z: 39.5 },
  centre: { x: -68, z: 12 },
  /** The ridge road, out and back. */
  processionRoute: [
    { x: -20, z: 47.5 },
    { x: 40, z: 47.5 },
    { x: 40, z: 50 },
    { x: -20, z: 50 },
  ],
  /** Where the street dogs, cats and the district's cow live: open ground, clear of every collider. */
  animals: {
    dogs: [
      { x: -66, z: 14 },
      { x: 14, z: 26 },
      { x: -34, z: 20 },
      { x: 40, z: 8 },
    ],
    cats: [
      { x: -62, z: -12 },
      { x: 20, z: -36 },
    ],
    cow: { x: -8, z: 16 },
  },
  ground: 'sandstone',
  paving,
  buildings,
  landmarks,
  npcs,
  props,
  /** At the bend's two corners, and where the path leaves for the terrace. */
  signposts: [
    { x: -27.5, z: 41 },
    { x: -27.5, z: -17 },
    { x: -50, z: 7.5 },
  ],
  /**
   * The bastion on the terrace: its roof looks west, over the parapet, at the city below. At the stair's foot the
   * player faces up the stair (see RoofDef.foot and `upTheStair`).
   */
  roof: upTheStair(roofAt(buildings, BASTION, 1)),
  roofName: { hi: t('sunsetPoint', 'hi'), en: t('sunsetPoint', 'en') },
  ridgeWest: -HALF,
  scenery: () => buildCityBelow(-HALF, HALF),
}

export default nahargarh
