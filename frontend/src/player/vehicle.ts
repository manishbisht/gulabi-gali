import type { AABB, Vec2 } from '../world/types'

/** Three times walking pace. The server allows exactly this for a move that says `v: 'auto'`. */
export const AUTO_SPEED = 12
/** Backing up is for tight spots, not for racing. */
const REVERSE_SPEED = 4
/** The auto collides as a disc this big, bigger than a walker's, so it cannot squeeze through gaps. */
export const AUTO_RADIUS = 1.2
/** Speed gained, lost braking against the way it rolls, and lost coasting, in m/s per second. */
const ACCEL = 14
const BRAKE = 28
const COAST = 8
/** Turn rate at full steer, in rad/s; it fades to nothing at a standstill, so no spinning on the spot. */
const TURN_RATE = 1.9
const FULL_TURN_SPEED = 3
/** The footprint of the auto model (see props), and the walker who gets out of it. */
const FOOT = { w: 1.4, d: 2.7 }
const WALKER_RADIUS = 0.4
/**
 * Where to get out: rings from this close to this far, a step apart, and eight ways round each. The first
 * 3 m are the usual search; only when all of that is blocked does it widen, to 6 m.
 */
const EXIT_NEAR = 1.2
const EXIT_FAR = 6
const EXIT_STEP = 0.3
/** Sides first (a door is on the side), then the corners, then front and back. */
const EXIT_WAYS = [1 / 2, -1 / 2, 3 / 4, -3 / 4, 1 / 4, -1 / 4, 1, 0].map((f) => f * Math.PI)

export interface Vehicle {
  /** Where it is and which way it faces (radians about y; 0 faces +z), and how fast it rolls (negative in reverse). */
  readonly x: number
  readonly z: number
  readonly heading: number
  readonly speed: number
  /** Puts it down at (x, z), facing `heading`, already rolling at `speed`. */
  reset(x: number, z: number, heading: number, speed?: number): void
  /**
   * One frame of driving. `input.z` is the pedal (forward or back) and `input.x` the wheel (right is positive).
   * Returns the step it would like to take, in metres; the same object every call, so a frame allocates
   * nothing. Pass where it actually got to (after collisions) to `commit`.
   */
  update(input: Vec2, dt: number): Vec2
  /** Lands at (x, z). A step that was cut short by a wall takes the speed off in proportion. */
  commit(x: number, z: number): void
  /**
   * Somewhere to step out: the nearest point on rings 1.2 to 3 m round it (6 m when those are all blocked) that a walker fits at, clear of
   * `colliders` and of the auto itself (which stays where it is left). Null when there is none: stay in.
   */
  exitPoint(colliders: readonly AABB[], walkerRadius?: number): Vec2 | null
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const approach = (v: number, to: number, by: number) => (v < to ? Math.min(to, v + by) : Math.max(to, v - by))

const hits = (x: number, z: number, r: number, c: AABB) =>
  x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r

/**
 * Whether the straight line from (x0, z0) to (x1, z1) crosses the box (slab test). Used to refuse an exit point
 * only reachable through a thin wall, which `hits` alone cannot see: the point itself is clear.
 */
function crosses(x0: number, z0: number, x1: number, z1: number, c: AABB): boolean {
  let lo = 0
  let hi = 1
  const dx = x1 - x0
  const dz = z1 - z0
  const slabs = [
    [dx, x0, c.minX, c.maxX],
    [dz, z0, c.minZ, c.maxZ],
  ] as const
  for (const [d, p, min, max] of slabs) {
    if (Math.abs(d) < 1e-9) {
      if (p < min || p > max) return false
      continue
    }
    let a = (min - p) / d
    let b = (max - p) / d
    if (a > b) [a, b] = [b, a]
    lo = Math.max(lo, a)
    hi = Math.min(hi, b)
    if (lo > hi) return false
  }
  return true
}

export function createVehicle(kind: 'auto'): Vehicle {
  void kind // one kind so far; the argument keeps the call sites ready for more
  let x = 0
  let z = 0
  let heading = 0
  let speed = 0
  /** What the last `update` asked for, so `commit` can tell how much of it was got. */
  let asked = 0
  const step: Vec2 = { x: 0, z: 0 }
  const own: AABB = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }

  return {
    get x() {
      return x
    },
    get z() {
      return z
    },
    get heading() {
      return heading
    },
    get speed() {
      return speed
    },
    reset(nx, nz, h, s = 0) {
      x = nx
      z = nz
      heading = wrap(h)
      speed = s
      asked = 0
    },
    update(input, dt) {
      const target = input.z > 0 ? input.z * AUTO_SPEED : input.z * REVERSE_SPEED
      const against = speed !== 0 && target !== 0 && Math.sign(target) !== Math.sign(speed)
      const rate = target === 0 ? COAST : against ? BRAKE : Math.abs(target) > Math.abs(speed) ? ACCEL : COAST
      speed = approach(speed, target, rate * dt)
      // like a car's wheel: backing up turns the nose the other way
      const turn = -input.x * TURN_RATE * Math.min(1, Math.abs(speed) / FULL_TURN_SPEED) * Math.sign(speed)
      let mid = heading
      if (turn !== 0) {
        const by = turn * dt
        mid = heading + by / 2
        heading = wrap(heading + by)
      }
      // along the middle of the turn: the same path however the frames are cut
      step.x = Math.sin(mid) * speed * dt
      step.z = Math.cos(mid) * speed * dt
      asked = Math.hypot(step.x, step.z)
      return step
    },
    commit(nx, nz) {
      if (asked > 1e-9) speed *= Math.min(1, Math.hypot(nx - x, nz - z) / asked)
      x = nx
      z = nz
    },
    exitPoint(colliders, walkerRadius = WALKER_RADIUS) {
      const c = Math.abs(Math.cos(heading))
      const s = Math.abs(Math.sin(heading))
      const hx = (FOOT.w * c + FOOT.d * s) / 2
      const hz = (FOOT.w * s + FOOT.d * c) / 2
      own.minX = x - hx
      own.maxX = x + hx
      own.minZ = z - hz
      own.maxZ = z + hz
      for (let r = EXIT_NEAR; r <= EXIT_FAR + 1e-9; r += EXIT_STEP) {
        for (const way of EXIT_WAYS) {
          const px = x + Math.sin(heading + way) * r
          const pz = z + Math.cos(heading + way) * r
          if (hits(px, pz, walkerRadius, own)) continue
          if (colliders.some((k) => hits(px, pz, walkerRadius, k))) continue
          // Not through a wall: the walker steps there from the auto's middle. A box the auto already sits
          // inside (a loose box round a prop) is no wall to cross.
          if (
            colliders.some(
              (k) => !(x > k.minX && x < k.maxX && z > k.minZ && z < k.maxZ) && crosses(x, z, px, pz, k),
            )
          )
            continue
          return { x: px, z: pz }
        }
      }
      return null
    },
  }
}
