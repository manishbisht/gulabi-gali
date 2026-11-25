import * as THREE from 'three'
import { playTouch, type TouchSound } from '../audio/touch'
import type { QualityTier } from '../engine/stage'
import { seeded } from './districts/layout'
import { bakeHex, box, cylinder, merge } from './kit/parts'
import { touched } from './touched'
import type { DistrictDef, TouchableSpec, Vec2 } from './types'

/*
 * Things on the street that answer a touch, from each district's `touchables`: a temple bell on a small frame,
 * a hand pump, a flock of pigeons on an open square, a stand of diyas. Local to this page and never sent to
 * anyone, like the street animals. No score, no counter: each answers with a short movement and a sound.
 *
 * - The bell: "Ghanti bajao" rings it once, softly, and it swings and settles. One ring every `BELL_GAP_S` at
 *   most, however hard the button is pressed; a press in between does nothing.
 * - The pump: "Paani chalao" works the handle three strokes and water runs for a moment (no water at tier 0).
 * - The pigeons have no button: walk within `STARTLE_RANGE` and they lift, wheel once round the square and
 *   settle where they were. They do not go up again until the player has stepped away. Under
 *   `prefers-reduced-motion` they hop aside instead and come back once the player has gone.
 * - The diyas: "Diya jalao" lights the next one, only between sunset and sunrise (`night`, from the live sky).
 *   Lit ones stay lit for this visit (`TouchMemory`, in memory only: a reload starts dark again).
 *
 * Drawing: one merged mesh for everything that stands still, and one InstancedMesh each for the bells, the
 * pump handles, the water, the flames, and the pigeons' bodies and wings: seven draw calls at most, and only
 * for the kinds the district has. A frame allocates nothing.
 *
 * Priority of E (see `createInteraction`): ... > character or person card > a touchable > animal.
 */

export type TouchableKind = TouchableSpec['kind']
/** The kinds with a prompt (the pigeons answer to being walked into). */
export type TouchKind = Exclude<TouchableKind, 'pigeons'>
export interface TouchableInfo {
  id: string
  kind: TouchKind
}
/** What the touchables tell React; called only when the news changes. */
export interface TouchableHooks {
  /** The thing in reach that can be touched now (a diya stand only after sunset, with one still dark), or null. */
  near(t: TouchableInfo | null): void
}

/** The prompt shows, and E touches, within this many metres. */
export const TOUCH_RANGE = 2.5
/** One ring of a bell at most this often, in seconds of play. */
export const BELL_GAP_S = 3
/** How long the pump runs for one touch, in seconds: nothing starts it again until it is done. */
export const PUMP_S = 2.7
export const DIYAS_PER_STAND = 5
/** Pigeons in a flock: all of them, and at tier 0. */
export const FLOCK = 12
export const FLOCK_THIN = 6
/** Walking this close sends the pigeons up; they are ready again once the player is `REARM_BEYOND` further. */
export const STARTLE_RANGE = 4
const REARM_BEYOND = 2
/** One wheel round the square, lift to landing, in seconds. */
export const FLIGHT_S = 7
/** The birds stand within this of the flock's middle, and wheel this wide. */
const SPREAD = 1.8
const ORBIT = 3.2
/** Under reduced motion they step this far away from the player instead. */
const ASIDE = 1.5
/** A flock further than this from the player is not moved at all. */
const IDLE_BEYOND = 50
const SWING_S = 3
const DROPS = 5
/** A tap picks a touchable only when its middle is this close to the ray. */
const TAP_RADIUS = 0.8

const yawOf = (s: TouchableSpec) => -THREE.MathUtils.degToRad(s.rot ?? 0)

/** How many diyas are lit on which stand, for this visit. In memory only. */
export interface TouchMemory {
  lit(id: string): number
  light(id: string, n: number): void
}
export function createTouchMemory(): TouchMemory {
  const lit = new Map<string, number>()
  return { lit: (id) => lit.get(id) ?? 0, light: (id, n) => void lit.set(id, n) }
}

// ---- models: each faces +z with its base on y = 0 ---------------------------------------------------

