import { CAST } from '../cast'
import { DISTRICT_NAMES } from '../districtNames'
import { ALBERT_HALL, buildAlbertHall } from '../landmarks/albertHall'
import { buildRamNiwasGate, RAM_NIWAS_GATE } from '../landmarks/ramNiwasGate'
import { roofAt } from '../rooftop'
import type { BuildingSpec, DistrictDef, LandmarkDef, NpcDef, Paving, PropSpec, StringLight } from '../types'
import { centred, createFill, grow, placed, rect, wall, type Facing } from './layout'

/*
 * MI Road and Raja Park, 200 × 200 m; x is east and -z is north. MI Road runs east–west across the
 * south of the district, lined with ochre and sandstone shops and cafés. North of it, behind its gate,
 * lies Ram Niwas Bagh, and up the garden avenue stands Albert Hall, so the gate frames the hall as you
 * look up from the road. Two side roads run north from MI Road; a lane of Raja Park houses runs behind
 * its south side.
 */

const SIZE = 200
const HALF = SIZE / 2
const INNER = 96 // buildings stop here
const NORTH = 42 // MI Road's north building line
const SOUTH = 62 // and its south one
const ROAD = [46, 58] as const // MI Road's carriageway; the rest is footpath
const SIDE = 80 // the side roads' centre lines, at ±SIDE, each 12 m between building lines
const LANE = [78, 84] as const // the Raja Park lane
const KERB = 0.25

const GATE_AT = { x: 0, z: 30 }
const HALL_AT = { x: 0, z: -24 }
/** Ram Niwas Bagh, walled, with the gate in the middle of its MI Road side, set back behind an open apron. */
const BAGH = rect(-36, -82, 36, 30)
const APRON = rect(BAGH.minX - 1, BAGH.maxZ, BAGH.maxX + 1, NORTH)

// ---- landmarks -------------------------------------------------------------------------------

const landmarks: LandmarkDef[] = [
  {
    id: 'albert-hall',
    name: { hi: 'Albert Hall', en: 'Albert Hall' },
    story: {
      hi: 'Iski neev 1876 mein Prince of Wales ke Jaipur aane pe rakhi gayi, design Samuel Swinton Jacob ka. 1887 mein museum ban ke khula — Rajasthan ka sabse purana museum.',
      en: "Its foundation stone was laid in 1876, when the Prince of Wales visited Jaipur; Samuel Swinton Jacob designed it. It opened as a museum in 1887, the state's oldest.",
    },
    at: HALL_AT,
    radius: 16,
    footprint: centred(HALL_AT, ALBERT_HALL),
    build: placed(buildAlbertHall, HALL_AT),
  },
  {
    id: 'ram-niwas-gate',
    name: { hi: 'Ram Niwas Bagh', en: 'Ram Niwas Bagh' },
    story: {
      hi: 'Maharaja Sawai Ram Singh II ne 1868 mein ye bagh banwaya. Albert Hall isi bagh ke andar khada hai, aur yahin shahar ka purana chidiyaghar bhi hai.',
      en: "Maharaja Sawai Ram Singh II laid out this garden in 1868. Albert Hall stands inside it, and so does the city's old zoo.",
    },
    at: GATE_AT,
    radius: 10,
    footprint: centred(GATE_AT, RAM_NIWAS_GATE),
    build: placed(buildRamNiwasGate, GATE_AT),
  },
]

// ---- buildings -------------------------------------------------------------------------------

/** The metro entrance's forecourt, on MI Road's south side. */
const STATION_PLAZA = rect(-28, SOUTH, -12, SOUTH + 12)

const KEEP_OUT = [
  grow(BAGH, 1),
  APRON,
  rect(-HALF, NORTH, HALF, SOUTH),
  rect(-SIDE - 6, -HALF, -SIDE + 6, NORTH),
  rect(SIDE - 6, -HALF, SIDE + 6, NORTH),
  rect(-HALF, LANE[0], HALF, LANE[1]),
  STATION_PLAZA,
]

