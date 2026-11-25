import * as THREE from 'three'
import { footprint } from '../world/kit'
import { bakeHex, box, cylinder, FLOOR_H, merge } from '../world/kit/parts'
import { PALETTE } from '../world/palette'
import { inside } from '../world/rooftop'
import type { BuildingSpec, BuildingStyle, DistrictDef } from '../world/types'
import { dressOnly } from './procession'

/*
 * Makar Sankranti's sky: kites over every district, a few of them cut loose and drifting down, and on a few
 * roofs near the rooftop viewpoint people flying their own, a string from the hand up to the kite. Three draw
 * calls in all: every kite (the sky's and the flyers') is one instanced mesh, every string one set of line
 * segments, and the flyers one instanced figure. Only while the sun is up (see `set`). The kites move in steps
 * of at most 30 a second, into buffers made once; under `prefers-reduced-motion` they hold still where they are.
 */

type Tier = 0 | 1 | 2

/** Kites in the sky per quality tier (index 0 is the lowest); the flyers' own are extra. */
export const SKY_KITES: readonly [number, number, number] = [20, 60, 120]
/** People flying a kite from a roof, per quality tier. */
export const FLYERS: readonly [number, number, number] = [2, 3, 4]
/** One sky kite in this many is a cut one, drifting down (the last of each run of `CUT_EVERY`). */
const CUT_EVERY = 8

export const skyKiteCount = (quality: Tier): number => SKY_KITES[quality]
export const flyerCount = (quality: Tier): number => FLYERS[quality]
/** How many of the first `n` sky kites are cut ones. */
export const cutKiteCount = (n: number): number => Math.floor(n / CUT_EVERY)
const isCut = (i: number) => i % CUT_EVERY === CUT_EVERY - 1

export const KITE_COLOURS = [
  PALETTE.pink,
  PALETTE.marigold,
  PALETTE.teal,
  PALETTE.terracotta,
  PALETTE.white,
  '#D6336C',
]

/** A flat diamond with a short ragged tail, in the XY plane, facing +z. */
export function kiteGeometry() {
  const g = new THREE.BufferGeometry()
  // diamond, then a thin tail quad hanging below it
  const v = [
    0, 0.8, 0, -0.55, 0.1, 0, 0, -0.9, 0, 0.55, 0.1, 0, -0.06, -0.9, 0, 0.06, -0.9, 0, 0.06, -2.4, 0, -0.06,
    -2.4, 0,
  ]
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  g.setIndex([0, 1, 3, 1, 2, 3, 4, 7, 6, 4, 6, 5])
  return g
}

const KITE_LOW = 25
const KITE_HIGH = 60
const KITE_SCALE = 2.2
/** The wind blows toward +x: the sky's kites drift that way, and every flyer's kite stands off downwind. */
const KITE_WIND = 1.8
/** Where a sky kite's string runs down to: about a rooftop, upwind and a little aside. */
const STRING_ANCHOR = 12
/** A cut kite sinks this fast (m/s), drifts this much faster than the wind, and is gone below this height. */
const CUT_FALL = 1.6
const CUT_DRIFT = 1.5
const CUT_FLOOR = 14
/** A cut kite's loose string trails this far below it. */
const CUT_TRAIL = 5
/** The kites move in steps of at least this long: about 30 a second, never every frame of a fast screen. */
const STEP = 1 / 30
/** A stalled frame (a tab coming back) moves them no further than this. */
const MAX_STEP = 0.25

// ---- the flyers ---------------------------------------------------------------------------------

/** How far above the top floor a roof's surface is, by style: the roofs a person can stand on. */
const ROOF_TOP: Partial<Record<BuildingStyle, number>> = { haveli: 0, shop: 0.45, modern: 0.3 }
/** The smallest roof a flyer stands on, the least distance between two flyers' buildings. */
const MIN_ROOF = 4
const MIN_APART = 8
/** A flyer's kite stands this far downwind of the hand, this high above it, and this far aside. */
const FLYER_OUT = 15
const FLYER_RISE = 15
const FLYER_ASIDE = 4
/** The raised arm: its shoulder on the figure (which faces +z before it is turned), its length and tilt forward. */
const SHOULDER = { x: 0.2, y: 1.38, z: 0.05 }
const ARM = 0.5
const RAISE = 0.75
/** The raised hand, which holds the string. */
const HAND = {
  x: SHOULDER.x,
  y: SHOULDER.y + ARM * Math.cos(RAISE),
  z: SHOULDER.z + ARM * Math.sin(RAISE),
}
/** Each flyer's kurta, so no two neighbours match. */
const KURTA = ['#E0408A', '#F2A81D', '#2F9FB0', '#8E4FC9']

