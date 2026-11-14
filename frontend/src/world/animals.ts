import * as THREE from 'three'
import { seeded } from './districts/layout'
import { bakeHex, merge } from './kit/parts'
import { moveWithCollision } from './collision'
import type { QualityTier } from '../engine/stage'
import type { DistrictId } from '../net/protocol'
import type { AABB, DistrictDef, Vec2 } from './types'

/*
 * The street animals: dogs, cats and one cow per district. Local to this page and never sent to anyone: the
 * others do not see them, and they never see yours. One InstancedMesh per species (three draw calls at most),
 * each model well under 300 triangles. Every animal lives at a spawn point from the district def and wanders a
 * few metres round it, from a seed made of the district id, stepping with the same collision as the player.
 *
 * Calling one ("Saath chalo", or E) makes it the follower: it trails the player at `FOLLOW_GAP`, trots at
 * twice the pace when it is more than `TROT_FROM` behind (an auto leaves it behind) and is set down behind
 * the player when it is more than `SNAP_FROM` behind. One follows at a time; calling another sends the first
 * home. The cow never follows, and answers with a line. On a metro ride the follower waits at the old
 * district's station, in `StationMemory`, and rejoins if the player is back within `WAIT_MS`.
 *
 * Priority of E (see `createInteraction`): landmark > metro > bench > poster wall > auto > character or person
 * card > animal. An animal only has the key when nothing else wants it.
 */

export type AnimalKind = 'dog' | 'cat' | 'cow'
export type AnimalId = string
export interface AnimalInfo {
  id: AnimalId
  kind: AnimalKind
  name: string
}
/** What the animals tell React; each is called only when its news changes. */
export interface AnimalHooks {
  /** The animal (visible, and not the follower) nearest within reach, or null. */
  near(a: AnimalInfo | null): void
  /** The one following the player, or null. */
  following(a: AnimalInfo | null): void
  /** A passing line: the cow's `line` (0 to COW_LINES - 1), or an animal left waiting at the station. */
  notice(n: { kind: 'cow'; line: number } | { kind: 'waiting'; name: string }): void
}
export type CallResult = { kind: 'follow'; animal: AnimalInfo } | { kind: 'cow'; line: number } | null

/** "Saath chalo" shows, and E calls, within this many metres. */
export const CALL_RANGE = 3
/** How far behind the player the follower stands. */
export const FOLLOW_GAP = 1.5
/** A follower closer than this is walked out of the player's way. */
const CROWDING = 0.9
/** Beyond this far behind, the follower trots; beyond `SNAP_FROM`, it is put behind the player. */
export const TROT_FROM = 20
export const SNAP_FROM = 40
/** An animal left at the station waits this long, in ms. */
export const WAIT_MS = 10 * 60_000
/** How many cow lines there are (`animalCow1`...). */
export const COW_LINES = 4

const FOLLOW_SPEED = 4.4 // a little over walking, so it keeps up
const HOME_SPEED = 2.5
/** Room an animal needs: its body radius, and the margin for choosing places to wander to. */
const RADIUS = 0.3
const MARGIN = 0.45
const NAMES = ['Moti', 'Sheru', 'Kalu', 'Billo', 'Chhotu', 'Mithu', 'Bhura', 'Raja']
const COW_NAME = 'Gaay Mata'
/** Wander radius (m), pace (m/s) and what to rest between: per kind. A cow stands where she is. */
const KINDS: Record<AnimalKind, { wander: number; speed: number }> = {
  dog: { wander: 4, speed: 1.3 },
  cat: { wander: 3, speed: 0.8 },
  cow: { wander: 0, speed: 0 },
}
/** The tap target round an animal: a ray passing this close to its middle picks it. */
const TAP_RADIUS = 0.8

// ---- the seam: a mover that trails something --------------------------------------------------

/** Anything that walks on the ground and can be turned: an animal, and later the bandar. */
export interface Mover extends Vec2 {
  ry: number
}

/**
 * The follower's step, shared with anything else that trails the player (the bandar, say): walks `m` toward
 * (tx, tz) at `speed`, stopping `gap` short of it, with collision, and turns it to face the way it went.
 * Allocates nothing: `step` is the caller's scratch. Returns whether it moved.
 */
