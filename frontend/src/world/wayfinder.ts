import * as THREE from 'three'
import { ARRIVE_M, bearing, compassAngle, targetDistance, viewHeading, type MapTarget } from './cityMap'
import { PALETTE } from './palette'
import type { Vec2 } from './types'

/** The pillar over a target: tall enough to see over the rooftops from across the district. */
const PILLAR_H = 40
const PILLAR_R = 0.6
/** Its glow breathes between these opacities, once every this many seconds (still with reduced motion). */
const GLOW = [0.28, 0.5] as const
const PULSE_S = 2.4

/** What the compass shows: whole metres to the target, and whole degrees to turn its arrow (see `compassAngle`). */
export interface WayReading {
  target: MapTarget
  distance: number
  angle: number
}

export interface Wayfinder {
  /** Points the compass at `t` and puts the pillar up there (one target at a time). */
  set(t: MapTarget): void
  /** No target: the pillar comes down, the compass goes. */
  clear(): void
  target(): MapTarget | null
  /** Called with each new reading (only when the metres or the degrees change), and null once cleared. */
  watch(cb: (r: WayReading | null) => void): () => void
  dispose(): void
}

/**
 * The compass and the pillar for a target picked on the map. Every frame (only while there is a target) it
 * reads the distance and the arrow's turn, relative to the way the camera looks; within `ARRIVE_M` the target
 * is reached and clears itself. Leaving the district clears it too: a target belongs to the district it is in.
 */
export function createWayfinder(opts: {
  scene: THREE.Object3D
  camera: THREE.Camera
  session: {
    onFrame(cb: (dt: number, pos: Vec2) => void): () => void
    onLeave(cb: () => void): () => void
  }
  /** Says the target was cleared from here (reached, or the district left), not by `clear()`. */
  onCleared(): void
  /** With reduced motion the pillar holds still. */
  reducedMotion?: () => boolean
}): Wayfinder {
  const { scene, camera, session, onCleared } = opts
  const still =
    opts.reducedMotion ??
    (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const scratch = new THREE.Vector3()
  let target: MapTarget | null = null
  let pillar: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> | null = null
  let watchers: ((r: WayReading | null) => void)[] = []
  let last: WayReading | null = null
  let clock = 0

  const tell = (r: WayReading | null) => {
    last = r
    const list = watchers
    for (let i = 0; i < list.length; i++) list[i]!(r)
  }

  function takeDown() {
    if (!pillar) return
    pillar.removeFromParent()
    pillar.geometry.dispose()
    pillar.material.dispose()
    pillar = null
  }

  function clear() {
    if (!target) return
    target = null
    takeDown()
    tell(null)
  }

  const offFrame = session.onFrame((dt, pos) => {
    if (!target) return
    const d = targetDistance(pos, target)
    if (d <= ARRIVE_M) {
      clear()
      return onCleared()
    }
    const distance = Math.round(d)
    const angle = Math.round(compassAngle(bearing(pos, target.at), viewHeading(camera, scratch)))
    if (!last || last.distance !== distance || last.angle !== angle) tell({ target, distance, angle })
    if (pillar && !still()) {
      clock += dt
      const k = (1 - Math.cos((clock / PULSE_S) * Math.PI * 2)) / 2
      pillar.material.opacity = GLOW[0] + (GLOW[1] - GLOW[0]) * k
    }
  })
  const offLeave = session.onLeave(() => {
    if (!target) return
    clear()
    onCleared()
  })

  return {
    set(t) {
      takeDown()
      target = t
      last = null
      clock = 0
      const geometry = new THREE.CylinderGeometry(PILLAR_R, PILLAR_R, PILLAR_H, 12, 1, true)
      const material = new THREE.MeshBasicMaterial({
        color: PALETTE.marigold,
        transparent: true,
        opacity: GLOW[1],
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      pillar = new THREE.Mesh(geometry, material)
      pillar.name = 'map-target'
      pillar.position.set(t.at.x, PILLAR_H / 2, t.at.z)
      pillar.renderOrder = 1 // drawn after the street, as the transparent thing it is
      scene.add(pillar)
    },
    clear,
    target: () => target,
    watch(cb) {
      watchers = [...watchers, cb]
      if (last) cb(last)
      return () => void (watchers = watchers.filter((w) => w !== cb))
    },
    dispose() {
      offFrame()
      offLeave()
      target = null
      takeDown()
      watchers = []
    },
  }
}
