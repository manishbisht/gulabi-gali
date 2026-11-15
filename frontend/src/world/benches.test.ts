import { describe, expect, it } from 'vitest'
import { BENCH_SEATS } from '../net/protocol'
import { PLAYER_RADIUS, WALK_SPEED } from '../player/player'
import { BENCH_RANGE, benchesOf, nearestBench, seatPose } from './benches'
import { moveWithCollision } from './collision'
import { DISTRICTS, loadDistrict } from './district'
import { MOUNT_RANGE } from './driving'
import walledCity from './districts/walledCity'

describe('benches', () => {
  it('numbers the tapris and benches of a district in prop order', () => {
    const benches = benchesOf(walledCity)
    const props = walledCity.props.filter((p) => p.kind === 'tapri' || p.kind === 'bench')
    expect(benches.map((b) => b.id)).toEqual(props.map((_, n) => `walled-city:${n}`))
    expect(benches.map((b) => b.at)).toEqual(props.map((p) => p.at))
    expect(benches[0]).toEqual({ id: 'walled-city:0', kind: 'tapri', at: { x: -12, z: -12 }, rot: 45 })
  })

  it('finds the nearest bench within 2.5 m, and none further out', () => {
    const benches = benchesOf(walledCity)
    const tapri = benches[4]! // (-5.6, 36)
    expect(nearestBench({ x: -3.2, z: 36 }, benches)).toBe(tapri)
    expect(nearestBench({ x: -2.9, z: 36 }, benches)).toBeNull()
    expect(nearestBench(walledCity.spawn, benches)).toBeNull()
  })

  it('standing up from a Chaupar tapri seat walks off it, a frame at a time', async () => {
    const d = await loadDistrict('walled-city')
    // the two tapris turned 45° at Badi Chaupar: their loose boxes take in the seats in front of them
    for (const bench of benchesOf(d.def).slice(0, 2)) {
      expect(bench.rot % 90).not.toBe(0)
      for (let n = 0; n < BENCH_SEATS; n++) {
        let at: { x: number; z: number } = seatPose(bench, n)
        const ax = at.x - bench.at.x
        const az = at.z - bench.at.z
        const len = Math.hypot(ax, az)
        const frame = { x: (ax / len) * WALK_SPEED * (1 / 30), z: (az / len) * WALK_SPEED * (1 / 30) }
        for (let i = 0; i < 30; i++) at = moveWithCollision(at, frame, d.colliders, PLAYER_RADIUS)
        expect(Math.hypot(at.x - bench.at.x, at.z - bench.at.z), `${bench.id} seat ${n}`).toBeGreaterThan(
          BENCH_RANGE,
        )
      }
    }
    d.dispose()
  })

  it('every seat is in reach of its bench, apart from the others, and never a trap', async () => {
    for (const id of DISTRICTS) {
      const d = await loadDistrict(id)
      for (const bench of benchesOf(d.def)) {
        const seats = Array.from({ length: BENCH_SEATS }, (_, n) => seatPose(bench, n))
        for (const s of seats) {
          // close enough that sitting never counts as walking off (the server allows 3 m)
          expect(Math.hypot(s.x - bench.at.x, s.z - bench.at.z)).toBeLessThan(BENCH_RANGE - 0.5)
          expect(Math.abs(s.ry)).toBeLessThanOrEqual(Math.PI)
          // a sitter can always get up: walking straight off the bench takes them out of its reach
          const ax = s.x - bench.at.x
          const az = s.z - bench.at.z
          const len = Math.hypot(ax, az)
          const off = moveWithCollision(
            s,
            { x: (ax / len) * 3, z: (az / len) * 3 },
            d.colliders,
            PLAYER_RADIUS,
          )
          expect(Math.hypot(off.x - bench.at.x, off.z - bench.at.z), bench.id).toBeGreaterThan(BENCH_RANGE)
        }
        for (let i = 1; i < seats.length; i++)
          expect(Math.hypot(seats[i]!.x - seats[i - 1]!.x, seats[i]!.z - seats[i - 1]!.z)).toBeGreaterThan(
            0.4,
          )
      }
      d.dispose()
    }
  }, 30_000)
})

describe('seats and parked autos', () => {
  it('no seat is within reach of a parked auto, so seated and "Auto chalao" never share the bottom row', async () => {
    for (const id of DISTRICTS) {
      const d = await loadDistrict(id)
      const def = d.def
      const autos = def.props.filter((p) => p.kind === 'auto')
      expect(autos.length, id).toBeGreaterThan(0)
      for (const bench of benchesOf(def))
        for (let n = 0; n < BENCH_SEATS; n++) {
          const seat = seatPose(bench, n)
          for (const auto of autos)
            expect(
              Math.hypot(seat.x - auto.at.x, seat.z - auto.at.z),
              `${bench.id} seat ${n} by the auto at ${auto.at.x},${auto.at.z}`,
            ).toBeGreaterThan(MOUNT_RANGE)
        }
      d.dispose()
    }
  }, 30_000)
})
