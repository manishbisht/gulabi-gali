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
 * sub-steps no longer than `radius`, so nothing tunnels through thin colliders. A collider the walker
 * already stands inside (a seat inside a turned prop's loose box, say) does not hold them: they walk out
 * of it, where snapping to its faces would throw them through to the far side.
 */
export function moveWithCollision(from: Vec2, step: Vec2, all: AABB[], radius: number): Vec2 {
  let colliders = all
  for (let i = 0; i < all.length; i++) {
    if (!overlaps(from.x, from.z, radius, all[i]!)) continue
    // Only then a new list, so an ordinary step allocates nothing.
    colliders = all.filter((c) => !overlaps(from.x, from.z, radius, c))
    break
  }
  const len = Math.hypot(step.x, step.z)
  const n = Math.max(1, Math.ceil(len / Math.max(radius, 1e-6)))
  const dx = step.x / n
  const dz = step.z / n
  const tx = from.x + step.x
  const tz = from.z + step.z
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