const { buildings, rand, row } = createFill(1868, rect(-INNER, -INNER, INNER, INNER), KEEP_OUT)

const pick = <T>(weights: [T, number][]): T => {
  let r = rand()
  for (const [v, w] of weights) if ((r -= w) < 0) return v
  return weights[weights.length - 1]![0]
}
type Look = Omit<BuildingSpec, 'x' | 'z' | 'rot'>
const TINTS: [BuildingSpec['tint'], number][] = [
  ['ochre', 0.5],
  ['sandstone', 0.34],
  ['terracotta', 0.1],
  ['white', 0.06],
]

/** MI Road: arcaded shops, some with a café's teal shutters, and the odd old ochre haveli. */
const bazaar = (w: number, d: number): Look => {
  const style = rand() < 0.86 ? 'shop' : 'haveli'
  const floors = (2 + Math.floor(rand() * 2)) as 2 | 3
  return { w, d, floors, style, tint: pick(TINTS) }
}
/** Raja Park and the side roads: houses and small modern blocks among the shops. */
const houses = (w: number, d: number): Look => {
  const style = pick<BuildingSpec['style']>([
    ['modern', 0.4],
    ['shop', 0.35],
    ['haveli', 0.25],
  ])
  const floors = (2 + Math.floor(rand() * 2)) as 2 | 3
  const tint =
    style === 'modern'
      ? pick<BuildingSpec['tint']>([
          ['sandstone', 0.75],
          ['white', 0.25],
        ])
      : pick(TINTS)
  return { w, d, floors, style, tint }
}
const SHOPS = { w: [7, 11] as [number, number], d: [9, 12] as [number, number] }
const shopRow = (from: number, to: number, front: number, facing: Facing) =>
  row(from, to, front, facing, bazaar, SHOPS)
const houseRow = (from: number, to: number, front: number, facing: Facing, deep = 12) =>
  row(from, to, front, facing, houses, { w: [8, 12], d: [9, deep] })

// MI Road, both sides
shopRow(-INNER, -37, NORTH, 's')
shopRow(37, INNER, NORTH, 's')
shopRow(-INNER, INNER, SOUTH, 'n')
// the side roads, both sides, and the rows facing the garden wall
for (const s of [-1, 1]) {
  const outer = s * (SIDE + 6)
  const inner = s * (SIDE - 6)
  houseRow(-INNER, NORTH, outer, s < 0 ? 'e' : 'w', 10)
  houseRow(-INNER, NORTH, inner, s < 0 ? 'w' : 'e')
  houseRow(-INNER, NORTH, s * 38, s < 0 ? 'e' : 'w')
}
// the Raja Park lane
houseRow(-INNER, INNER, LANE[1], 'n')

// Ram Niwas Bagh's wall, with walkers' gaps either side of the gate
const T = 1
const gap = RAM_NIWAS_GATE.w / 2 + 3
buildings.push(
  wall(rect(BAGH.minX, BAGH.maxZ - T, -gap, BAGH.maxZ), 1, 'ochre'),
  wall(rect(gap, BAGH.maxZ - T, BAGH.maxX, BAGH.maxZ), 1, 'ochre'),
  wall(rect(BAGH.minX, BAGH.minZ, BAGH.minX + T, BAGH.maxZ - T), 1, 'ochre'),
  wall(rect(BAGH.maxX - T, BAGH.minZ, BAGH.maxX, BAGH.maxZ - T), 1, 'ochre'),
  wall(rect(BAGH.minX + T, BAGH.minZ, BAGH.maxX - T, BAGH.minZ + T), 1, 'ochre'),
)

// ---- ground ----------------------------------------------------------------------------------

