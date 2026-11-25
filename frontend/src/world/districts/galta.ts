import * as THREE from 'three'
import { t } from '../../i18n/strings'
import { CAST } from '../cast'
import { DISTRICT_NAMES } from '../districtNames'
import { buildCityBelow } from '../landmarks/cityBelow'
import { buildGorge } from '../landmarks/galtaGorge'
import { buildGaltaJi, GALTA_JI } from '../landmarks/galtaJi'
import { roofAt, upTheStair } from '../rooftop'
import type { BuildingSpec, DistrictDef, LandmarkDef, NpcDef, Paving, PropSpec } from '../types'
import { centred, createFill, grow, rect, type Facing } from './layout'

/*
 * Galta Ji, 200 × 200 m; x is east and -z is north. A narrow gorge in the Aravallis east of the city runs north
 * between rocky slopes. The bus stops at its mouth in the south; from there a stone-paved path goes up the gorge
 * along its east side, past the temples and havelis stacked along both slopes, beside a series of stepped kunds
 * (rectangular tanks with ghats round them) one above the next: the lowest near the mouth, the main one across the
 * path from the main temple, the upper one toward the gorge's head. Between the main and the upper kund a way
 * crosses west and climbs out of the gorge to the ridge top, where the Surya Mandir stands by a terrace looking
 * west over the whole city below; the roof beside it is the viewpoint (the existing rooftop viewpoint, facing
 * west). No metro comes out here: the bus stops at the mouth.
 *
 * A living pilgrimage place: nobody is drawn in the water, and no ritual is shown. The people here are visitors,
 * a garland seller, a chai seller and a guide; the monkeys sit about, and the Walled City's bandar lives here too.
 */

const SIZE = 200
const HALF = SIZE / 2
const INNER = 96
const KERB = 0.25

/** The gorge's floor, from its head in the north to its mouth in the south. */
const GORGE = rect(-34, -88, 34, HALF)
/** The way up out of the gorge to the ridge top, and the terrace up there by the Surya Mandir. */
const CLIMB = rect(-56, -36, -34, -26)
const TERRACE = rect(-HALF, -57, -56, -5)
/** The rock either side and at the head: colliders, drawn as the slopes (see galtaGorge.ts). */
const ROCKS = [
  rect(34, -HALF, HALF, HALF), // the east slope
  rect(-34, -HALF, 34, GORGE.minZ), // the gorge's head
  rect(-HALF, -HALF, -34, TERRACE.minZ), // the west slope, north of the terrace
  rect(TERRACE.maxX, TERRACE.minZ, -34, CLIMB.minZ), // between the terrace and the gorge, north of the climb
  rect(TERRACE.maxX, CLIMB.maxZ, -34, TERRACE.maxZ), // and south of it
  rect(-HALF, TERRACE.maxZ, -34, HALF), // the west slope, south of the terrace
]
/**
 * Drawn only: the slopes run on past the district's south wall, either side of the road out, so the gorge does not
 * end in a cut. The road out between them is open ground for the slopes' foot.
 */
const ROCKS_BEYOND = [rect(34, HALF, 140, 140), rect(-HALF, HALF, -34, 140)]
const OUT = rect(-34, HALF, 34, 140)

/** The kunds, one above the next up the gorge: water nobody walks into, with ghats round them. */
const KUND_LOW = rect(-18, 34, -2, 50)
const KUND_MAIN = rect(-20, -14, 0, 14)
const KUND_UP = rect(-18, -62, -2, -44)
const KUNDS = [KUND_LOW, KUND_MAIN, KUND_UP]
/** The ghats round each kund: this wide, paved, walked round. */
const GHAT = 2.5

/** The stone path up the gorge, along its east side; the way across to the climb. */
const PATH = rect(6, -72, 17, 64)
const CROSS = rect(-34, CLIMB.minZ, PATH.minX, CLIMB.maxZ)
/** The road in, at the gorge's mouth; the bus stand's forecourt on its east side. */
const ROAD = rect(5, 64, 18, HALF)
const STATION_PLAZA = rect(ROAD.maxX, 72, 28, 88)