export function stepToward(
  m: Mover,
  tx: number,
  tz: number,
  gap: number,
  speed: number,
  dt: number,
  colliders: AABB[],
  step: Vec2,
): boolean {
  const dx = tx - m.x
  const dz = tz - m.z
  const d = Math.hypot(dx, dz)
  if (d <= gap || d === 0) return false
  const len = Math.min(speed * dt, d - gap)
  step.x = (dx / d) * len
  step.z = (dz / d) * len
  m.ry = Math.atan2(dx, dz)
  const px = m.x
  const pz = m.z
  moveWithCollision(m, step, colliders, RADIUS, m)
  return m.x !== px || m.z !== pz
}

/** Whether a body of radius `r` fits at (x, z). */
export function clearAt(colliders: AABB[], x: number, z: number, r: number): boolean {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i]!
    if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return false
  }
  return true
}

/** The nearest clear spot on rings round the station, where a waiting animal stands. */
export function stationSpot(station: Vec2, colliders: AABB[]): Vec2 {
  for (let r = 2.2; r <= 9; r += 0.8) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const x = station.x + Math.cos(a) * r
      const z = station.z + Math.sin(a) * r
      if (clearAt(colliders, x, z, MARGIN)) return { x, z }
    }
  }
  return { x: station.x, z: station.z }
}

// ---- left at the station -----------------------------------------------------------------------

/** Which animal waits at which district's station, until when. In memory only: a reload forgets it. */
export interface StationMemory {
  park(district: DistrictId, animal: AnimalId): void
  /** The animal waiting in `district`, if it still is; either way it is no longer waiting after. */
  take(district: DistrictId): AnimalId | null
}

export function createStationMemory(now: () => number = Date.now): StationMemory {
  const waiting = new Map<DistrictId, { animal: AnimalId; until: number }>()
  return {
    park: (district, animal) => void waiting.set(district, { animal, until: now() + WAIT_MS }),
    take(district) {
      const w = waiting.get(district)
      waiting.delete(district)
      return w && now() <= w.until ? w.animal : null
    },
  }
}

// ---- models --------------------------------------------------------------------------------------

type Box = [w: number, h: number, d: number, x: number, y: number, z: number, hex: string]
const build = (boxes: Box[]) =>
  merge(
    boxes.map(([w, h, d, x, y, z, hex]) => {
      const g = new THREE.BoxGeometry(w, h, d)
      g.translate(x, y + h / 2, z)
      return bakeHex(g, hex)
    }),
  )

/** Facing +z, feet on y = 0. Ten to fourteen boxes: 120 to 170 triangles. */
function modelOf(kind: AnimalKind): THREE.BufferGeometry {
  if (kind === 'dog') {
    const coat = '#D2A56C'
    const dark = '#6B4A30'
    return build([
      [0.3, 0.3, 0.7, 0, 0.28, 0, coat],
      [0.24, 0.24, 0.24, 0, 0.5, 0.42, coat],
      [0.13, 0.1, 0.14, 0, 0.5, 0.6, dark],
      [0.07, 0.14, 0.06, -0.1, 0.72, 0.38, dark],
      [0.07, 0.14, 0.06, 0.1, 0.72, 0.38, dark],
      [0.08, 0.28, 0.08, -0.1, 0, 0.26, coat],
      [0.08, 0.28, 0.08, 0.1, 0, 0.26, coat],
      [0.08, 0.28, 0.08, -0.1, 0, -0.26, coat],
      [0.08, 0.28, 0.08, 0.1, 0, -0.26, coat],
      [0.06, 0.06, 0.28, 0, 0.5, -0.46, coat],
    ])
  }
  if (kind === 'cat') {
    const coat = '#8A7F76'
    const dark = '#4B4440'
    return build([
      [0.2, 0.2, 0.42, 0, 0.17, 0, coat],
      [0.17, 0.16, 0.16, 0, 0.3, 0.26, coat],
      [0.05, 0.08, 0.04, -0.06, 0.46, 0.26, dark],
      [0.05, 0.08, 0.04, 0.06, 0.46, 0.26, dark],
      [0.05, 0.17, 0.05, -0.07, 0, 0.14, coat],
      [0.05, 0.17, 0.05, 0.07, 0, 0.14, coat],
      [0.05, 0.17, 0.05, -0.07, 0, -0.14, coat],
      [0.05, 0.17, 0.05, 0.07, 0, -0.14, coat],
      [0.04, 0.34, 0.04, 0, 0.2, -0.26, dark],
    ])
  }
  const hide = '#F6EFE4'
  const patch = '#6B4A30'
  return build([
    [0.8, 0.75, 1.6, 0, 0.6, 0, hide],
    [0.82, 0.4, 0.5, 0, 0.85, -0.3, patch],
    [0.82, 0.3, 0.4, 0, 0.7, 0.45, patch],
    [0.42, 0.42, 0.45, 0, 0.95, 1.0, hide],
    [0.26, 0.2, 0.14, 0, 0.9, 1.3, '#E4917A'],
    [0.06, 0.16, 0.06, -0.2, 1.37, 0.95, '#F6EFE4'],
    [0.06, 0.16, 0.06, 0.2, 1.37, 0.95, '#F6EFE4'],
    [0.12, 0.06, 0.18, -0.3, 1.2, 1.0, patch],
    [0.12, 0.06, 0.18, 0.3, 1.2, 1.0, patch],
    [0.14, 0.6, 0.14, -0.28, 0, 0.6, hide],
    [0.14, 0.6, 0.14, 0.28, 0, 0.6, hide],
    [0.14, 0.6, 0.14, -0.28, 0, -0.6, hide],
    [0.14, 0.6, 0.14, 0.28, 0, -0.6, hide],
    [0.06, 0.6, 0.06, 0, 0.5, -0.85, patch],
  ])
}