const paving: Paving[] = [
  { ...rect(-HALF, ROAD[0], HALF, ROAD[1]), color: 'road' },
  { ...rect(-SIDE - 4, -HALF, -SIDE + 4, ROAD[0]), color: 'road' },
  { ...rect(SIDE - 4, -HALF, SIDE + 4, ROAD[0]), color: 'road' },
  { ...rect(-HALF, LANE[0], HALF, LANE[1]), color: 'road' },
  { ...rect(-HALF, ROAD[0] - KERB, HALF, ROAD[0]), color: 'white' },
  { ...rect(-HALF, ROAD[1], HALF, ROAD[1] + KERB), color: 'white' },
  // the garden: lawns, the avenue up to the hall, its forecourt and the paths in from the gate
  { ...rect(BAGH.minX + T, BAGH.minZ + T, BAGH.maxX - T, BAGH.maxZ - T), color: 'grass' },
  { ...rect(-3, HALL_AT.z, 3, BAGH.maxZ - T), color: 'sandstone' },
  { ...rect(-24, HALL_AT.z + 10, 24, HALL_AT.z + 24), color: 'sandstone' },
  { ...rect(-gap, BAGH.maxZ - 10, gap, BAGH.maxZ - T), color: 'sandstone' },
  { ...grow(STATION_PLAZA, -0.5), color: 'white' },
]

// ---- props -----------------------------------------------------------------------------------

const props: PropSpec[] = [
  // the metro entrance, opening east across its forecourt
  { kind: 'station', at: { x: -24, z: 66 }, rot: 270 },
  // the apron before the gate: trees and benches
  ...[-30, -18, 18, 30].map((x): PropSpec => ({ kind: 'tree', at: { x, z: 37 } })),
  ...[-12, 12].map((x): PropSpec => ({ kind: 'bench', at: { x, z: 38 } })),
  // cafés: chai stalls with benches on both footpaths
  ...[-60, -46, 46, 60].map((x): PropSpec => ({ kind: 'tapri', at: { x, z: 43.4 } })),
  { kind: 'tapri', at: { x: 40, z: 60.6 }, rot: 180 },
  { kind: 'tapri', at: { x: -55, z: 60.6 }, rot: 180 },
  ...[-56.5, -42.5, 49.5, 63.5].map((x): PropSpec => ({ kind: 'bench', at: { x, z: 43.2 } })),
  { kind: 'poster-wall', at: { x: 62, z: 60.8 }, rot: 180 },
  // autos waiting along MI Road
  { kind: 'auto', at: { x: -30, z: 48.6 }, rot: 90 },
  { kind: 'auto', at: { x: -34, z: 48.6 }, rot: 90 },
  { kind: 'auto', at: { x: 22, z: 55.4 }, rot: 270 },
  { kind: 'auto', at: { x: 70, z: 48.6 }, rot: 90 },
  // MI Road's lamps, on its north footpath (never between the camera and the player)
  ...[-92, -66, -30, -18, 18, 30, 66, 92].map((x): PropSpec => ({ kind: 'lamp', at: { x, z: 45.6 } })),
  // the avenue: lamps and benches along it, trees either side
  ...[-6, 10, 26].flatMap((z): PropSpec[] => [
    { kind: 'lamp', at: { x: -4.6, z } },
    { kind: 'lamp', at: { x: 4.6, z } },
  ]),
  ...[2, 18].flatMap((z): PropSpec[] => [
    { kind: 'bench', at: { x: -5.2, z }, rot: 90 },
    { kind: 'bench', at: { x: 5.2, z }, rot: 270 },
  ]),
  ...[-4, 6, 14, 22].flatMap((z): PropSpec[] => [
    { kind: 'tree', at: { x: -9, z } },
    { kind: 'tree', at: { x: 9, z } },
  ]),
  // the lawns
  ...[
    [-26, -70],
    [-14, -62],
    [14, -66],
    [26, -56],
    [-28, -44],
    [28, -40],
    [-28, 8],
    [-20, 24],
    [24, 12],
    [28, 20],
    [-30, -20],
    [30, -14],
  ].map(([x, z]): PropSpec => ({ kind: 'tree', at: { x: x!, z: z! } })),
  // along the side roads and the Raja Park lane
  ...[-60, -20, 20].flatMap((z): PropSpec[] => [
    { kind: 'tree', at: { x: -SIDE + 5, z } },
    { kind: 'tree', at: { x: SIDE - 5, z } },
  ]),
  ...[-70, -30, 30, 70].map((x): PropSpec => ({ kind: 'tree', at: { x, z: LANE[0] - 2 } })),
]