/** The main temple, on the path's east side, facing west across it at the main kund. */
const TEMPLE_AT = { x: 26.5, z: 0 }
/** Turned to face west: its width runs north–south. */
const TEMPLE = centred(TEMPLE_AT, { w: GALTA_JI.d, d: GALTA_JI.w })

// ---- landmarks -------------------------------------------------------------------------------

const landmarks: LandmarkDef[] = [
  {
    id: 'galta-ji',
    name: { hi: 'Galta Ji', en: 'Galta Ji' },
    story: {
      hi: 'Aravalli ki ghaati mein sadiyon purana teerth: jharne ka paani ek ke baad ek kund bharta hai. Kehte hain yahan Galav rishi ne tap kiya tha. Aaj bhi pooja ki jagah hai; izzat se ghoomo.',
      en: 'An old pilgrimage place in an Aravalli gorge: a spring fills one kund after another. It is said the sage Galav meditated here. Still a place of worship; go gently.',
    },
    // on the path before the temple's steps, the main kund at your back
    at: { x: 14.5, z: 0 },
    radius: 9,
    footprint: TEMPLE,
    build: async () => {
      const g = buildGaltaJi()
      g.position.set(TEMPLE_AT.x, 0, TEMPLE_AT.z)
      g.rotation.y = -Math.PI / 2 // its front (+z) to the west, at the path and the kund
      return g
    },
  },
]

// ---- buildings -------------------------------------------------------------------------------

/** On the ridge top, the roof beside the Surya Mandir, its front to the west: the viewpoint (see `roof`). */
const VIEW_HOUSE: BuildingSpec = {
  x: -82,
  z: -31,
  w: 10,
  d: 9,
  floors: 3,
  style: 'haveli',
  tint: 'pink',
  rot: 90,
}
/** The Surya Mandir itself, its shikhara on the ridge, facing west over the city. */
const SURYA_MANDIR: BuildingSpec = {
  x: -82,
  z: -48,
  w: 8,
  d: 8,
  floors: 2,
  style: 'temple',
  tint: 'pink',
  rot: 90,
}
/** At the gorge's head, past the upper kund: a small temple closing the view up the path. */
const HEAD_TEMPLE: BuildingSpec = { x: -6, z: -79, w: 12, d: 9, floors: 2, style: 'temple', tint: 'pink' }

const KEEP_OUT = [
  grow(TEMPLE, 2),
  ...KUNDS.map((k) => grow(k, GHAT + 1)),
  grow(PATH, 1),
  grow(CROSS, 1),
  rect(ROAD.minX - 1, ROAD.minZ, ROAD.maxX + 1, HALF),
  STATION_PLAZA,
  // the forecourt at the mouth, open ground
  rect(-24, 64, ROAD.minX, HALF),
]

const { buildings, rand, row } = createFill(1750, rect(-INNER, -INNER, INNER, INNER), KEEP_OUT)
buildings.push(VIEW_HOUSE, SURYA_MANDIR, HEAD_TEMPLE)

/** Along the gorge: havelis and temples in pink sandstone, some ochre or lime-white; now and then a shikhara. */
const shrine = (w: number, d: number): Omit<BuildingSpec, 'x' | 'z' | 'rot'> => {
  const r = rand()
  const t = rand()
  const tint = t < 0.6 ? 'pink' : t < 0.85 ? 'ochre' : 'white'
  if (r < 0.25 && w >= 8) return { w, d, floors: 2, style: 'temple', tint }
  return { w, d, floors: (2 + Math.floor(rand() * 2)) as 2 | 3, style: 'haveli', tint }
}
/** At the mouth: a few low shops, flowers and chai and offerings. */
const stall = (w: number, d: number): Omit<BuildingSpec, 'x' | 'z' | 'rot'> => {
  const t = rand()
  return { w, d, floors: 1, style: 'shop', tint: t < 0.5 ? 'sandstone' : t < 0.8 ? 'pink' : 'ochre' }
}
const gorgeRow = (from: number, to: number, front: number, facing: Facing) =>
  row(from, to, front, facing, shrine, { w: [7, 11], d: [7, 9] })