// ---- the animals ---------------------------------------------------------------------------------

type Mode = 'wander' | 'follow' | 'home'
interface Animal extends Mover {
  info: AnimalInfo
  home: Vec2
  mode: Mode
  /** Where it is wandering to, and for how long it rests first. */
  tx: number
  tz: number
  rest: number
  /** Seconds spent unable to make headway (sent home round a corner, or wandering into a wall). */
  stuck: number
  /** Walk-cycle phase, advanced while it moves. */
  phase: number
  moving: boolean
  /** Its place among its own kind (the instance), which tier 0 uses to halve the street. */
  slot: number
  visible: boolean
}

export interface AnimalState extends Vec2 {
  id: AnimalId
  kind: AnimalKind
  name: string
  following: boolean
  visible: boolean
}

export interface Animals {
  /** Every frame, with where the player stands. */
  update(dt: number, player: Vec2): void
  /** The animal (visible, and not the follower) nearest within `range` of `pos`. */
  nearest(pos: Vec2, range: number): AnimalInfo | null
  /** The animal a ray passes by, nearest first: for taps. */
  pick(ray: THREE.Raycaster): AnimalInfo | null
  /**
   * Calls the animal `id` (or the nearest) if it is within reach of `pos`. A dog or cat becomes the follower
   * and the last follower goes home; the cow answers with a line and stays.
   */
  call(pos: Vec2, id?: AnimalId): CallResult
  /** Sends the follower back to where it lives. */
  sendHome(): void
  following(): AnimalId | null
  /** The player is leaving by metro: the follower waits at this district's station. Returns who, if anyone. */
  beginTravel(): AnimalInfo | null
  setQuality(q: QualityTier): void
  visibleCount(): number
  /** Test hook: while on, nobody wanders (a follower still follows). */
  freeze(on: boolean): void
  /** Where everybody stands: for the test hooks. */
  list(): AnimalState[]
  dispose(): void
}

export interface AnimalOptions {
  colliders: AABB[]
  memory?: StationMemory
  hooks?: AnimalHooks
  quality?: QualityTier
}

