import { describe, expect, it } from 'vitest'
import type { BuildingSpec, BuildingStyle } from './types'
import { buildBlock } from './kit'
import { PALETTE } from './palette'

const tris = (spec: BuildingSpec) => {
  const g = buildBlock([spec]).mesh.geometry
  return g.getAttribute('position').count / 3
}

describe('buildBlock', () => {
  it('merges a block into one mesh with colliders per building', () => {
    const { mesh, colliders } = buildBlock([
      { x: 0, z: 0, w: 10, d: 8, floors: 3, style: 'haveli' },
      { x: 20, z: 0, w: 6, d: 4, floors: 1, style: 'shop', rot: 90 },
    ])
    expect(mesh.geometry.getAttribute('color')).toBeTruthy()
    expect(Array.isArray(mesh.material)).toBe(false)
    expect(colliders).toEqual([
      { minX: -5, maxX: 5, minZ: -4, maxZ: 4 },
      { minX: 18, maxX: 22, minZ: -3, maxZ: 3 }, // rot 90 swaps w and d
    ])
  })

  it('haveli gets taller per floor', () => {
    const h = (f: 1 | 4) => {
      const g = buildBlock([{ x: 0, z: 0, w: 8, d: 8, floors: f, style: 'haveli' }]).mesh.geometry
      g.computeBoundingBox()
      return g.boundingBox!.max.y
    }
    expect(h(4)).toBeGreaterThan(h(1) + 9)
  })

  it('builds every style within a phone-friendly triangle budget', () => {
    const styles: BuildingStyle[] = ['haveli', 'shop', 'modern', 'temple', 'wall']
    for (const style of styles) {
      const n = tris({ x: 0, z: 0, w: 10, d: 8, floors: 3, style })
      expect(n).toBeGreaterThan(12)
      expect(n).toBeLessThan(400)
    }
  })

  it('keeps geometry inside the footprint (plus small overhangs) and bakes vertex colours', () => {
    const { mesh } = buildBlock([
      { x: 10, z: -6, w: 8, d: 6, floors: 2, style: 'haveli', tint: 'terracotta' },
    ])
    mesh.geometry.computeBoundingBox()
    const b = mesh.geometry.boundingBox!
    expect(b.min.x).toBeGreaterThan(10 - 4 - 1)
    expect(b.max.x).toBeLessThan(10 + 4 + 1)
    expect(b.min.y).toBeGreaterThan(-1e-3)
    const c = mesh.geometry.getAttribute('color')
    expect(c.count).toBe(mesh.geometry.getAttribute('position').count)
  })

  it('returns an empty-safe mesh for an empty block', () => {
    const { mesh, colliders } = buildBlock([])
    expect(colliders).toEqual([])
    expect(mesh.geometry.getAttribute('position').count).toBe(0)
  })

  it('exposes the Jaipur palette', () => {
    expect(PALETTE.pink).toBe('#E4917A')
  })
})