// both slopes of the gorge, facing in across it
gorgeRow(-86, 62, -25, 'e')
gorgeRow(-86, 62, 25, 'w')
// the shops at the mouth, facing the forecourt
row(66, INNER, -25, 'e', stall, { w: [6, 8], d: [6, 8] })

// ---- ground ----------------------------------------------------------------------------------

/** A few steps, drawn across the climb out of the gorge. */
const STEPS: Paving[] = Array.from({ length: 6 }, (_, i) => {
  const x = CLIMB.minX + 2 + i * 3.5
  return { ...rect(x, CLIMB.minZ, x + 0.5, CLIMB.maxZ), color: 'white' }
})

const paving: Paving[] = [
  // the slopes, for the map: the hillside's scrub green (drawn over by the rock in the street)
  ...ROCKS.map((r): Paving => ({ ...r, color: 'grass' })),
  { ...ROAD, color: 'road' },
  { ...rect(ROAD.minX - KERB, ROAD.minZ, ROAD.minX, HALF), color: 'white' },
  { ...rect(ROAD.maxX, ROAD.minZ, ROAD.maxX + KERB, HALF), color: 'white' },
  // the stone path, the way across and the climb, and the terrace on the ridge top
  { ...PATH, color: 'white' },
  { ...rect(PATH.maxX, TEMPLE.minZ, TEMPLE.minX, TEMPLE.maxZ), color: 'white' },
  { ...CROSS, color: 'white' },
  { ...CLIMB, color: 'sandstone' },
  ...STEPS,
  { ...rect(-97, TERRACE.minZ, TERRACE.maxX, TERRACE.maxZ), color: 'white' },
  { ...rect(-95, -34, -87, -28), color: 'sandstone' },
  // each kund: its ghat's edge, the ghat, and the water
  ...KUNDS.flatMap((k): Paving[] => [
    { ...grow(k, GHAT + 0.5), color: 'sandstone' },
    { ...grow(k, GHAT), color: 'white' },
    { ...k, color: 'glass' },
  ]),
  {
    ...rect(STATION_PLAZA.minX, STATION_PLAZA.minZ + 0.5, STATION_PLAZA.maxX - 0.5, STATION_PLAZA.maxZ - 0.5),
    color: 'white',
  },
]

// ---- props -----------------------------------------------------------------------------------

const props: PropSpec[] = [
  // the bus stand at the mouth, facing the road (there is no metro out here)
  { kind: 'bus-stop', at: { x: 25.5, z: 80 }, rot: 90 },
  // chai: at the mouth, by the path below the temple, and up on the ridge
  { kind: 'tapri', at: { x: -20, z: 84 }, rot: 270 },
  { kind: 'tapri', at: { x: 21, z: 30 }, rot: 90 },
  { kind: 'tapri', at: { x: -66, z: -53 } },
  // benches: between the main and the lowest kund, looking at each; on the ridge top, looking west; at the mouth
  { kind: 'bench', at: { x: -10, z: 19.5 }, rot: 180 },
  { kind: 'bench', at: { x: -10, z: 28.5 } },
  ...[-43, -19].map((z): PropSpec => ({ kind: 'bench', at: { x: -93, z }, rot: 90 })),
  { kind: 'bench', at: { x: -12, z: 94 }, rot: 180 },
  // the poster wall at the mouth, by the road out, facing the forecourt
  { kind: 'poster-wall', at: { x: -4, z: 97.5 }, rot: 180 },
  // trees: at the mouth, and here and there up the gorge
  ...[
    [-18, 70],
    [-2, 74],
    [-20, 96],
    [22, 46],
    [22, -40],
    [22, -64],
    [-22, -70],
    [-70, -9],
  ].map(([x, z]): PropSpec => ({ kind: 'tree', at: { x: x!, z: z! } })),
  // lamps along the path, and on the terrace
  ...[-56, -30, 40, 56].map((z): PropSpec => ({ kind: 'lamp', at: { x: 18.6, z } })),
  ...[-51, -11].map((z): PropSpec => ({ kind: 'lamp', at: { x: -60, z } })),
  // autos waiting on the road by the bus stand
  { kind: 'auto', at: { x: 15.6, z: 84 } },
  { kind: 'auto', at: { x: 15.6, z: 90 } },
]