/** What stands still. */
const STILL: Record<TouchKind, () => THREE.BufferGeometry[]> = {
  // a stone step, two posts and a beam, and a small saffron pennant: a wayside shrine's bell
  bell: () => [
    box(1.4, 0.14, 0.6, 0, 0, 0, 'sandstone'),
    box(0.12, 2.2, 0.12, -0.55, 0.14, 0, 'terracotta'),
    box(0.12, 2.2, 0.12, 0.55, 0.14, 0, 'terracotta'),
    box(1.5, 0.14, 0.2, 0, 2.34, 0, 'terracotta'),
    box(0.04, 0.6, 0.04, 0.55, 2.48, 0, 'road'),
    box(0.32, 0.2, 0.03, 0.37, 2.86, 0, 'marigold'),
  ],
  // a hand pump on its platform: the body, the head and the spout over the front
  pump: () => [
    box(0.7, 0.1, 1.5, 0, 0, 0, 'sandstone'),
    cylinder(0.08, 0.1, 1.0, 6, 0, 0.1, -0.3, 'teal'),
    box(0.2, 0.26, 0.32, 0, 1.1, -0.3, 'teal'),
    box(0.08, 0.08, 0.42, 0, 0.82, -0.05, 'road'),
  ],
  // a stepped stone stand, and the clay cups on its two steps
  diyas: () => [
    box(1.7, 0.5, 0.8, 0, 0, 0, 'sandstone'),
    box(1.7, 0.4, 0.4, 0, 0.5, -0.2, 'sandstone'),
    ...DIYA_AT.map(([x, y, z]) => cylinder(0.09, 0.05, 0.06, 6, x, y, z, 'terracotta')),
  ],
}
/** Where the five cups stand on a stand (local): three on the low step, two on the high one. */
const DIYA_AT: [number, number, number][] = [
  [0, 0.5, 0.2],
  [-0.55, 0.5, 0.2],
  [0.55, 0.5, 0.2],
  [-0.3, 0.9, -0.2],
  [0.3, 0.9, -0.2],
]
/** The bell hangs from the beam here, and its model hangs down from its origin. */
const BELL_PIVOT: [number, number, number] = [0, 2.34, 0]
const bellModel = () =>
  merge([
    box(0.03, 0.22, 0.03, 0, -0.22, 0, 'road'),
    cylinder(0.07, 0.2, 0.3, 8, 0, -0.52, 0, 'marigold'),
    cylinder(0.22, 0.22, 0.04, 8, 0, -0.56, 0, 'ochre'),
    box(0.05, 0.1, 0.05, 0, -0.66, 0, 'road'),
  ])
/** The pump's handle turns about this point on its head; its model runs back (-z) from there. */
const HANDLE_PIVOT: [number, number, number] = [0, 1.39, -0.25]
const handleModel = () => merge([box(0.05, 0.05, 1.0, 0, -0.025, -0.4, 'road')])
/** Where the water leaves the spout, and how far it falls. */
const SPOUT: [number, number, number] = [0, 0.8, 0.16]
const FALL = 0.68
const dropModel = () => merge([box(0.05, 0.12, 0.05, 0, -0.06, 0, 'glass')])
const flameModel = () => new THREE.ConeGeometry(0.04, 0.13, 5).translate(0, 0.125, 0)
const hexBox = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string) =>
  bakeHex(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), hex)
const pigeonModel = () =>
  merge([
    hexBox(0.13, 0.12, 0.26, 0, 0.05, 0, '#8C93A0'),
    hexBox(0.08, 0.08, 0.09, 0, 0.15, 0.13, '#5E6673'),
    hexBox(0.09, 0.03, 0.12, 0, 0.1, -0.18, '#5E6673'),
    hexBox(0.03, 0.02, 0.04, 0, 0.17, 0.19, '#F2A81D'),
  ])
/** Two wings in a shallow V: scaled in y from 1 to -1, the V flips up and down, which is the flap. */
const wingModel = () => {
  const wing = (side: 1 | -1) =>
    bakeHex(
      new THREE.PlaneGeometry(0.24, 0.16)
        .rotateX(-Math.PI / 2)
        .translate(side * 0.12, 0, 0)
        .rotateZ(side * 0.5)
        .translate(side * 0.05, 0, 0),
      '#A9B0BC',
    )
  return merge([wing(1), wing(-1)])
}

// ---- the touchables ----------------------------------------------------------------------------------

