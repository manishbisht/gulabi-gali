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
/** The camera's distance from the player's feet, and its angle above the ground: 7 m back and 4.5 m up. */
const DIST = Math.hypot(BACK, UP)
const ELEVATION = Math.atan2(UP, BACK)
/** How far below the horizon the view looks at the default pitch: through head height LOOK_AHEAD beyond the player. */
const TILT = Math.atan2(UP - LOOK_AT_HEIGHT, BACK + LOOK_AHEAD)
/**
 * Pitch limits in radians (positive looks up). Up: the camera drops to about 2.2 m and the view rises about
 * 14° over the horizon (rooftops, sky). Down: the camera climbs to about 6.6 m, looking about 46° down.
 */
const PITCH_UP = 0.3
const PITCH_DOWN = -0.35
/** The view tilts this many times as far as the camera swings, so looking up clears the rooftops long before the camera nears the ground. */
const TILT_GAIN = 1.6
/** A drag across the stage's full width turns the view this far (225°). */
export const DRAG_TURN = 1.25 * Math.PI
/** How fast the view eases into a turn: about 1 - e^-20 of it each second (a few frames). */
const TURN_STIFFNESS = 20
/** At the wheel, the view comes back round behind the auto after this many seconds without a turn. */
const RECENTRE_AFTER = 1.5
/** ...closing about 1 - e^-2.5 of the way each second. */
const RECENTRE = 2.5

/** An angle brought into [-π, π]. */
const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI))

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
 * Chase camera that orbits the player: behind (+z) and above at yaw 0 and pitch 0, today's view until someone
 * turns it. A drag on the stage or Q/R (`turn`) swings it all the way round (yaw, positive turns the view
 * left, as three's rotation.y does) and tilts it within limits (pitch, positive looks up), easing into the turn
 * unless the browser asks for reduced motion. At the wheel (`behind` given to `update`) it comes back round
 * behind the auto once nobody has turned it for RECENTRE_AFTER; on foot it stays where it was left.
 * Only the position lags (the player's position, eased); the view's heading is the yaw alone, so lag slides
 * the camera but never yaws the view. When a building stands between it and the player it slides in over the
 * player's head at any yaw, so it never looks out from inside a wall; it eases back out once the way is clear.
 * Allocates nothing per frame.
 */
export function createFollowCamera(
  camera: THREE.PerspectiveCamera,
  occluders: AABB[] = [],
  opts: { reducedMotion?: boolean } = {},
) {
  const reduced =
    opts.reducedMotion ??
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const anchor = new THREE.Vector3()
  const look = new THREE.Vector3()
  const head = new THREE.Vector3()
  let placed = false
  /** What the input asks for, and what is shown (eased toward it). */
  let goalYaw = 0
  let goalPitch = 0
  let yaw = 0
  let pitch = 0
  /** Seconds since the last turn. */
  let idle = Infinity
  /** How far out along its arm the camera stands (1: all the way; less: pulled in by a wall). */
  let reach = 1
  return {
    /** Turns the view by `dYaw` (positive: left) and tilts it by `dPitch` (positive: up), in radians. */
    turn(dYaw: number, dPitch: number) {
      if (dYaw === 0 && dPitch === 0) return
      goalYaw = wrap(goalYaw + dYaw)
      goalPitch = Math.min(PITCH_UP, Math.max(PITCH_DOWN, goalPitch + dPitch))
      idle = 0
    },
    /** The view's yaw now, in [-π, π]: 0 looks along -z. */
    yaw: () => yaw,
    /** The view's pitch now: 0 is today's, positive looks up. */
    pitch: () => pitch,
    /** `behind`: at the wheel, the yaw that looks over the auto's back, to come round to when left alone. */
    update(target: Vec3Like, dt: number, behind?: number) {
      idle += dt
      if (behind !== undefined && idle >= RECENTRE_AFTER)
        goalYaw = wrap(goalYaw + wrap(behind - goalYaw) * (1 - Math.exp(-RECENTRE * dt)))
      if (placed && !reduced) {
        const k = 1 - Math.exp(-TURN_STIFFNESS * dt)
        yaw = wrap(yaw + wrap(goalYaw - yaw) * k)
        pitch += (goalPitch - pitch) * k
      } else {
        yaw = goalYaw
        pitch = goalPitch
      }
      const lag = placed ? 1 - Math.exp(-STIFFNESS * dt) : 1
      anchor.x += (target.x - anchor.x) * lag
      anchor.y += (target.y - anchor.y) * lag
      anchor.z += (target.z - anchor.z) * lag
      const elevation = ELEVATION - pitch
      const flat = DIST * Math.cos(elevation)
      const sy = Math.sin(yaw)
      const cy = Math.cos(yaw)
      const pos = camera.position
      pos.set(anchor.x + sy * flat, anchor.y + DIST * Math.sin(elevation), anchor.z + cy * flat)
      head.set(target.x, target.y + LOOK_AT_HEIGHT, target.z)
      // Pulled in at once when a wall is hit, eased back out when the way clears.
      const hit = firstHit(head.x, head.z, pos.x, pos.z, occluders)
      reach = placed ? Math.min(hit, reach + (1 - reach) * (1 - Math.exp(-STIFFNESS * dt))) : hit
      placed = true
      if (reach < 1) {
        // Slide in along the ground but keep the height: from up here the street still reads, and
        // the avatar drops out of frame instead of filling it.
        pos.x = head.x + (pos.x - head.x) * reach
        pos.z = head.z + (pos.z - head.z) * reach
      }
      // Aim along the yaw from the camera itself, at a fixed tilt for the pitch: lag never yaws the view, and
      // pulling in never tips it down. At pitch 0 this is through head height LOOK_AHEAD beyond the player.
      const tilt = TILT - pitch * TILT_GAIN
      const ct = Math.cos(tilt)
      camera.lookAt(look.set(pos.x - sy * ct, pos.y - Math.sin(tilt), pos.z - cy * ct))
    },
  }
}
