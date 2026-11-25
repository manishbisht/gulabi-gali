import { CAST } from '../cast'
import { DISTRICT_NAMES } from '../districtNames'
import { buildJkk, JKK } from '../landmarks/jkk'
import { buildUniversityGate, UNIVERSITY_GATE } from '../landmarks/universityGate'
import { roofAt } from '../rooftop'
import type { BuildingSpec, DistrictDef, LandmarkDef, NpcDef, Paving, PropSpec } from '../types'
import { centred, createFill, grow, placed, rect, wall, type Facing } from './layout'

/*
 * University and JKK, 200 × 200 m; x is east and -z is north. JLN Marg runs east–west across the
 * south of the district. North of it, the Rajasthan University gate opens on a green campus of
 * sandstone departments among the trees, and to the east stands Jawahar Kala Kendra behind its
 * forecourt. South of the road is a little town of bookshops, cafés and coaching rooms.
 */

const SIZE = 200
const HALF = SIZE / 2
const INNER = 96
const NORTH = 30 // JLN Marg's north building line (the campus wall)
const SOUTH = 50 // and its south one
const ROAD = [34, 46] as const
const CROSS = 5 // half-width of the street running south from JLN Marg
const LANE = [78, 84] as const
const KERB = 0.25

const GATE_AT = { x: -40, z: 16 }
const JKK_AT = { x: 50, z: -2 }
/** The campus road, from behind the gate up to the library. */
const CAMPUS_ROAD = rect(GATE_AT.x - 4, -72, GATE_AT.x + 4, GATE_AT.z - UNIVERSITY_GATE.d / 2)
/** The paved court in front of JKK, open to JLN Marg. */
const FORECOURT = rect(JKK_AT.x - 20, JKK_AT.z + JKK.d / 2, JKK_AT.x + 20, NORTH)

// ---- landmarks -------------------------------------------------------------------------------

const landmarks: LandmarkDef[] = [
  {
    id: 'university-gate',
    name: { hi: 'Rajasthan University', en: 'University of Rajasthan' },
    story: {
      hi: '1947 mein University of Rajputana ke naam se shuru hui, 1956 mein naam badal ke University of Rajasthan bani. Iska campus JLN Marg pe hai.',
      en: 'It began in 1947 as the University of Rajputana and was renamed the University of Rajasthan in 1956. Its campus is on JLN Marg.',
    },
    at: GATE_AT,
    radius: 11,
    footprint: centred(GATE_AT, UNIVERSITY_GATE),
    build: placed(buildUniversityGate, GATE_AT),
  },
  {
    id: 'jkk',
    name: { hi: 'Jawahar Kala Kendra', en: 'Jawahar Kala Kendra' },
    story: {
      hi: 'Charles Correa ne 1986 mein iska design banaya: nau chaukor, navagraha ke nau grahon jaise, Jaipur ke apne purane naqshe ki tarah. Beech ka chowk khula hai, ek seedhiyon wale kund ke saath.',
      en: "Charles Correa designed it in 1986: nine squares, like the nine planets of the navagraha, after Jaipur's own original plan. The central square is left open, around a stepped kund.",
    },
    at: JKK_AT,
    radius: 22,
    footprint: centred(JKK_AT, JKK),
    build: placed(buildJkk, JKK_AT),
  },
]

// ---- buildings -------------------------------------------------------------------------------

/**
 * The campus, placed by hand: departments either side of the campus road, the library at its head,
 * and a few blocks round JKK. Lawns and trees fill the rest.
 */
const campus: BuildingSpec[] = [
  { x: -62, z: 0, w: 26, d: 14, floors: 3, style: 'haveli', tint: 'sandstone', rot: 270 },
  { x: -60, z: -36, w: 22, d: 14, floors: 2, style: 'modern', tint: 'sandstone', rot: 270 },
  { x: -20, z: -10, w: 22, d: 14, floors: 2, style: 'haveli', tint: 'terracotta', rot: 90 },
  { x: -20, z: -44, w: 20, d: 14, floors: 3, style: 'modern', tint: 'white', rot: 90 },
  { x: -40, z: -82, w: 30, d: 14, floors: 3, style: 'haveli', tint: 'sandstone' },
  { x: -85, z: -60, w: 18, d: 12, floors: 2, style: 'modern', tint: 'sandstone' },
  { x: -85, z: 0, w: 16, d: 12, floors: 2, style: 'haveli', tint: 'sandstone' },
  { x: 84, z: 0, w: 20, d: 12, floors: 2, style: 'modern', tint: 'sandstone', rot: 90 },
  { x: 84, z: -50, w: 20, d: 12, floors: 3, style: 'modern', tint: 'white', rot: 90 },
  { x: 50, z: -64, w: 30, d: 14, floors: 2, style: 'modern', tint: 'sandstone' },
]

