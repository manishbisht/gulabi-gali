import * as THREE from 'three'
import { stepToward, stationSpot, type Mover } from './animals'
import { bakeHex, FLOOR_H, merge } from './kit/parts'
import { headgearOf, withoutHeadgear, type Headgear } from '../player/avatar'
import type { DistrictId } from '../net/protocol'
import { storage } from '../storage'
import type { AABB, AvatarLook, DistrictDef, LandmarkDef, Vec2 } from './types'

/*
 * The Galta bandar: in the Walled City near Jantar Mantar, and at Galta Ji itself among the kunds (`BANDAR_HOMES`),
 * a monkey now and then drops down and snatches the player's headgear (safa, cap or dupatta). The change is local to this page: the look is swapped on the
 * player's own avatar with `setLook`, never sent to anyone and never saved, and it is put back exactly on every
 * way out (caught, given back, switched off, district change, dispose).
 *
 * It runs along the rooftop edges of the nearest buildings (the same `stepToward` the animals use, with no
 * colliders: it is above them), pausing at each corner. Catch up within 2 m and the headgear is back. After 60 s
 * it gives up and drops it at the nearest landmark, where it lies until the player walks over it, or for a
 * minute more, and then it is simply given back. At most one raid per 10 minutes, and never at all with
 * `gg-no-bandar` set (the chip in the HUD).
 *
 * It never starts while the player drives, sits, flies a kite, rides the metro or has a card open: the host
 * says so through `blocked`.
 */

/** Where the bandar lives: each district it raids in, and the landmark its raids start near. */
export const BANDAR_HOMES: Partial<Record<DistrictId, string>> = {
  'walled-city': 'jantar-mantar',
  galta: 'galta-ji',
}
/** Whether `id` has the bandar (and so the HUD its switch). */
export const hasBandar = (id: DistrictId): boolean => BANDAR_HOMES[id] !== undefined

const KEY = 'gg-no-bandar'
/** Whether the visitor switched the monkey off ("Bandar band karo"): `'1'` only; anything else is on. */
export const bandarOff = (): boolean => storage.get(KEY) === '1'
/** Flips the switch; the storage has no remove, so "on" is an empty value. */
export const setBandarOff = (off: boolean): void => storage.set(KEY, off ? '1' : '')
/** The cooldown between raids, in ms. */
export const COOLDOWN_MS = 10 * 60_000
/** Catching up this close, in metres, gets the headgear back; so does walking over the dropped one. */
export const CATCH_RANGE = 2
/** The monkey gives up after this long, in seconds, and the dropped headgear is given back after as long again. */
export const GIVE_UP_S = 60
/** A raid only starts when the player is this near the bandar's home landmark, in metres. */
const NEAR_HOME = 45
/** Looks for a chance to strike this often, in seconds; each look has this chance. */
const CHECK_S = 1
const CHANCE = 0.12
const DROP_FROM = 7
const DROP_S = 0.6
const DROP_AT = 3
const SCAMPER = 3.4
const WALK = 2.2
const PAUSE_S = 1.2
const CLIMB = 8
const NO_WALLS: AABB[] = []
/** What it takes: the headwear (a safa or pagdi is a "safa" here), else the dupatta or stole. */
export type Gear = Headgear

export type BandarEvent =
  | { kind: 'snatched'; gear: Gear }
  | { kind: 'caught' }
  | { kind: 'dropped'; gear: Gear; landmark: LandmarkDef['name'] }
  | { kind: 'recovered' }
  /** Switched off mid-raid: the look is back, and nothing needs saying. */
  | { kind: 'ended' }

/** What the bandar needs of the player. */
export interface BandarPlayer {
  position(): Vec2
  driving(): boolean
  setLook(look: AvatarLook): void
}

/** When the last raid was, kept across districts so leaving and returning does not reset the 10 minutes. */
export interface BandarMemory {
  last: number | null
}
export const createBandarMemory = (): BandarMemory => ({ last: null })

export interface BandarOptions {
  /** The look the player wears now (never changed by this module; it is what is put back). */
  look(): AvatarLook
  colliders: AABB[]
  /** True while a card, sheet, bench, kite game or metro ride is over the street. */
  blocked?(): boolean
  now?(): number
  memory?: BandarMemory
  /** Defaults to the browser's `prefers-reduced-motion`. */
  reducedMotion?: boolean
}

export interface Bandar {
  update(dt: number, player: BandarPlayer): BandarEvent | null
  dispose(): void
  /** Where things stand, for tests and the test hooks. */
  peek(): { phase: Phase; x: number; z: number; y: number; speed: number; dropX: number; dropZ: number }
}
type Phase = 'idle' | 'drop' | 'run' | 'lying'