// ---- New Year's string lights -----------------------------------------------------------------

/** How high up the shop fronts the strands are tied: under the two-storey roofs, well over the camera. */
const LIGHTS_Y = 6.3
/** Just off the facades either side of MI Road. */
const LIGHTS_N = NORTH + 0.15
const LIGHTS_S = SOUTH - 0.15
const stringLights: StringLight[] = [
  // across the road, where shops face each other (the garden's apron and the side roads leave gaps)
  ...[-91, -62, -54, -45, 41, 48, 56, 65, 90].map((x): StringLight => ({
    a: { x, z: LIGHTS_N },
    b: { x, z: LIGHTS_S },
    y: LIGHTS_Y,
  })),
  // two swags across the face of Ram Niwas Bagh's gate, just under its parapet: what you see on arriving
  ...[-1, 1].map((s): StringLight => ({
    a: { x: s * 4.7, z: GATE_AT.z + RAM_NIWAS_GATE.d / 2 - 0.15 },
    b: { x: 0, z: GATE_AT.z + RAM_NIWAS_GATE.d / 2 - 0.15 },
    y: 7.2,
  })),
  // swags along the south shop fronts facing the gate, where the metro brings people up
  ...[-11, -3, 5, 13, 21, 29].map((x): StringLight => ({
    a: { x, z: LIGHTS_S },
    b: { x: x + 8, z: LIGHTS_S },
    y: LIGHTS_Y,
  })),
]

// ---- the cast --------------------------------------------------------------------------------

const npcs: NpcDef[] = [
  // the shopkeeper walks MI Road's south footpath, just east of where you come out of the metro
  {
    ...CAST.sunita,
    route: [
      { x: 4, z: 59.6 },
      { x: 28, z: 59.6 },
    ],
    speed: 0.8,
  },
]

const miRoad: DistrictDef = {
  id: 'mi-road',
  name: DISTRICT_NAMES['mi-road'],
  size: SIZE,
  // On MI Road, looking north across the apron to the garden gate, Albert Hall's dome rising behind it.
  spawn: { x: 2, z: 54 },
  station: { x: -20.4, z: 66 },
  centre: { x: 0, z: HALL_AT.z + 18 },
  /** A short stretch of MI Road, out along its carriageway and back. */
  processionRoute: [
    { x: -18, z: 49.5 },
    { x: 17, z: 49.5 },
    { x: 17, z: 54.5 },
    { x: -18, z: 54.5 },
  ],
  /** Where the street dogs, cats and the district's cow live: open ground, clear of every collider. */
  animals: {
    dogs: [
      { x: 0, z: -6 },
      { x: -4, z: 52 },
      { x: 8, z: 52 },
      { x: 2, z: 44 },
      { x: -10, z: -10 },
    ],
    cats: [
      { x: 10, z: -10 },
      { x: -12, z: 0 },
    ],
    cow: { x: 0, z: 4 },
  },
  ground: 'sandstone',
  paving,
  buildings,
  landmarks,
  npcs,
  props,
  /** On MI Road before the garden gate, and where the side roads meet it. */
  signposts: [
    { x: 6, z: 44.5 },
    { x: -74.5, z: 44 },
    { x: 75, z: 44 },
  ],
  stringLights,
  /** A three-storey shop on MI Road just east of the gate's apron, looking over the garden to Albert Hall. */
  roof: roofAt(buildings, { x: 40.5, z: 36.5 }, -1, HALL_AT),
  /** Gali cricket in the Raja Park lane, behind MI Road's shops. */
  cricket: { stumps: { x: 4, z: (LANE[0] + LANE[1]) / 2 }, bowler: { x: 11, z: (LANE[0] + LANE[1]) / 2 } },
  /** A ravanhatta player on the footpath outside Ram Niwas Bagh, east of the gate, facing the road. */
  shows: [{ kind: 'ravanhatta', at: { x: 22, z: 41 } }],
}

export default miRoad