interface Fixed extends Vec2 {
  info: TouchableInfo
  ry: number
  /** Its place among its own kind: the instance it moves. */
  slot: number
  /** Seconds into its swing or its pumping; negative while still. */
  t: number
  /** The play clock at its last ring. */
  rang: number
  /** Diyas lit. */
  lit: number
}
interface Bird {
  /** Where it stands: metres from the flock's middle. */
  ox: number
  oz: number
  ry: number
  /** In flight: its place on the wheel (angle and distance at rest), how high it goes, how late it lifts. */
  a0: number
  r0: number
  h: number
  late: number
  /** Seconds until it next pecks, and what is left of the peck it is in. */
  peck: number
  pecking: number
}
interface Flock extends Vec2 {
  id: string
  birds: Bird[]
  mode: 'ground' | 'air' | 'aside'
  /** Seconds into the flight. */
  t: number
  /** Ready to be startled: false from the lift until the player has stepped away. */
  armed: boolean
  /** Stepped aside (reduced motion): 0 at home to 1 out of the way, and which way. */
  k: number
  ax: number
  az: number
  /** The first of its instances. */
  first: number
}

export interface TouchableState extends Vec2 {
  id: string
  kind: TouchableKind
  /** A bell swinging, a pump running, pigeons in the air or stepped aside. */
  active: boolean
  /** Diyas lit on a stand (0 for the rest). */
  lit: number
}

export interface Touchables {
  /** Every frame, with where the player stands. */
  update(dt: number, player: Vec2): void
  /** The thing in reach that can be touched now, as of the last frame. */
  near(): TouchableInfo | null
  /** The touchable a ray passes by, within reach of `near` (the player): for taps. */
  pick(ray: THREE.Raycaster, near: Vec2): TouchableInfo | null
  /**
   * Touches `id` (or the one in reach) if it is within reach of `pos`: rings, pumps or lights. Null when
   * there is nothing to touch, or it will not answer now (a bell rung under `BELL_GAP_S` ago, a pump still
   * running, diyas by day or all alight).
   */
  touch(pos: Vec2, id?: string): TouchKind | null
  setQuality(q: QualityTier): void
  /** Where everything stands and what it is doing: for the test hooks. */
  list(): TouchableState[]
  dispose(): void
}

export interface TouchableOptions {
  /** Whether the sun is down (sunset to sunrise): the diyas can be lit only then. */
  night(): boolean
  memory?: TouchMemory
  hooks?: TouchableHooks
  quality?: QualityTier
  /** Defaults to the browser's `prefers-reduced-motion`. */
  reducedMotion?: boolean
  /** The sounds; the page's audio by default. */
  play?(sound: TouchSound): void
}

/** FNV-1a: the district id as a seed. */
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
const SOUND: Record<TouchKind, TouchSound> = { bell: 'bell', pump: 'pump', diyas: 'diya' }
const TAU = Math.PI * 2

