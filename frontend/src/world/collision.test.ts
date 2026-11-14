import { describe, expect, it } from 'vitest'
import { moveWithCollision } from './collision'

const wall = [{ minX: 0, maxX: 1, minZ: -10, maxZ: 10 }]

describe('moveWithCollision', () => {
  it('stops at a wall and slides along it', () => {
    expect(moveWithCollision({ x: -1, z: 0 }, { x: 2, z: 1 }, wall, 0.4)).toEqual({ x: -0.4, z: 1 })
  })
  it('never crosses a collider in one step', () => {
    expect(moveWithCollision({ x: -1, z: 0 }, { x: 50, z: 0 }, wall, 0.4).x).toBeLessThanOrEqual(-0.4)
  })
  it('stops against the far side when walking back', () => {
    expect(moveWithCollision({ x: 3, z: 0 }, { x: -50, z: 2 }, wall, 0.4)).toEqual({ x: 1.4, z: 2 })
  })
  it('slides along z walls too', () => {
    const wallZ = [{ minX: -10, maxX: 10, minZ: 0, maxZ: 1 }]
    expect(moveWithCollision({ x: 0, z: -2 }, { x: 3, z: 9 }, wallZ, 0.5)).toEqual({ x: 3, z: -0.5 })
  })
  it('lets a walker who stands inside a collider walk out of it, and still stops at the others', () => {
    // A seat can sit inside a turned prop's loose box: standing up must not teleport through it.
    const box = [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, ...wall.map((w) => ({ ...w, minX: 3, maxX: 4 }))]
    expect(moveWithCollision({ x: 0.5, z: 0 }, { x: 2, z: 0 }, box, 0.4)).toEqual({ x: 2.5, z: 0 })
    expect(moveWithCollision({ x: 0.5, z: 0 }, { x: 0, z: 0.5 }, box, 0.4)).toEqual({ x: 0.5, z: 0.5 })
  })
  it('moves freely with no colliders in the way', () => {
    expect(moveWithCollision({ x: -3, z: 0 }, { x: 0.3, z: -0.2 }, wall, 0.4)).toEqual({ x: -2.7, z: -0.2 })
  })
})