/** One person flying a kite from a roof: where they stand, which way they face, and where their hand is. */
export interface KiteFlyer {
  x: number
  y: number
  z: number
  /** Turned this far about y (radians): they face downwind, toward their kite. */
  ry: number
  hand: { x: number; y: number; z: number }
  /** Where their kite flies when the wind is still. */
  kite: { x: number; y: number; z: number }
}

/**
 * Up to `limit` people flying kites from roofs: the flat roofs (haveli, shop, modern) nearest the rooftop
 * viewpoint (the spawn, where a district has none), so they are in view from up there, never on the viewpoint's
 * own building, and at least `MIN_APART` from each other. They stand back from the front of the roof, clear of
 * a haveli's corner chhatris, and on nothing anyone walks: roofs are out of reach but for the viewpoint's strip.
 */
export function kiteFlyerSpots(def: DistrictDef, limit = FLYERS[2]): KiteFlyer[] {
  const from = def.roof?.landing ?? def.spawn
  const candidates = def.buildings
    .filter((b) => ROOF_TOP[b.style] !== undefined && Math.min(b.w, b.d) >= MIN_ROOF)
    .filter((b) => !def.roof || !inside(def.roof.landing, footprint(b)))
    .map((b) => ({ b, d: Math.hypot(b.x - from.x, b.z - from.z) }))
    .sort((p, q) => p.d - q.d)
  const chosen: BuildingSpec[] = []
  for (const { b } of candidates) {
    if (chosen.length >= limit) break
    if (chosen.some((c) => Math.hypot(c.x - b.x, c.z - b.z) < MIN_APART)) continue
    chosen.push(b)
  }
  const ry = Math.PI / 2 // the figure's front (+z) turned to face +x, downwind
  return chosen.map((b, i) => {
    // back from the front edge, a little off the middle: the kit turns a building by -rot about y
    const t = THREE.MathUtils.degToRad(b.rot ?? 0)
    const lx = (i % 2 === 0 ? 1 : -1) * b.w * 0.15
    const lz = -b.d * 0.2
    const x = b.x + lx * Math.cos(t) - lz * Math.sin(t)
    const z = b.z + lx * Math.sin(t) + lz * Math.cos(t)
    const y = b.floors * FLOOR_H + ROOF_TOP[b.style]!
    const hand = {
      x: x + HAND.x * Math.cos(ry) + HAND.z * Math.sin(ry),
      y: y + HAND.y,
      z: z - HAND.x * Math.sin(ry) + HAND.z * Math.cos(ry),
    }
    const aside = (i % 2 === 0 ? -1 : 1) * FLYER_ASIDE
    return { x, y, z, ry, hand, kite: { x: hand.x + FLYER_OUT, y: hand.y + FLYER_RISE, z: hand.z + aside } }
  })
}

const SKIN = '#B9825A'

/** Someone flying a kite: one hand up holding the string, a charkhi (the spool) in the other. Faces +z. */
export function flyerGeometry() {
  const arm = (x: number, y: number, z: number, tilt: number) => {
    const g = new THREE.BoxGeometry(0.07, ARM, 0.07)
    g.translate(0, ARM / 2, 0)
    g.rotateX(tilt)
    g.translate(x, y, z)
    return bakeHex(g, '#ffffff')
  }
  const head = new THREE.SphereGeometry(0.11, 6, 4)
  head.translate(0, 1.58, 0)
  const spool = new THREE.CylinderGeometry(0.08, 0.08, 0.14, 6, 1)
  spool.rotateZ(Math.PI / 2)
  spool.translate(-0.25, 1.0, 0.3)
  return merge([
    box(0.11, 0.8, 0.14, -0.09, 0, 0, 'white'), // legs, in off-white: only pure white takes the kurta's colour
    box(0.11, 0.8, 0.14, 0.09, 0, 0, 'white'),
    bakeHex(new THREE.CylinderGeometry(0.18, 0.21, 0.66, 6, 1).translate(0, 1.13, 0), '#ffffff'), // kurta
    arm(SHOULDER.x, SHOULDER.y, SHOULDER.z, RAISE), // raised toward the kite
    arm(-SHOULDER.x - 0.05, SHOULDER.y, SHOULDER.z, 2.6), // down and forward, to the charkhi
    bakeHex(head, SKIN),
    cylinder(0.12, 0.13, 0.1, 6, 0, 1.64, 0, 'terracotta'), // a cap of hair, or a safa's band
    bakeHex(spool, '#E0A526'),
  ])
}