export function createTouchables(
  def: DistrictDef,
  scene: THREE.Object3D,
  opts: TouchableOptions,
): Touchables {
  const { hooks } = opts
  const memory = opts.memory ?? createTouchMemory()
  const play = opts.play ?? ((s: TouchSound) => void playTouch(s))
  const still =
    opts.reducedMotion ??
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const rand = seeded(hash(`${def.id}-touch`))
  const specs = def.touchables ?? []

  const fixed: Fixed[] = []
  const flocks: Flock[] = []
  const counts: Record<TouchableKind, number> = { bell: 0, pump: 0, diyas: 0, pigeons: 0 }
  const group = new THREE.Group()
  group.name = 'touchables'
  const parts: THREE.BufferGeometry[] = []
  for (const s of specs) {
    const slot = counts[s.kind]++
    const id = `${def.id}-${s.kind}-${slot}`
    if (s.kind === 'pigeons') {
      const birds: Bird[] = []
      for (let i = 0; i < FLOCK; i++) {
        const a0 = rand() * TAU
        const r0 = 0.3 + rand() * (SPREAD - 0.3)
        birds.push({
          ox: Math.cos(a0) * r0,
          oz: Math.sin(a0) * r0,
          ry: rand() * TAU,
          a0,
          r0,
          h: 3 + rand() * 2.5,
          late: rand() * 0.5,
          peck: 1 + rand() * 5,
          pecking: 0,
        })
      }
      flocks.push({
        id,
        x: s.at.x,
        z: s.at.z,
        birds,
        mode: 'ground',
        t: 0,
        armed: true,
        k: 0,
        ax: 1,
        az: 0,
        first: slot * FLOCK,
      })
      continue
    }
    const ry = yawOf(s)
    fixed.push({
      info: { id, kind: s.kind },
      x: s.at.x,
      z: s.at.z,
      ry,
      slot,
      t: -1,
      rang: -Infinity,
      lit: s.kind === 'diyas' ? Math.min(memory.lit(id), DIYAS_PER_STAND) : 0,
    })
    for (const g of STILL[s.kind]()) parts.push(g.rotateY(ry).translate(s.at.x, 0, s.at.z))
  }

  const lambert = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  /** The wings are seen from both sides, and flipped by a negative scale. */
  const wingMaterial = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide,
  })
  /** A flame is its own light: unlit by the sky, so it shows after dark. */
  const flameMaterial = new THREE.MeshBasicMaterial({ color: '#FFC861' })
  if (parts.length) {
    const mesh = new THREE.Mesh(merge(parts), lambert)
    mesh.name = 'touchables-still'
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  // the matrices move, so nothing is culled by a stale sphere
  const instanced = (name: string, g: THREE.BufferGeometry, m: THREE.Material, n: number) => {
    if (n === 0) {
      g.dispose()
      return null
    }
    const mesh = new THREE.InstancedMesh(g, m, n)
    mesh.name = name
    mesh.frustumCulled = false
    mesh.castShadow = false
    group.add(mesh)
    return mesh
  }
  const bells = instanced('touchables-bell', bellModel(), lambert, counts.bell)
  const handles = instanced('touchables-handle', handleModel(), lambert, counts.pump)
  const water = instanced('touchables-water', dropModel(), lambert, counts.pump * DROPS)
  const flames = instanced('touchables-flame', flameModel(), flameMaterial, counts.diyas * DIYAS_PER_STAND)
  const bodies = instanced('touchables-pigeon', pigeonModel(), lambert, counts.pigeons * FLOCK)
  const wings = instanced('touchables-wing', wingModel(), wingMaterial, counts.pigeons * FLOCK)
  scene.add(group)

  // scratch, so nothing is allocated per frame
  const matrix = new THREE.Matrix4()
  const quat = new THREE.Quaternion()
  const turn = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const local = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)
  const ACROSS = new THREE.Vector3(1, 0, 0)

  let quality: QualityTier = opts.quality ?? 2
  let clock = 0
  let nearNow: Fixed | null = null
  let disposed = false

  /** Sets instance `i` of `mesh` at `f`'s local point (x, y, z), turned by `pitch` about its own x axis. */
  const place = (
    mesh: THREE.InstancedMesh,
    i: number,
    f: Fixed,
    x: number,
    y: number,
    z: number,
    pitch: number,
    sx: number,
    sy: number,
  ) => {
    quat.setFromAxisAngle(UP, f.ry)
    local.set(x, y, z).applyQuaternion(quat)
    position.set(f.x + local.x, local.y, f.z + local.z)
    if (pitch !== 0) quat.multiply(turn.setFromAxisAngle(ACROSS, pitch))
    mesh.setMatrixAt(i, matrix.compose(position, quat, scale.set(sx, sy, sx)))
  }

  /** The bell's swing: a push that dies away. Small under reduced motion. */
  const swingOf = (t: number) => (t < 0 ? 0 : (still ? 0.08 : 0.34) * Math.exp(-t * 1.3) * Math.sin(t * 7.5))
  /** The handle: three strokes down and up. */
  const strokeOf = (t: number) =>
    t < 0 || t > 2.1 ? 0 : (still ? 0.15 : 0.42) * Math.abs(Math.sin((t / 0.7) * Math.PI))

  const writeBell = (f: Fixed) => {
    place(bells!, f.slot, f, ...BELL_PIVOT, swingOf(f.t), 1, 1)
    bells!.instanceMatrix.needsUpdate = true
  }
  const writePump = (f: Fixed) => {
    place(handles!, f.slot, f, ...HANDLE_PIVOT, strokeOf(f.t), 1, 1)
    handles!.instanceMatrix.needsUpdate = true
    if (!water) return
    // the water comes after the first stroke and stops with the last; none at tier 0
    const running = quality > 0 && f.t > 0.35 && f.t < PUMP_S
    for (let d = 0; d < DROPS; d++) {
      const fall = (f.t * 1.8 + d / DROPS) % 1
      place(water, f.slot * DROPS + d, f, SPOUT[0], SPOUT[1] - fall * FALL, SPOUT[2], 0, running ? 1 : 0, 1)
    }
    water.instanceMatrix.needsUpdate = true
  }
  const writeFlames = (f: Fixed) => {
    for (let d = 0; d < DIYAS_PER_STAND; d++) {
      const [x, y, z] = DIYA_AT[d]!
      const on = d < f.lit
      // a flame wavers a little (not under reduced motion, nor at tier 0)
      const waver = still || quality === 0 ? 1 : 1 + 0.16 * Math.sin(clock * 9 + d * 2.1 + f.slot)
      place(flames!, f.slot * DIYAS_PER_STAND + d, f, x, y, z, 0, on ? 1 : 0, on ? waver : 0)
    }
    flames!.instanceMatrix.needsUpdate = true
  }
  const writeFixed = (f: Fixed) => {
    if (f.info.kind === 'bell') writeBell(f)
    else if (f.info.kind === 'pump') writePump(f)
    else writeFlames(f)
  }

  const flockSize = () => (quality === 0 ? FLOCK_THIN : FLOCK)
  const writeFlock = (fl: Flock) => {
    const n = flockSize()
    for (let i = 0; i < FLOCK; i++) {
      const b = fl.birds[i]!
      let x = fl.x + b.ox
      let z = fl.z + b.oz
      let y = 0
      let ry = b.ry
      let pitch = 0
      let flap = 0
      if (i >= n) {
        // tier 0 keeps half the flock
        bodies!.setMatrixAt(fl.first + i, matrix.compose(position.set(x, 0, z), quat, scale.set(0, 0, 0)))
        wings!.setMatrixAt(fl.first + i, matrix)
        continue
      }
      if (fl.mode === 'air') {
        const u = Math.min(Math.max((fl.t - b.late) / (FLIGHT_S - 0.6), 0), 1)
        const lift = Math.sin(Math.PI * u)
        const ang = b.a0 + TAU * u * u * (3 - 2 * u)
        const r = b.r0 + (ORBIT + (i % 3) * 0.4 - b.r0) * lift
        x = fl.x + Math.cos(ang) * r
        z = fl.z + Math.sin(ang) * r
        y = b.h * lift
        // nose along the wheel once it is up, easing from (and back to) the way it stood
        const along = Math.atan2(-Math.sin(ang), Math.cos(ang))
        const k = Math.min(1, lift * 4)
        ry = b.ry + Math.atan2(Math.sin(along - b.ry), Math.cos(along - b.ry)) * k
        if (lift > 0.02) flap = Math.sin(fl.t * 22 + i * 1.3)
      } else if (fl.mode === 'aside') {
        x += fl.ax * ASIDE * fl.k
        z += fl.az * ASIDE * fl.k
        y = 0.12 * Math.sin(Math.PI * fl.k)
      } else if (b.pecking > 0) pitch = Math.sin(Math.PI * (1 - b.pecking / 0.35)) * 0.6
      quat.setFromAxisAngle(UP, ry)
      if (pitch !== 0) quat.multiply(turn.setFromAxisAngle(ACROSS, pitch))
      position.set(x, y, z)
      bodies!.setMatrixAt(fl.first + i, matrix.compose(position, quat, scale.set(1, 1, 1)))
      // folded away on the ground: the wings show only in the air
      position.y = y + 0.14
      wings!.setMatrixAt(fl.first + i, matrix.compose(position, quat, scale.set(flap === 0 ? 0 : 1, flap, 1)))
    }
    bodies!.instanceMatrix.needsUpdate = true
    wings!.instanceMatrix.needsUpdate = true
  }

  for (const f of fixed) writeFixed(f)
  for (const fl of flocks) writeFlock(fl)

  const stepFlock = (fl: Flock, dt: number, player: Vec2) => {
    const dx = fl.x - player.x
    const dz = fl.z - player.z
    const d = Math.hypot(dx, dz)
    if (fl.mode === 'ground') {
      if (!fl.armed && d > STARTLE_RANGE + REARM_BEYOND) fl.armed = true
      if (fl.armed && d < STARTLE_RANGE) {
        fl.armed = false
        fl.t = 0
        if (still) {
          fl.mode = 'aside'
          fl.ax = d > 0 ? dx / d : 1
          fl.az = d > 0 ? dz / d : 0
        } else fl.mode = 'air'
        play('pigeons')
        touched('pigeons')
      } else if (d > IDLE_BEYOND) return
      else if (!still && quality > 0) {
        // a peck at the ground now and then
        const n = flockSize()
        let pecked = false
        for (let i = 0; i < n; i++) {
          const b = fl.birds[i]!
          if (b.pecking > 0) {
            b.pecking = Math.max(0, b.pecking - dt)
            pecked = true
          } else if ((b.peck -= dt) <= 0) {
            b.pecking = 0.35
            b.peck = 2 + rand() * 5
          }
        }
        // nobody moved: the flock is as it was drawn
        if (!pecked) return
      } else return
    } else if (fl.mode === 'air') {
      fl.t += dt
      if (fl.t >= FLIGHT_S) fl.mode = 'ground'
    } else {
      // out of the way while the player is among them, home again once they have gone
      const gone = d > STARTLE_RANGE + REARM_BEYOND
      fl.k = gone ? Math.max(0, fl.k - dt / 1.2) : Math.min(1, fl.k + dt / 0.6)
      if (gone && fl.k === 0) {
        fl.mode = 'ground'
        fl.armed = true
      }
    }
    writeFlock(fl)
  }

  const available = (f: Fixed) => f.info.kind !== 'diyas' || (f.lit < DIYAS_PER_STAND && opts.night())
  const nearest = (pos: Vec2, range: number): Fixed | null => {
    let best: Fixed | null = null
    let bestD = range
    for (let i = 0; i < fixed.length; i++) {
      const f = fixed[i]!
      const d = Math.hypot(f.x - pos.x, f.z - pos.z)
      if (d <= bestD && available(f)) {
        bestD = d
        best = f
      }
    }
    return best
  }

  return {
    update(dt, player) {
      clock += dt
      for (let i = 0; i < fixed.length; i++) {
        const f = fixed[i]!
        if (f.t >= 0) {
          f.t += dt
          if (f.t > (f.info.kind === 'bell' ? SWING_S : PUMP_S)) f.t = -1
          writeFixed(f)
        } else if (f.lit > 0 && !still && quality > 0) writeFlames(f)
      }
      for (let i = 0; i < flocks.length; i++) stepFlock(flocks[i]!, dt, player)
      const near = nearest(player, TOUCH_RANGE)
      if (near !== nearNow) {
        nearNow = near
        hooks?.near(near?.info ?? null)
      }
    },
    near: () => nearNow?.info ?? null,
    pick(ray, near) {
      let best: Fixed | null = null
      let bestD = TAP_RADIUS * TAP_RADIUS
      for (const f of fixed) {
        if (!available(f) || Math.hypot(f.x - near.x, f.z - near.z) > TOUCH_RANGE + 0.5) continue
        const d2 = ray.ray.distanceSqToPoint(position.set(f.x, f.info.kind === 'bell' ? 1.7 : 0.9, f.z))
        if (d2 < bestD) {
          bestD = d2
          best = f
        }
      }
      return best?.info ?? null
    },
    touch(pos, id) {
      const f = id ? fixed.find((x) => x.info.id === id && available(x)) : nearest(pos, TOUCH_RANGE)
      if (!f || Math.hypot(f.x - pos.x, f.z - pos.z) > TOUCH_RANGE + 0.5) return null
      const { kind } = f.info
      if (kind === 'bell') {
        // gently: one ring, and no other until it has rung out
        if (clock - f.rang < BELL_GAP_S) return null
        f.rang = clock
        f.t = 0
      } else if (kind === 'pump') {
        if (f.t >= 0) return null
        f.t = 0
      } else {
        f.lit++
        memory.light(f.info.id, f.lit)
        writeFlames(f)
      }
      play(SOUND[kind])
      touched(kind)
      return kind
    },
    setQuality(q) {
      quality = q
      for (const f of fixed) writeFixed(f)
      for (const fl of flocks) writeFlock(fl)
    },
    list: () => [
      ...fixed.map((f) => ({
        id: f.info.id,
        kind: f.info.kind as TouchableKind,
        x: f.x,
        z: f.z,
        active: f.t >= 0,
        lit: f.lit,
      })),
      ...flocks.map((fl) => ({
        id: fl.id,
        kind: 'pigeons' as const,
        x: fl.x,
        z: fl.z,
        active: fl.mode !== 'ground',
        lit: 0,
      })),
    ],
    dispose() {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        if (o instanceof THREE.InstancedMesh) o.dispose()
        ;(o.geometry as THREE.BufferGeometry).dispose()
      })
      lambert.dispose()
      wingMaterial.dispose()
      flameMaterial.dispose()
      if (nearNow) hooks?.near(null)
      nearNow = null
    },
  }
}
