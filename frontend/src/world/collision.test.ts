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
    // nearest face is +x: out that way, up to the next wall
    expect(moveWithCollision({ x: 0.5, z: 0 }, { x: 2, z: 0 }, box, 0.4)).toEqual({ x: 2.5, z: 0 })
    // but never deeper in
    expect(moveWithCollision({ x: 0.5, z: 0 }, { x: -0.5, z: 0 }, box, 0.4)).toEqual({ x: 0.5, z: 0 })
  })

  describe('starting just inside a face, the walker never gets further in', () => {
    const r = 0.4
    const box = [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }]
    const edge = 1 + r // the box's faces, grown by the walker's radius
    // per face: the outward axis and sign
    const faces = [
      { name: '-x', axis: 'x', sign: -1 },
      { name: '+x', axis: 'x', sign: 1 },
      { name: '-z', axis: 'z', sign: -1 },
      { name: '+z', axis: 'z', sign: 1 },
    ] as const
    for (const { name, axis, sign } of faces) {
      it(`${name}: walking in stays put, walking out leaves by that face and stays out`, () => {
        const other = axis === 'x' ? 'z' : 'x'
        const start = { [axis]: sign * (edge - 0.05), [other]: 0.3 } as { x: number; z: number }
        const inward = { [axis]: -sign * 0.1, [other]: 0 } as { x: number; z: number }
        let at = start
        for (let i = 0; i < 60; i++) {
          at = moveWithCollision(at, inward, box, r)
          // never further in than it started, let alone out the far side
          expect(sign * at[axis]).toBeGreaterThanOrEqual(sign * start[axis] - 1e-9)
        }
        expect(at).toEqual(start)
        // a step out leaves by the near face; walking back in then stops at it
        at = moveWithCollision(at, { [axis]: sign * 0.2, [other]: 0 } as { x: number; z: number }, box, r)
        expect(sign * at[axis]).toBeGreaterThanOrEqual(edge)
        for (let i = 0; i < 60; i++) at = moveWithCollision(at, inward, box, r)
        expect(sign * at[axis]).toBeCloseTo(edge)
      })
    }

    it('a slow walk across a building from just inside it never comes out the far side', () => {
      let at = { x: -0.9, z: 0 }
      for (let i = 0; i < 100; i++) at = moveWithCollision(at, { x: 0.1, z: 0 }, box, r)
      expect(at.x).toBeLessThanOrEqual(-0.9)
    })
  })

  it('moves freely with no colliders in the way', () => {
    expect(moveWithCollision({ x: -3, z: 0 }, { x: 0.3, z: -0.2 }, wall, 0.4)).toEqual({ x: -2.7, z: -0.2 })
  })
})