// ---- the cast --------------------------------------------------------------------------------

const npcs: NpcDef[] = [
  // the garland seller where the path leaves the mouth
  {
    ...CAST.kamla,
    route: [
      { x: 8, z: 57 },
      { x: 14, z: 57 },
    ],
    speed: 0.5,
  },
  // the chai seller steps out from his stall by the path
  {
    ...CAST.sohan,
    route: [
      { x: 18.4, z: 26 },
      { x: 18.4, z: 34 },
    ],
    speed: 0.6,
  },
  // the guide walks the path up the gorge and back
  {
    ...CAST.lakshmi,
    route: [
      { x: 10, z: 50 },
      { x: 10, z: -50 },
    ],
    speed: 0.9,
  },
]

/** The slopes, the kunds' steps and pavilions, the monkeys; and the city below the ridge, to the west. */
function scenery(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'galta-scenery'
  const ring = (k: (typeof KUNDS)[number], y: number) => [
    { x: k.minX + 0.6, y, z: k.minZ + 3, ry: Math.PI / 2 },
    { x: k.maxX - 0.6, y, z: k.maxZ - 4, ry: -Math.PI / 2 },
  ]
  group.add(
    buildGorge({
      rocks: [...ROCKS, ...ROCKS_BEYOND],
      open: [{ ...GORGE, maxZ: OUT.minZ }, OUT, CLIMB, TERRACE],
      westEdge: -HALF,
      kunds: KUNDS,
      // two pavilions standing in the main kund's far corners
      pavilions: [
        { x: KUND_MAIN.minX + 3.4, z: KUND_MAIN.minZ + 3.4 },
        { x: KUND_MAIN.minX + 3.4, z: KUND_MAIN.maxZ - 3.4 },
      ],
      // monkeys sitting on the kunds' top steps, looking at the water
      monkeys: [...ring(KUND_LOW, 0.36), ...ring(KUND_MAIN, 0.36), ...ring(KUND_UP, 0.36)],
    }),
  )
  group.add(buildCityBelow(-HALF, HALF))
  return group
}

const galta: DistrictDef = {
  id: 'galta',
  name: DISTRICT_NAMES.galta,
  size: SIZE,
  // Off the bus at the mouth, on the road, looking north up the gorge.
  spawn: { x: 11.5, z: 66 },
  station: { x: 22.5, z: 80 },
  centre: { x: -10, z: 82 },
  /** The road at the mouth, out and back. */
  processionRoute: [
    { x: 8, z: 94 },
    { x: 8, z: 70 },
    { x: 11, z: 70 },
    { x: 11, z: 94 },
  ],
  /** Where the street dogs, cats and the district's cow live: open ground, clear of every collider. */
  animals: {
    dogs: [
      { x: -12, z: 74 },
      { x: 12, z: 40 },
      { x: -20, z: -31 },
      { x: 10, z: -60 },
    ],
    cats: [
      { x: -70, z: -40 },
      { x: 3, z: 22 },
    ],
    cow: { x: -6, z: 86 },
  },
  ground: 'sandstone',
  paving,
  buildings,
  landmarks,
  npcs,
  props,
  /** Where the path leaves the mouth, where the way crosses to the climb, and at the climb's top on the ridge. */
  signposts: [
    { x: 3, z: 61 },
    { x: 3.5, z: -23 },
    { x: -59, z: -23 },
  ],
  /**
   * The roof beside the Surya Mandir, on the ridge top: it looks west, out over the city below. At the stair's foot
   * the player faces up the stair (see RoofDef.foot and `upTheStair`).
   */
  roof: upTheStair(roofAt(buildings, VIEW_HOUSE, 1)),
  roofName: { hi: t('suryaMandir', 'hi'), en: t('suryaMandir', 'en') },
  water: KUNDS,
  rocks: ROCKS,
  ridgeWest: -HALF,
  scenery,
}

export default galta