/** The metro entrance's forecourt, on JLN Marg's south side. */
const STATION_PLAZA = rect(4, SOUTH, 20, SOUTH + 12)

const KEEP_OUT = [
  rect(-HALF, -HALF, HALF, SOUTH), // campus and JKK: only the hand-placed blocks above
  rect(-CROSS, SOUTH, CROSS, HALF),
  rect(-HALF, LANE[0], HALF, LANE[1]),
  STATION_PLAZA,
]

const { buildings, rand, row } = createFill(1947, rect(-INNER, -INNER, INNER, INNER), KEEP_OUT)

/** The town south of the road: bookshops, cafés and coaching rooms, and the flats above them. */
const town = (w: number, d: number): Omit<BuildingSpec, 'x' | 'z' | 'rot'> => {
  const r = rand()
  const style = r < 0.5 ? 'shop' : r < 0.85 ? 'modern' : 'haveli'
  const floors = (2 + Math.floor(rand() * 2)) as 2 | 3
  const t = rand()
  const tint = t < 0.4 ? 'sandstone' : t < 0.65 ? 'white' : t < 0.85 ? 'ochre' : 'terracotta'
  return { w, d, floors, style, tint }
}
const townRow = (from: number, to: number, front: number, facing: Facing) =>
  row(from, to, front, facing, town, { w: [8, 12], d: [9, 12] })

townRow(-INNER, INNER, SOUTH, 'n')
townRow(-INNER, INNER, LANE[0], 's')
townRow(-INNER, INNER, LANE[1], 'n')
buildings.push(...campus)

// the campus wall along JLN Marg, stepping back round the gate's plaza; walkers' gaps beside the gate
const gap = UNIVERSITY_GATE.w / 2 + 3
const PLAZA = rect(GATE_AT.x - gap - 3, GATE_AT.z - 0.5, GATE_AT.x + gap + 3, NORTH - 1)
buildings.push(
  wall(rect(-INNER, NORTH - 2, PLAZA.minX, NORTH - 1), 1, 'terracotta'),
  wall(rect(PLAZA.maxX, NORTH - 2, 8, NORTH - 1), 1, 'terracotta'),
  wall(rect(PLAZA.minX - 1, PLAZA.minZ, PLAZA.minX, NORTH - 2), 1, 'terracotta'),
  wall(rect(PLAZA.maxX, PLAZA.minZ, PLAZA.maxX + 1, NORTH - 2), 1, 'terracotta'),
  wall(rect(PLAZA.minX, PLAZA.minZ, GATE_AT.x - gap, PLAZA.minZ + 1), 1, 'terracotta'),
  wall(rect(GATE_AT.x + gap, PLAZA.minZ, PLAZA.maxX, PLAZA.minZ + 1), 1, 'terracotta'),
)

// ---- ground ----------------------------------------------------------------------------------

const paving: Paving[] = [
  // the town is paved; the campus is lawn
  { ...rect(-HALF, ROAD[1], HALF, HALF), color: 'sandstone' },
  { ...rect(-HALF, NORTH - 1, HALF, ROAD[0]), color: 'sandstone' },
  { ...rect(-HALF, ROAD[0], HALF, ROAD[1]), color: 'road' },
  { ...rect(-HALF, ROAD[0] - KERB, HALF, ROAD[0]), color: 'white' },
  { ...rect(-HALF, ROAD[1], HALF, ROAD[1] + KERB), color: 'white' },
  { ...rect(-CROSS + 1, ROAD[1], CROSS - 1, HALF), color: 'road' },
  { ...rect(-HALF, LANE[0], HALF, LANE[1]), color: 'road' },
  { ...CAMPUS_ROAD, color: 'road' },
  { ...PLAZA, color: 'sandstone' },
  { ...rect(-50, -75, -30, -72), color: 'sandstone' }, // the library's forecourt
  { ...FORECOURT, color: 'sandstone' },
  { ...grow(STATION_PLAZA, -0.5), color: 'white' },
]

// ---- props -----------------------------------------------------------------------------------