function buildMonkey(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const add = (g: THREE.BufferGeometry, hex: string, x: number, y: number, z: number) => {
    g.translate(x, y, z)
    parts.push(bakeHex(g, hex))
  }
  const fur = '#8A5A33'
  const face = '#D9B48F'
  add(new THREE.BoxGeometry(0.34, 0.4, 0.5), fur, 0, 0.5, 0)
  add(new THREE.BoxGeometry(0.28, 0.26, 0.26), fur, 0, 0.78, 0.3)
  add(new THREE.BoxGeometry(0.2, 0.14, 0.06), face, 0, 0.76, 0.45)
  add(new THREE.BoxGeometry(0.08, 0.4, 0.08), fur, -0.14, 0.2, 0.18)
  add(new THREE.BoxGeometry(0.08, 0.4, 0.08), fur, 0.14, 0.2, 0.18)
  add(new THREE.BoxGeometry(0.08, 0.4, 0.08), fur, -0.14, 0.2, -0.18)
  add(new THREE.BoxGeometry(0.08, 0.4, 0.08), fur, 0.14, 0.2, -0.18)
  add(new THREE.BoxGeometry(0.06, 0.06, 0.55), fur, 0, 0.62, -0.5)
  return merge(parts)
}

/** The corners of the nearest roofs, each a stop on the monkey's run, at roof height. */
function roofRoute(def: DistrictDef, near: Vec2): { x: number; z: number; y: number }[] {
  const roofs = (def.buildings ?? [])
    .filter((b) => b.style !== 'wall')
    .map((b) => ({ b, d: Math.hypot(b.x - near.x, b.z - near.z) }))
    .sort((p, q) => p.d - q.d)
    .slice(0, 4)
  const route: { x: number; z: number; y: number }[] = []
  for (const { b } of roofs) {
    const swap = b.rot === 90 || b.rot === 270
    const hw = (swap ? b.d : b.w) / 2 - 0.4
    const hd = (swap ? b.w : b.d) / 2 - 0.4
    const y = b.floors * FLOOR_H
    route.push(
      { x: b.x - hw, z: b.z - hd, y },
      { x: b.x + hw, z: b.z - hd, y },
      { x: b.x + hw, z: b.z + hd, y },
      { x: b.x - hw, z: b.z + hd, y },
    )
  }
  // bare ground in a test or a stripped-down district: scamper to and fro
  if (!route.length) route.push({ x: near.x + 8, z: near.z, y: 0 }, { x: near.x - 8, z: near.z, y: 0 })
  return route
}

const INERT: Bandar = {
  update: () => null,
  dispose() {},
  peek: () => ({ phase: 'idle', x: 0, z: 0, y: 0, speed: 0, dropX: 0, dropZ: 0 }),
}

