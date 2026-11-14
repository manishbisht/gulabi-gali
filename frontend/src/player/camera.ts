import * as THREE from 'three'
import type { AABB } from '../world/types'

export interface Vec3Like {
  x: number
  y: number
  z: number
}

const BACK = 7
const UP = 4.5
const LOOK_AT_HEIGHT = 1.6
/** Aim this far ahead of the player, so the view is the street and its rooftops, not the road at your feet. */
const LOOK_AHEAD = 5
/** How far the camera keeps off a wall it has been pulled in front of. */
const CLEARANCE = 0.3
/** Higher is snappier; the camera closes about 1 - e^-6 of the gap each second. */
const STIFFNESS = 6

/**
 * Where, as a fraction of the way from (x0, z0) to (x1, z1), the line first enters one of the boxes
 * (grown by CLEARANCE); 1 if it never does.
 */
function firstHit(x0: number, z0: number, x1: number, z1: number, boxes: AABB[]): number {
  const dx = x1 - x0
  const dz = z1 - z0
  let best = 1
  for (const b of boxes) {
    let lo = 0
    let hi = best
    for (const [p, d, min, max] of [
      [x0, dx, b.minX - CLEARANCE, b.maxX + CLEARANCE],
      [z0, dz, b.minZ - CLEARANCE, b.maxZ + CLEARANCE],
    ] as const) {
      if (d === 0) {
        if (p < min || p > max) hi = -1
        continue
      }
      const a = (min - p) / d
      const c = (max - p) / d
      lo = Math.max(lo, Math.min(a, c))
      hi = Math.min(hi, Math.max(a, c))
    }
    if (lo <= hi && hi >= 0) best = Math.min(best, lo)
  }
  return best
}

/**
 * Fixed-yaw chase camera behind (+z) and above the player. No orbit: touch only has the joystick.
 * When a building stands between it and the player it slides in over the player's head, so it never
 * looks out from inside a wall; it eases back out once the way is clear.
 */
export function createFollowCamera(camera: THREE.PerspectiveCamera, occluders: AABB[] = []) {
  const goal = new THREE.Vector3()
  const look = new THREE.Vector3()
  const head = new THREE.Vector3()
  let placed = false
  return {
    update(target: Vec3Like, dt: number) {
      goal.set(target.x, target.y + UP, target.z + BACK)
      if (placed) camera.position.lerp(goal, 1 - Math.exp(-STIFFNESS * dt))
      else camera.position.copy(goal)
      placed = true
      head.set(target.x, target.y + LOOK_AT_HEIGHT, target.z)
      const t = firstHit(head.x, head.z, camera.position.x, camera.position.z, occluders)
      if (t < 1) {
        // Slide in along the ground but keep the height: from up here the street still reads, and
        // the avatar drops out of frame instead of filling it.
        camera.position.x = head.x + (camera.position.x - head.x) * t
        camera.position.z = head.z + (camera.position.z - head.z) * t
      }
      // Aim from the camera's own x so lag never yaws the view; it only slides sideways. Aim a fixed
      // distance ahead of the camera, not the player, so pulling in never tips the view down.
      camera.lookAt(
        look.set(camera.position.x, target.y + LOOK_AT_HEIGHT, camera.position.z - BACK - LOOK_AHEAD),
      )
    },
  }
}
