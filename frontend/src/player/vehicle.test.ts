import { describe, expect, it } from 'vitest'
import type { AABB } from '../world/types'
import { AUTO_RADIUS, AUTO_SPEED, createVehicle, crosses } from './vehicle'

const box = (x: number, z: number, h = 0.5): AABB => ({ minX: x - h, maxX: x + h, minZ: z - h, maxZ: z + h })
const GAS = { x: 0, z: 1 }

/** The vehicle driven for `seconds` in steps of `dt`, as a frame loop would. */
function drive(input: { x: number; z: number }, seconds: number, dt: number, heading = 0) {
  const v = createVehicle('auto')
  v.reset(0, 0, heading)
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const step = v.update(input, dt)
    v.commit(v.x + step.x, v.z + step.z)
  }
  return v
}

describe('createVehicle', () => {
  it('speed caps at 12 m/s', () => {
    const v = createVehicle('auto')
    v.reset(0, 0, 0)
    let top = 0
    for (let i = 0; i < 600; i++) {
      const s = v.update(GAS, 1 / 60)
      v.commit(v.x + s.x, v.z + s.z)
      top = Math.max(top, v.speed)
    }
    expect(AUTO_SPEED).toBe(12)
    expect(top).toBeLessThanOrEqual(12)
    expect(v.speed).toBeCloseTo(12, 5)
    // and the step it asks for is no longer than that speed allows
    expect(Math.hypot(v.update(GAS, 1).x, v.update(GAS, 1).z)).toBeLessThanOrEqual(12 + 1e-9)
  })

  it('turning is frame-rate independent', () => {
    const input = { x: 1, z: 1 }
    const one = createVehicle('auto')
    const ten = createVehicle('auto')
    // already at full speed, so only the turning is compared
    for (const v of [one, ten]) v.reset(0, 0, 0, AUTO_SPEED)
    const s = one.update(input, 0.1)
    one.commit(one.x + s.x, one.z + s.z)
    for (let i = 0; i < 10; i++) {
      const t = ten.update(input, 0.01)
      ten.commit(ten.x + t.x, ten.z + t.z)
    }
    expect(Math.abs(one.heading)).toBeGreaterThan(0.05) // it did turn
    expect(one.heading).toBeCloseTo(ten.heading, 6)
    expect(one.x).toBeCloseTo(ten.x, 1)
    expect(one.z).toBeCloseTo(ten.z, 1)
  })

  it('steering right turns clockwise seen from above, and reverse works when pulling back', () => {
    const right = drive({ x: 1, z: 1 }, 1, 1 / 60)
    expect(right.heading).toBeLessThan(0) // +z ahead, screen-right is -x
    const back = drive({ x: 0, z: -1 }, 2, 1 / 60)
    expect(back.speed).toBeLessThan(0)
    expect(back.z).toBeLessThan(-1) // it went backwards
    expect(Math.abs(back.speed)).toBeLessThan(AUTO_SPEED)
  })

  it('cannot spin on the spot', () => {
    const v = drive({ x: 1, z: 0 }, 2, 1 / 60)
    expect(v.heading).toBe(0)
  })

  it('a wall stops it: committing a blocked step sheds the speed', () => {
    const v = createVehicle('auto')
    v.reset(0, 0, 0)
    for (let i = 0; i < 120; i++) {
      const s = v.update(GAS, 1 / 60)
      v.commit(v.x + s.x, v.z + s.z)
    }
    const s = v.update(GAS, 1 / 60)
    v.commit(v.x, v.z) // all of it blocked
    expect(s.z).toBeGreaterThan(0)
    expect(v.speed).toBe(0)
  })

  describe('crosses', () => {
    it("counts the walker's radius: a path grazing a wall end is a hit, a clear one is not", () => {
      const wall: AABB = { minX: 1, maxX: 1.1, minZ: 0.2, maxZ: 8 }
      // along z = 0 the line passes 0.2 m from the wall's end: no hit for a point, a hit for a 0.4 m walker
      expect(crosses(0, 0, 3, 0, wall)).toBe(false)
      expect(crosses(0, 0, 3, 0, wall, 0.4)).toBe(true)
      expect(crosses(0, -1, 3, -1, wall, 0.4)).toBe(false)
    })
  })

  describe('exitPoint', () => {
    it('avoids colliders and its own footprint', () => {
      const v = createVehicle('auto')
      v.reset(10, 10, 0)
      // walls close in on both sides, leaving the rear
      const around = [box(11.8, 10, 0.6), box(8.2, 10, 0.6), box(10, 12.5, 0.6)]
      const out = v.exitPoint(around)!
      expect(out).not.toBeNull()
      const r = 0.4
      for (const c of around)
        expect(out.x > c.minX - r && out.x < c.maxX + r && out.z > c.minZ - r && out.z < c.maxZ + r).toBe(
          false,
        )
      // clear of the auto itself (1.4 wide, 2.7 long, facing +z), which stays where it is left
      expect(Math.abs(out.x - 10) > 0.7 + r || Math.abs(out.z - 10) > 1.35 + r).toBe(true)
      const d = Math.hypot(out.x - 10, out.z - 10)
      expect(d).toBeGreaterThanOrEqual(1.2)
      expect(d).toBeLessThanOrEqual(3)
    })

    it('never sets the walker down through a thin wall into a pocket behind it', () => {
      const v = createVehicle('auto')
      v.reset(0, 0, 0)
      // a thin wall on each side, 1.5 m out: the points just beyond them are clear, but only through the wall
      const walls: AABB[] = [
        { minX: 1.45, maxX: 1.55, minZ: -8, maxZ: 8 },
        { minX: -1.55, maxX: -1.45, minZ: -8, maxZ: 8 },
      ]
      const out = v.exitPoint(walls)!
      expect(out).not.toBeNull()
      expect(Math.abs(out.x)).toBeLessThan(1.45)
      // and when the way out is walled in all round (an auto-sized box in a pocket), there is no point at all
      const pocket: AABB[] = [
        ...walls,
        { minX: -1.55, maxX: 1.55, minZ: 1.9, maxZ: 2.0 },
        { minX: -1.55, maxX: 1.55, minZ: -2.0, maxZ: -1.9 },
      ]
      expect(v.exitPoint(pocket)).toBeNull()
    })

    it('searches outward until it finds room, and gives up when there is none', () => {
      const v = createVehicle('auto')
      v.reset(0, 0, 0)
      // walls out to 6.5 m: nothing on any search ring is clear
      const wall: AABB[] = [{ minX: -6.5, maxX: 6.5, minZ: -6.5, maxZ: 6.5 }]
      expect(v.exitPoint(wall)).toBeNull()
      // a wall that covers only the near ring: found further out
      const near: AABB[] = [{ minX: -1.9, maxX: 1.9, minZ: -2.6, maxZ: 2.6 }]
      const out = v.exitPoint(near)!
      expect(out).not.toBeNull()
      expect(Math.hypot(out.x, out.z)).toBeGreaterThan(1.9)
    })

    it('widens to 6 m when everything within 3 m is blocked', () => {
      const v = createVehicle('auto')
      v.reset(0, 0, 0)
      const out = v.exitPoint([{ minX: -3.2, maxX: 3.2, minZ: -3.2, maxZ: 3.2 }])!
      expect(out).not.toBeNull()
      const d = Math.hypot(out.x, out.z)
      expect(d).toBeGreaterThan(3)
      expect(d).toBeLessThanOrEqual(6)
    })

    it('is a point the auto itself would not trap: exit beside a turned auto', () => {
      const v = createVehicle('auto')
      v.reset(0, 0, Math.PI / 2) // facing +x: long side along x
      const out = v.exitPoint([])!
      // never inside the turned footprint (2.7 along x, 1.4 along z)
      expect(Math.abs(out.x) > 1.35 + 0.4 || Math.abs(out.z) > 0.7 + 0.4).toBe(true)
    })
  })

  it('has the collision radius the plan asks for', () => {
    expect(AUTO_RADIUS).toBe(1.2)
  })
})