export function createBandar(
  def: DistrictDef,
  scene: THREE.Object3D,
  rand: () => number,
  opts: BandarOptions,
): Bandar {
  const homeId = BANDAR_HOMES[def.id]
  if (!homeId) return INERT
  const now = opts.now ?? Date.now
  const memory = opts.memory ?? createBandarMemory()
  const reduced =
    opts.reducedMotion ??
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const speed = reduced ? WALK : SCAMPER
  const home = def.landmarks.find((l) => l.id === homeId)

  const monkeyGeo = buildMonkey()
  const monkeyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  const monkey = new THREE.Mesh(monkeyGeo, monkeyMat)
  monkey.name = 'bandar'
  monkey.visible = false
  monkey.frustumCulled = false
  const gearGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.2, 8)
  const gearMat = new THREE.MeshLambertMaterial({ color: '#F2A81D', flatShading: true })
  const gearMesh = new THREE.Mesh(gearGeo, gearMat)
  gearMesh.name = 'bandar-headgear'
  gearMesh.visible = false
  scene.add(monkey, gearMesh)

  // scratch: nothing is allocated in `update` once a raid is running
  const step: Vec2 = { x: 0, z: 0 }
  const m: Mover & { y: number } = { x: 0, z: 0, ry: 0, y: 0 }
  let phase: Phase = 'idle'
  let checkIn = 0
  let t = 0 // seconds into the phase
  let gear: Gear = 'safa'
  /** The colour of what was taken, for where it lies. */
  let gearHex = '#F2A81D'
  let route: { x: number; z: number; y: number }[] = []
  let stop = 0
  let pause = 0
  let landX = 0
  let landZ = 0
  let bound: BandarPlayer | null = null
  /** The cooldown's clock as it was before this raid began (see the drop's end). */
  let lastBefore: number | null = null
  let disposed = false

  const restore = () => {
    // the look as it is now, so a profile change made mid-raid is not undone
    bound?.setLook(opts.look())
    phase = 'idle'
    monkey.visible = false
    gearMesh.visible = false
  }
  const pose = (bob: number) => {
    monkey.position.set(m.x, m.y + bob, m.z)
    monkey.rotation.y = m.ry
  }

  function eligible(player: BandarPlayer): boolean {
    if (bandarOff()) return false
    if (memory.last !== null && now() - memory.last < COOLDOWN_MS) return false
    if (opts.blocked?.() || player.driving()) return false
    if (!headgearOf(opts.look())) return false
    const p = player.position()
    return !home || Math.hypot(p.x - home.at.x, p.z - home.at.z) <= NEAR_HOME
  }

  return {
    update(dt, player) {
      if (disposed) return null
      bound = player
      if (phase === 'idle') {
        checkIn -= dt
        if (checkIn > 0) return null
        checkIn = CHECK_S
        // the dice first: most looks end here, before the storage read and the look
        if (rand() >= CHANCE || !eligible(player)) return null
        // drops from the rooftops a few metres off, at a point of its own choosing
        const a = rand() * Math.PI * 2
        const p = player.position()
        m.x = p.x + Math.cos(a) * DROP_AT
        m.z = p.z + Math.sin(a) * DROP_AT
        m.y = reduced ? 0 : DROP_FROM
        m.ry = a + Math.PI
        const taken = headgearOf(opts.look())!
        gear = taken.gear
        gearHex = taken.hex
        lastBefore = memory.last
        memory.last = now()
        phase = 'drop'
        t = 0
        monkey.visible = true
        pose(0)
        return null
      }
      // a raid in progress: the switch is read once a second, not every frame (and once more as it lands)
      checkIn -= dt
      if (checkIn <= 0) {
        checkIn = CHECK_S
        if (phase !== 'drop' && bandarOff()) {
          restore()
          return { kind: 'ended' }
        }
      }
      t += dt
      const p = player.position()
      if (phase === 'drop') {
        m.y = reduced ? 0 : DROP_FROM * Math.max(0, 1 - t / DROP_S)
        pose(0)
        if (t < DROP_S) return null
        // switched off on its way down: it goes without taking anything, and the raid does not count
        if (bandarOff()) {
          memory.last = lastBefore
          restore()
          return { kind: 'ended' }
        }
        // it lands, grabs the headgear off the player's head and is away
        player.setLook(withoutHeadgear(opts.look()))
        route = roofRoute(def, p)
        stop = 0
        pause = 0
        phase = 'run'
        t = 0
        return { kind: 'snatched', gear }
      }
      if (phase === 'run') {
        if (Math.hypot(p.x - m.x, p.z - m.z) <= CATCH_RANGE) {
          restore()
          return { kind: 'caught' }
        }
        if (t >= GIVE_UP_S) return giveUp()
        const to = route[stop]!
        if (pause > 0) pause -= dt
        else if (!stepToward(m, to.x, to.z, 0.05, speed, dt, NO_WALLS, step)) {
          pause = PAUSE_S
          stop = (stop + 1) % route.length
        }
        m.y += Math.sign(to.y - m.y) * Math.min(Math.abs(to.y - m.y), CLIMB * dt)
        pose(reduced || pause > 0 ? 0 : Math.abs(Math.sin(t * 9)) * 0.12)
        return null
      }
      // lying: the dropped headgear waits to be walked over
      if (Math.hypot(p.x - landX, p.z - landZ) <= CATCH_RANGE || t >= GIVE_UP_S) {
        restore()
        return { kind: 'recovered' }
      }
      return null
    },
    dispose() {
      if (disposed) return
      if (phase !== 'idle') restore()
      disposed = true
      monkey.removeFromParent()
      gearMesh.removeFromParent()
      monkeyGeo.dispose()
      monkeyMat.dispose()
      gearGeo.dispose()
      gearMat.dispose()
    },
    peek: () => ({ phase, x: m.x, z: m.z, y: m.y, speed, dropX: landX, dropZ: landZ }),
  }

  /** Out of breath: the headgear is left by the landmark nearest where the monkey is. */
  function giveUp(): BandarEvent {
    let best: LandmarkDef | undefined
    let bestD = Infinity
    for (const l of def.landmarks) {
      const d = Math.hypot(l.at.x - m.x, l.at.z - m.z)
      if (d < bestD) {
        bestD = d
        best = l
      }
    }
    const spot = best ? stationSpot(best.at, opts.colliders) : { x: m.x, z: m.z }
    landX = spot.x
    landZ = spot.z
    gearMat.color.set(gearHex)
    gearMesh.position.set(landX, 0.12, landZ)
    gearMesh.visible = true
    monkey.visible = false
    phase = 'lying'
    t = 0
    return { kind: 'dropped', gear, landmark: best?.name ?? { hi: 'yahin', en: 'here' } }
  }
}
