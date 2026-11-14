import type { AABB, Vec2 } from './types'

const overlaps = (x: number, z: number, r: number, c: AABB) =>
  x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r

/** Move one axis; if the destination hits a collider, snap flush against its face. */
function slide(pos: number, delta: number, other: number, axis: 'x' | 'z', cs: AABB[], r: number): number {
  if (delta === 0) return pos
  let next = pos + delta
  for (const c of cs) {
    const hit = axis === 'x' ? overlaps(next, other, r, c) : overlaps(other, next, r, c)
    if (!hit) continue
    const lo = axis === 'x' ? c.minX : c.minZ
    const hi = axis === 'x' ? c.maxX : c.maxZ
    next = delta > 0 ? lo - r : hi + r
  }
  return next
}

/**
 * Circle-vs-AABB movement that slides along walls (axis by axis). Large steps are split into
 * sub-steps no longer than `radius`, so nothing tunnels through thin colliders.
 *
 * A walker who already stands inside a collider (a seat inside a turned prop's loose box, a correction
 * from the server) is let out by that collider's nearest face and never further in: along the axis of
 * least penetration the step may only point outward. Snapping to the faces instead would throw them through
 * to the far side, and simply ignoring the collider would let them walk through the building a frame at a
 * time.
 */
export function moveWithCollision(from: Vec2, step: Vec2, colliders: AABB[], radius: number): Vec2 {
  let stepX = step.x
  let stepZ = step.z
  let solid = colliders
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i]!
    if (!overlaps(from.x, from.z, radius, c)) continue
    const west = from.x - (c.minX - radius)
    const east = c.maxX + radius - from.x
    const north = from.z - (c.minZ - radius)
    const south = c.maxZ + radius - from.z
    const least = Math.min(west, east, north, south)
    if (least === west) stepX = Math.min(stepX, 0)
    else if (least === east) stepX = Math.max(stepX, 0)
    else if (least === north) stepZ = Math.min(stepZ, 0)
    else stepZ = Math.max(stepZ, 0)
    // The colliders it stands inside are held by the rule above; the rest stop it as usual. Only in this
    // case a new list, so an ordinary step allocates nothing.
    if (solid === colliders) solid = colliders.filter((k) => !overlaps(from.x, from.z, radius, k))
  }
  return slideAll(from, stepX, stepZ, solid, radius)
}

/** The step, in sub-steps of at most `radius`, sliding along every collider in the way. */
function slideAll(from: Vec2, stepX: number, stepZ: number, colliders: AABB[], radius: number): Vec2 {
  const len = Math.hypot(stepX, stepZ)
  const n = Math.max(1, Math.ceil(len / Math.max(radius, 1e-6)))
  const dx = stepX / n
  const dz = stepZ / n
  const tx = from.x + stepX
  const tz = from.z + stepZ
  let x = from.x
  let z = from.z
  for (let i = 1; i <= n; i++) {
    // On the last sub-step land exactly on the target when unobstructed (no float drift).
    const sx = i === n && Math.abs(tx - x) <= Math.abs(dx) * 1.0001 ? tx - x : dx
    x = slide(x, sx, z, 'x', colliders, radius)
    const sz = i === n && Math.abs(tz - z) <= Math.abs(dz) * 1.0001 ? tz - z : dz
    z = slide(z, sz, x, 'z', colliders, radius)
  }
  return { x, z }
}
