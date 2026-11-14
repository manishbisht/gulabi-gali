import type * as THREE from 'three'
import { footprint } from '../kit'
import type { AABB, BuildingSpec, Vec2 } from '../types'

/*
 * Shared by the district files: rectangles, a seeded generator and a row-of-buildings filler, so each
 * district is the same on every visit.
 */

export const rect = (x0: number, z0: number, x1: number, z1: number): AABB => ({
  minX: Math.min(x0, x1),
  maxX: Math.max(x0, x1),
  minZ: Math.min(z0, z1),
  maxZ: Math.max(z0, z1),
})
export const grow = (r: AABB, m: number): AABB => rect(r.minX - m, r.minZ - m, r.maxX + m, r.maxZ + m)
export const centred = (at: Vec2, size: { w: number; d: number }) =>
  rect(at.x - size.w / 2, at.z - size.d / 2, at.x + size.w / 2, at.z + size.d / 2)
export const overlaps = (a: AABB, b: AABB) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ

/** A landmark's `build`: the model, moved to where it stands. */
export const placed = (build: () => THREE.Group, at: Vec2) => async () => {
  const g = build()
  g.position.set(at.x, 0, at.z)
  return g
}

/** mulberry32: a tiny seeded generator, so the layout never changes between visits. */
export function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Facing = 'n' | 's' | 'e' | 'w'
/** What a building in a row looks like, given the width and depth the row picked for it. */
export type Look = (w: number, d: number) => Omit<BuildingSpec, 'x' | 'z' | 'rot'>

/**
 * A district's building fill: rows of buildings that never overlap each other or the keep-out areas,
 * and stay inside `bounds`.
 */
export function createFill(seed: number, bounds: AABB, keepOut: AABB[]) {
  const rand = seeded(seed)
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo)
  const buildings: BuildingSpec[] = []

  const fits = (b: AABB) =>
    b.minX >= bounds.minX &&
    b.maxX <= bounds.maxX &&
    b.minZ >= bounds.minZ &&
    b.maxZ <= bounds.maxZ &&
    !keepOut.some((k) => overlaps(b, k)) &&
    !buildings.some((o) => overlaps(b, footprint(o)))

  /**
   * Buildings shoulder to shoulder along one side of a street, facing it. `front` is the building line,
   * `facing` the way the street faces look; `from`..`to` runs along the street. Widths and depths are
   * picked from the ranges given, in whole metres.
   */
  function row(
    from: number,
    to: number,
    front: number,
    facing: Facing,
    look: Look,
    size: { w: [number, number]; d: [number, number] },
  ) {
    let at = from
    while (to - at >= 6) {
      const w = Math.min(Math.round(between(...size.w)), to - at)
      const d = Math.round(between(...size.d))
      const mid = at + w / 2
      const spec: BuildingSpec =
        facing === 's'
          ? { ...look(w, d), x: mid, z: front - d / 2 }
          : facing === 'n'
            ? { ...look(w, d), x: mid, z: front + d / 2, rot: 180 }
            : facing === 'e'
              ? { ...look(w, d), x: front - d / 2, z: mid, rot: 270 }
              : { ...look(w, d), x: front + d / 2, z: mid, rot: 90 }
      if (fits(footprint(spec))) {
        buildings.push(spec)
        at += w
      } else {
        at += 1 // something is in the way: try a little further along
      }
    }
  }

  return { buildings, rand, between, fits, row }
}

/** An axis-aligned run of wall from one corner to the other. */
export function wall(r: AABB, floors: 1 | 2, tint: BuildingSpec['tint'] = 'pink'): BuildingSpec {
  const w = r.maxX - r.minX
  const d = r.maxZ - r.minZ
  const x = (r.minX + r.maxX) / 2
  const z = (r.minZ + r.maxZ) / 2
  return w >= d
    ? { x, z, w, d, floors, style: 'wall', tint }
    : { x, z, w: d, d: w, floors, style: 'wall', tint, rot: 90 }
}
