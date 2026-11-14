import * as THREE from 'three'
import { buildAvatar } from '../player/avatar'
import type { NpcDef, Vec2 } from './types'

/** Standing at a waypoint for this long, in seconds, before walking on. */
const REST_MIN = 2
const REST_MAX = 5
/** The invisible tap target around each body: a forgiving cylinder, not the thin limbs. */
const TAP_RADIUS = 0.75
const TAP_HEIGHT = 2.2

interface Walker {
  x: number
  z: number
  leg: number
  rest: number
}

/** Moves `w` toward the end of its leg; true if it got there this step (and `leg` has moved on). */
function advance(w: Walker, route: Vec2[], speed: number, dt: number): boolean {
  const to = route[(w.leg + 1) % route.length]!
  const dx = to.x - w.x
  const dz = to.z - w.z
  const dist = Math.hypot(dx, dz)
  const step = speed * dt
  if (dist <= step) {
    w.x = to.x
    w.z = to.z
    w.leg = (w.leg + 1) % route.length
    return true
  }
  w.x += (dx / dist) * step
  w.z += (dz / dist) * step
  return false
}

/**
 * One step along a looping route. Leg `i` runs from `route[i]` to `route[i + 1]`, and the last leg runs
 * back to `route[0]`. On reaching a waypoint it stops there and `legIndex` moves on to the next leg.
 */
export function stepAlongRoute(
  pos: Vec2,
  route: Vec2[],
  legIndex: number,
  speed: number,
  dt: number,
): { pos: Vec2; legIndex: number } {
  const w: Walker = { x: pos.x, z: pos.z, leg: legIndex, rest: 0 }
  advance(w, route, speed, dt)
  return { pos: { x: w.x, z: w.z }, legIndex: w.leg }
}

export interface Npcs {
  /** Each character and its body in the scene, in the order given. */
  entries: readonly { def: NpcDef; body: THREE.Group }[]
  update(dt: number): void
  /** The character whose body the ray passes through, nearest first. */
  pick(ray: THREE.Raycaster): NpcDef | null
  /** The nearest character within `range` metres of `pos` on the ground. */
  nearest(pos: Vec2, range: number): NpcDef | null
  dispose(): void
}

/** Puts each character on its route, walking and resting, with no allocation per frame. */
export function createNpcs(defs: NpcDef[], scene: THREE.Object3D): Npcs {
  const tapMaterial = new THREE.MeshBasicMaterial({ visible: false })
  const tapGeometry = new THREE.CylinderGeometry(TAP_RADIUS, TAP_RADIUS, TAP_HEIGHT, 8)
  const walkers: Walker[] = []
  const entries = defs.map((def) => {
    const body = new THREE.Group()
    body.name = `npc-${def.id}`
    body.add(buildAvatar(def.look))
    const tap = new THREE.Mesh(tapGeometry, tapMaterial)
    tap.position.y = TAP_HEIGHT / 2
    tap.name = 'tap'
    body.add(tap)
    const start = def.route[0]!
    body.position.set(start.x, 0, start.z)
    scene.add(body)
    walkers.push({ x: start.x, z: start.z, leg: 0, rest: 0 })
    return { def, body }
  })
  const taps = entries.map((e) => e.body.getObjectByName('tap')!)

  return {
    entries,
    update(dt) {
      for (let i = 0; i < entries.length; i++) {
        const w = walkers[i]!
        const { def, body } = entries[i]!
        if (w.rest > 0) {
          w.rest -= dt
        } else {
          const px = w.x
          const pz = w.z
          if (advance(w, def.route, def.speed, dt)) w.rest = REST_MIN + Math.random() * (REST_MAX - REST_MIN)
          if (w.x !== px || w.z !== pz) body.rotation.y = Math.atan2(w.x - px, w.z - pz)
        }
        body.position.x = w.x
        body.position.z = w.z
      }
    },
    pick(ray) {
      for (const e of entries) e.body.updateMatrixWorld(true)
      const hit = ray.intersectObjects(taps, false)[0]
      return hit ? (entries.find((e) => e.body === hit.object.parent)?.def ?? null) : null
    },
    nearest(pos, range) {
      let best: NpcDef | null = null
      let bestD = range
      for (let i = 0; i < entries.length; i++) {
        const w = walkers[i]!
        const d = Math.hypot(w.x - pos.x, w.z - pos.z)
        if (d <= bestD) {
          bestD = d
          best = entries[i]!.def
        }
      }
      return best
    },
    dispose() {
      for (const { body } of entries) {
        body.removeFromParent()
        body.traverse((o) => {
          if (!(o instanceof THREE.Mesh) || o.name === 'tap') return
          ;(o.geometry as THREE.BufferGeometry).dispose()
          const m = o.material as THREE.Material | THREE.Material[]
          for (const mat of Array.isArray(m) ? m : [m]) mat.dispose()
        })
      }
      tapGeometry.dispose()
      tapMaterial.dispose()
    },
  }
}