/** Neem trees: a scatter over the campus lawns and a row along JLN Marg's north footpath. */
const trees: [number, number][] = [
  ...[-90, -78, -66, -54, -26, -14, -2, 18, 30, 74, 86].map((x): [number, number] => [x, 32]),
  [-18, 14],
  [-60, 22],
  [-74, 18],
  [-90, 20],
  [-74, -20],
  [-88, -26],
  [-30, -28],
  [-50, -56],
  [-28, -60],
  [-70, -80],
  [-10, -82],
  [-6, -40],
  [-4, 0],
  [8, 14],
  [16, -20],
  [20, -50],
  [10, -84],
  [30, -84],
  [70, -84],
  [26, 6],
  [74, 18],
  [88, 22],
  [70, -28],
  [88, -80],
  [-94, -94],
]

const props: PropSpec[] = [
  // the metro entrance, opening east across its forecourt
  { kind: 'station', at: { x: 8, z: 56 }, rot: 270 },
  { kind: 'tapri', at: { x: 26, z: 48.6 }, rot: 180 },
  { kind: 'tapri', at: { x: -60, z: 48.6 }, rot: 180 },
  { kind: 'poster-wall', at: { x: -20, z: 48.8 }, rot: 180 },
  ...trees.map(([x, z]): PropSpec => ({ kind: 'tree', at: { x, z } })),
  // lamps on the north footpath, between the trees
  ...[-84, -60, -20, 4, 24, 80].map((x): PropSpec => ({ kind: 'lamp', at: { x, z: 33.6 } })),
  ...[-12, -32, -52].map((z): PropSpec => ({ kind: 'lamp', at: { x: GATE_AT.x - 4.6, z } })),
  // benches in JKK's forecourt and on the campus lawns
  { kind: 'bench', at: { x: 36, z: 16 } },
  { kind: 'bench', at: { x: 64, z: 16 } },
  { kind: 'bench', at: { x: -52, z: 4 }, rot: 90 },
  { kind: 'bench', at: { x: -30, z: -66 } },
  { kind: 'auto', at: { x: -10, z: 36.6 }, rot: 90 },
  { kind: 'auto', at: { x: 40, z: 43.4 }, rot: 270 },
  { kind: 'auto', at: { x: 2.4, z: 66 } },
]

// ---- the cast --------------------------------------------------------------------------------

const npcs: NpcDef[] = [
  // the RAS aspirant paces the campus road with her notes
  {
    ...CAST.kavya,
    route: [
      { x: GATE_AT.x + 1, z: 8 },
      { x: GATE_AT.x + 1, z: -20 },
    ],
    speed: 0.7,
  },
  // the first-year finds his way across the lawn
  {
    ...CAST.aarav,
    route: [
      { x: -32, z: 10 },
      { x: -32, z: -24 },
      { x: -36.5, z: -24 },
    ],
    speed: 1,
  },
  // the poet waits for Thursday in JKK's forecourt
  {
    ...CAST.meera,
    route: [
      { x: 40, z: 22 },
      { x: 60, z: 22 },
    ],
    speed: 0.6,
  },
]

const university: DistrictDef = {
  id: 'university',
  name: DISTRICT_NAMES.university,
  size: SIZE,
  // On JLN Marg, looking north across the plaza at the university gate; JKK is off to the right.
  spawn: { x: -40, z: 42 },
  station: { x: 11.6, z: 56 },
  centre: { x: JKK_AT.x, z: 22 },
  /** A short stretch of JLN Marg, out along its carriageway and back. */
  processionRoute: [
    { x: -5, z: 37.5 },
    { x: 34, z: 37.5 },
    { x: 34, z: 42.5 },
    { x: -5, z: 42.5 },
  ],
  /** Where the street dogs, cats and the district's cow live: open ground, clear of every collider. */
  animals: {
    dogs: [
      { x: 50, z: 22 },
      { x: -46, z: 40 },
      { x: -34, z: 40 },
    ],
    cats: [
      { x: 40, z: 22 },
      { x: 50, z: 32 },
      { x: 60, z: 22 },
    ],
    cow: { x: -40, z: 32 },
  },
  ground: 'grass',
  paving,
  buildings,
  landmarks,
  npcs,
  props,
  /** Where the cross street meets JLN Marg, before the university's plaza, and before JKK's forecourt. */
  signposts: [
    { x: -6, z: 48 },
    { x: -31, z: 32.5 },
    { x: 27, z: 32.6 },
  ],
  /** The department beside the gate: its roof looks across the campus to JKK. */
  roof: roofAt(buildings, { x: -62, z: 0 }, -1, JKK_AT),
  /** The evening's kalbelia-style dancers, on the open ground at the west end of the arts centre's forecourt. */
  shows: [{ kind: 'dancers', at: { x: 22, z: 22 } }],
}

export default university