/** FNV-1a: the district id as a seed. */
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function createAnimals(def: DistrictDef, scene: THREE.Object3D, opts: AnimalOptions): Animals {
  const { colliders, hooks } = opts
  const memory = opts.memory ?? createStationMemory()
  const rand = seeded(hash(def.id))
  const names = NAMES.map((n) => [rand(), n] as const)
    .sort((a, b) => a[0] - b[0])
    .map((e) => e[1])

  const animals: Animal[] = []
  const spawn = (kind: AnimalKind, home: Vec2, slot: number, name: string): Animal => ({
    info: { id: `${def.id}-${kind}-${slot}`, kind, name },
    home,
    x: home.x,
    z: home.z,
    ry: rand() * Math.PI * 2,
    mode: 'wander',
    tx: home.x,
    tz: home.z,
    rest: rand() * 3,
    stuck: 0,
    phase: rand() * 6,
    moving: false,
    slot,
    visible: true,
  })
  def.animals.dogs.forEach((p, i) => animals.push(spawn('dog', p, i, names.shift()!)))
  def.animals.cats.forEach((p, i) => animals.push(spawn('cat', p, i, names.shift()!)))
  animals.push(spawn('cow', def.animals.cow, 0, COW_NAME))

  // one instanced mesh per kind, one draw call each; the matrices move every frame, so no culling by a stale sphere
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  const meshes = {} as Record<AnimalKind, THREE.InstancedMesh>
  for (const kind of ['dog', 'cat', 'cow'] as const) {
    const mine = animals.filter((a) => a.info.kind === kind)
    const mesh = new THREE.InstancedMesh(modelOf(kind), material, mine.length)
    mesh.name = `animals-${kind}`
    mesh.frustumCulled = false
    mesh.castShadow = false
    // a little variety in the dogs' and cats' coats; the vertex colours are the base
    const tint = new THREE.Color()
    mine.forEach((_, i) => mesh.setColorAt(i, tint.setHSL(0.08, rand() * 0.25, 0.82 + rand() * 0.18)))
    meshes[kind] = mesh
    scene.add(mesh)
  }

  // scratch, so nothing is allocated per frame
  const step: Vec2 = { x: 0, z: 0 }
  const matrix = new THREE.Matrix4()
  const quat = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)

  let follower: Animal | null = null
  let nearId: AnimalId | null = null
  let frozen = false
  let quality: QualityTier = opts.quality ?? 2
  let cowLine = 0
  let disposed = false

  const byId = (id: AnimalId) => animals.find((a) => a.info.id === id)
  const setFollower = (a: Animal | null) => {
    if (follower === a) return
    if (follower) {
      follower.mode = 'home'
      follower.stuck = 0
    }
    follower = a
    if (a) {
      a.mode = 'follow'
      a.stuck = 0
    }
    hooks?.following(a ? a.info : null)
  }
  const isVisible = (a: Animal) => quality > 0 || a === follower || a.slot % 2 === 0
  const refreshVisible = () => {
    for (const a of animals) a.visible = isVisible(a)
  }

  /** The follower of a district the player left by metro: at the station, and following again. */
  const waiting = memory.take(def.id)
  const rejoined = waiting ? byId(waiting) : undefined
  if (rejoined && rejoined.info.kind !== 'cow') {
    const spot = stationSpot(def.station, colliders)
    rejoined.x = spot.x
    rejoined.z = spot.z
    setFollower(rejoined)
  }
  refreshVisible()

  const pickTarget = (a: Animal) => {
    const { wander } = KINDS[a.info.kind]
    a.rest = 1 + rand() * 4
    a.tx = a.home.x
    a.tz = a.home.z
    for (let i = 0; i < 5; i++) {
      const ang = rand() * Math.PI * 2
      const r = rand() * wander
      const x = a.home.x + Math.cos(ang) * r
      const z = a.home.z + Math.sin(ang) * r
      if (clearAt(colliders, x, z, MARGIN)) {
        a.tx = x
        a.tz = z
        return
      }
    }
  }

  const stepFollow = (a: Animal, dt: number, p: Vec2) => {
    const dx = a.x - p.x
    const dz = a.z - p.z
    const d = Math.hypot(dx, dz)
    if (d > SNAP_FROM) {
      // far behind (a lift in an auto, a long stall): set down just behind the player, on the side it came from
      const ux = d > 0 ? dx / d : 0
      const uz = d > 0 ? dz / d : -1
      a.x = p.x
      a.z = p.z
      step.x = ux * FOLLOW_GAP
      step.z = uz * FOLLOW_GAP
      moveWithCollision(a, step, colliders, RADIUS, a)
      a.moving = false
      return
    }
    if (d < CROWDING) {
      // walked into: back off along the line from the player
      const ux = d > 0 ? dx / d : 0
      const uz = d > 0 ? dz / d : 1
      const len = Math.min(FOLLOW_SPEED * dt, FOLLOW_GAP - 0.2 - d)
      step.x = ux * len
      step.z = uz * len
      moveWithCollision(a, step, colliders, RADIUS, a)
      a.moving = true
      return
    }
    const speed = d > TROT_FROM ? FOLLOW_SPEED * 2 : FOLLOW_SPEED
    a.moving = stepToward(a, p.x, p.z, FOLLOW_GAP, speed, dt, colliders, step)
  }

  const stepWander = (a: Animal, dt: number) => {
    const { speed, wander } = KINDS[a.info.kind]
    a.moving = false
    if (wander === 0 || frozen) return
    if (a.rest > 0) {
      a.rest -= dt
      return
    }
    const px = a.x
    const pz = a.z
    a.moving = stepToward(a, a.tx, a.tz, 0.05, speed, dt, colliders, step)
    if (!a.moving) return pickTarget(a) // arrived
    a.stuck = Math.hypot(a.x - px, a.z - pz) < speed * dt * 0.3 ? a.stuck + dt : 0
    if (a.stuck > 0.5) {
      a.stuck = 0
      pickTarget(a)
    }
  }

  const stepHome = (a: Animal, dt: number) => {
    const px = a.x
    const pz = a.z
    a.moving = stepToward(a, a.home.x, a.home.z, 0.05, HOME_SPEED, dt, colliders, step)
    if (!a.moving) {
      a.mode = 'wander'
      return pickTarget(a)
    }
    a.stuck = Math.hypot(a.x - px, a.z - pz) < HOME_SPEED * dt * 0.3 ? a.stuck + dt : 0
    if (a.stuck > 2) {
      // boxed in on the way: it is home all the same
      a.x = a.home.x
      a.z = a.home.z
      a.mode = 'wander'
      a.stuck = 0
      pickTarget(a)
    }
  }

  const write = () => {
    const counts = { dog: 0, cat: 0, cow: 0 }
    for (const a of animals) {
      const i = counts[a.info.kind]++
      const bob = a.moving ? Math.abs(Math.sin(a.phase)) * 0.07 : 0
      position.set(a.x, bob, a.z)
      quat.setFromAxisAngle(UP, a.ry)
      const s = a.visible ? 1 : 0
      scale.set(s, s, s)
      meshes[a.info.kind].setMatrixAt(i, matrix.compose(position, quat, scale))
    }
    for (const kind of ['dog', 'cat', 'cow'] as const) meshes[kind].instanceMatrix.needsUpdate = true
  }
  write()

  const nearestAnimal = (pos: Vec2, range: number): Animal | null => {
    let best: Animal | null = null
    let bestD = range
    for (const a of animals) {
      if (!a.visible || a === follower) continue // the follower is already with you
      const d = Math.hypot(a.x - pos.x, a.z - pos.z)
      if (d <= bestD) {
        bestD = d
        best = a
      }
    }
    return best
  }

  return {
    update(dt, player) {
      for (const a of animals) {
        if (a.mode === 'follow') stepFollow(a, dt, player)
        else if (a.mode === 'home') stepHome(a, dt)
        else stepWander(a, dt)
        if (a.moving) a.phase += dt * 11
      }
      write()
      const near = nearestAnimal(player, CALL_RANGE)
      const id = near?.info.id ?? null
      if (id !== nearId) {
        nearId = id
        hooks?.near(near?.info ?? null)
      }
    },
    nearest: (pos, range) => nearestAnimal(pos, range)?.info ?? null,
    pick(ray) {
      let best: Animal | null = null
      let bestD = Infinity
      for (const a of animals) {
        if (!a.visible) continue
        position.set(a.x, a.info.kind === 'cow' ? 0.9 : 0.35, a.z)
        const radius = a.info.kind === 'cow' ? TAP_RADIUS + 0.4 : TAP_RADIUS
        const d2 = ray.ray.distanceSqToPoint(position)
        if (d2 < radius * radius && d2 < bestD) {
          bestD = d2
          best = a
        }
      }
      return best?.info ?? null
    },
    call(pos, id) {
      const a = id ? byId(id) : nearestAnimal(pos, CALL_RANGE)
      if (!a || !a.visible || Math.hypot(a.x - pos.x, a.z - pos.z) > CALL_RANGE + 0.5) return null
      if (a.info.kind === 'cow') {
        const line = cowLine++ % COW_LINES
        hooks?.notice({ kind: 'cow', line })
        return { kind: 'cow', line }
      }
      setFollower(a)
      return { kind: 'follow', animal: a.info }
    },
    sendHome: () => setFollower(null),
    following: () => follower?.info.id ?? null,
    beginTravel() {
      const a = follower
      if (!a) return null
      memory.park(def.id, a.info.id)
      hooks?.notice({ kind: 'waiting', name: a.info.name })
      return a.info
    },
    setQuality(q) {
      quality = q
      refreshVisible()
      write()
    },
    visibleCount: () => animals.filter((a) => a.visible).length,
    freeze(on) {
      frozen = on
    },
    list: () =>
      animals.map((a) => ({
        id: a.info.id,
        kind: a.info.kind,
        name: a.info.name,
        x: a.x,
        z: a.z,
        following: a === follower,
        visible: a.visible,
      })),
    dispose() {
      if (disposed) return
      disposed = true
      for (const kind of ['dog', 'cat', 'cow'] as const) {
        const mesh = meshes[kind]
        mesh.removeFromParent()
        mesh.geometry.dispose()
        mesh.dispose()
      }
      material.dispose()
      if (nearId) hooks?.near(null)
      if (follower) hooks?.following(null)
    },
  }
}