// ---- the sky ------------------------------------------------------------------------------------

export interface KiteSky {
  group: THREE.Group
  /** Shows the kites (Sankranti, the sun up) at a tier's counts, or puts them away. */
  set(on: boolean, quality: Tier): void
  update(dt: number): void
  /** What is up now: kites in the sky (the cut ones among them), and people flying from the roofs. */
  counts(): { sky: number; falling: number; flyers: number }
  dispose(): void
}

const rand = (n: number) => Math.random() * n

export function createKiteSky(def: DistrictDef, still: () => boolean): KiteSky {
  const half = def.size / 2
  const spots = kiteFlyerSpots(def)
  const maxSky = SKY_KITES[2]
  const total = maxSky + spots.length
  const group = new THREE.Group()
  group.name = 'sankranti'

  const kiteGeo = kiteGeometry()
  const kiteMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, color: '#ffffff' })
  const kites = new THREE.InstancedMesh(kiteGeo, kiteMaterial, total)
  kites.frustumCulled = false
  kites.visible = false
  kites.name = 'kites'
  const colour = new THREE.Color()
  for (let i = 0; i < total; i++) kites.setColorAt(i, colour.set(KITE_COLOURS[i % KITE_COLOURS.length]!))

  const stringPos = new Float32Array(total * 6)
  const stringGeometry = new THREE.BufferGeometry()
  stringGeometry.setAttribute('position', new THREE.BufferAttribute(stringPos, 3))
  const stringMaterial = new THREE.LineBasicMaterial({
    color: '#F6EFE4',
    transparent: true,
    opacity: 0.45,
    fog: false,
  })
  const strings = new THREE.LineSegments(stringGeometry, stringMaterial)
  strings.frustumCulled = false
  strings.visible = false
  strings.name = 'kite-strings'

  const flyerGeo = flyerGeometry()
  const flyerMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  flyerMaterial.onBeforeCompile = dressOnly
  const flyers = new THREE.InstancedMesh(flyerGeo, flyerMaterial, Math.max(spots.length, 1))
  flyers.frustumCulled = false
  flyers.visible = false
  flyers.name = 'kite-flyers'
  flyers.count = 0

  // preallocated for every step: nothing below allocates once the sky is made
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()

  spots.forEach((f, i) => {
    p.set(f.x, f.y, f.z)
    q.setFromEuler(e.set(0, f.ry, 0))
    s.setScalar(1)
    flyers.setMatrixAt(i, m.compose(p, q, s))
    flyers.setColorAt(i, colour.set(KURTA[i % KURTA.length]!))
  })
  flyers.instanceMatrix.needsUpdate = true
  group.add(kites, strings, flyers)

  const kx = new Float32Array(maxSky)
  const ky = new Float32Array(maxSky)
  const kz = new Float32Array(maxSky)
  const kphase = new Float32Array(total)
  const respawnCut = (i: number) => {
    kx[i] = rand(half * 2) - half
    kz[i] = rand(half * 2) - half
    ky[i] = KITE_HIGH + rand(10)
  }
  for (let i = 0; i < maxSky; i++) {
    kx[i] = rand(half * 2) - half
    kz[i] = rand(half * 2) - half
    ky[i] = KITE_LOW + rand(KITE_HIGH - KITE_LOW)
  }
  for (let i = 0; i < total; i++) kphase[i] = rand(Math.PI * 2)

  let on = false
  let sky = 0
  let flying = 0
  let time = 0
  let since = 0
  /** The matrices match the kites' state: set false whenever something shown changes. */
  let posed = false

  const string = (i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const o = i * 6
    stringPos[o] = ax
    stringPos[o + 1] = ay
    stringPos[o + 2] = az
    stringPos[o + 3] = bx
    stringPos[o + 4] = by
    stringPos[o + 5] = bz
  }

  /** Moves the sky's kites on by `dt`: the flying ones drift with the wind, the cut ones sink and drift faster. */
  const advance = (dt: number) => {
    for (let i = 0; i < sky; i++) {
      if (isCut(i)) {
        ky[i] = ky[i]! - CUT_FALL * dt
        kx[i] = kx[i]! + KITE_WIND * CUT_DRIFT * dt
        if (ky[i]! < CUT_FLOOR) respawnCut(i)
      } else kx[i] = kx[i]! + KITE_WIND * dt
      if (kx[i]! > half) kx[i] = kx[i]! - half * 2
    }
  }

  /** Writes every shown kite's matrix and string for the moment `time`. */
  const pose = () => {
    for (let i = 0; i < sky; i++) {
      const ph = kphase[i]!
      const sway = Math.sin(time * 0.9 + ph)
      const x = kx[i]! + sway * 0.8
      const z = kz[i]!
      if (isCut(i)) {
        // loose: it tumbles as it sinks, its string trailing under it
        const y = ky[i]!
        p.set(x, y, z)
        e.set(0.35 + Math.sin(time * 1.7 + ph) * 0.6, time * 0.8 + ph, Math.sin(time * 1.3 + ph) * 1.1)
        string(i, x, y - 0.5, z, x - sway * 0.6, y - CUT_TRAIL, z + 0.5)
      } else {
        const y = ky[i]! + sway * 1.2
        p.set(x, y, z)
        e.set(0.35, Math.sin(time * 0.5 + ph) * 0.5, sway * 0.25)
        string(i, x, y - 0.5, z, kx[i]! - 14, STRING_ANCHOR, z + 4)
      }
      q.setFromEuler(e)
      s.setScalar(KITE_SCALE)
      kites.setMatrixAt(i, m.compose(p, q, s))
    }
    for (let j = 0; j < flying; j++) {
      const f = spots[j]!
      const slot = sky + j
      const ph = kphase[maxSky + j]!
      const sway = Math.sin(time * 1.1 + ph)
      const x = f.kite.x + sway * 0.9
      const y = f.kite.y + Math.sin(time * 0.7 + ph) * 0.8
      const z = f.kite.z + Math.cos(time * 0.9 + ph) * 0.6
      p.set(x, y, z)
      // square on to its flyer, nodding in the wind
      e.set(0.3, -Math.PI / 2, sway * 0.3)
      q.setFromEuler(e)
      s.setScalar(KITE_SCALE * 0.8)
      kites.setMatrixAt(slot, m.compose(p, q, s))
      string(slot, x, y - 0.4, z, f.hand.x, f.hand.y, f.hand.z)
    }
    kites.instanceMatrix.needsUpdate = true
    if (strings.visible) stringGeometry.attributes.position!.needsUpdate = true
    posed = true
  }

  return {
    group,
    set(next, quality) {
      on = next
      kites.visible = next
      flyers.visible = next
      strings.visible = next && quality > 0
      sky = next ? SKY_KITES[quality] : 0
      flying = next ? Math.min(FLYERS[quality], spots.length) : 0
      kites.count = sky + flying
      flyers.count = flying
      stringGeometry.setDrawRange(0, (sky + flying) * 2)
      posed = false
      if (next) pose()
    },
    update(dt) {
      if (!on) return
      // reduced motion: they hold where they are (posed once, if a change asked for it)
      if (still()) {
        since = 0
        if (!posed) pose()
        return
      }
      since += dt
      if (since < STEP) return
      const step = Math.min(since, MAX_STEP)
      since = 0
      time += step
      advance(step)
      pose()
    },
    counts: () => ({ sky, falling: cutKiteCount(sky), flyers: flying }),
    dispose() {
      group.removeFromParent()
      kites.dispose()
      flyers.dispose()
      kiteGeo.dispose()
      kiteMaterial.dispose()
      stringGeometry.dispose()
      stringMaterial.dispose()
      flyerGeo.dispose()
      flyerMaterial.dispose()
    },
  }
}
