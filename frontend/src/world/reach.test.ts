import { describe, expect, it } from 'vitest'
import type { DistrictId } from '../net/protocol'
import { PLAYER_RADIUS } from '../player/player'
import { BENCH_RANGE, benchesOf } from './benches'
import { DISTRICTS, loadDistrict, type District } from './district'
import { byBus } from './metroRide'
import { WALL_RANGE, wallsOf } from './posters'
import { STAIR_RANGE } from './rooftop'
import { TAXI } from './taxi'
import type { AABB, Vec2 } from './types'
import { STATION_RANGE } from './useTravel'

/*
 * Every place a district asks the player to walk to can be walked to from where they start: a flood fill over a
 * grid of the street, a player's width clear of every collider (buildings, landmarks, props, the stair, water,
 * the boundary), out from the spawn. A prop set down against the wrong wall, or a gap left too narrow, shows up
 * here as a place nobody can reach on foot.
 */

/** The grid's step, in metres. Two free cells one step apart are joined by a free straight line: every collider,
 * grown by the player's radius, is at least twice that radius (0.8 m) across, more than a step. */
const STEP = 0.5

interface Walkable {
  /** Whether the cell holding `p` is reachable on foot from the spawn. */
  reached(p: Vec2): boolean
  /** Whether some reachable cell lies within `range` of `at` (and passes `where`, when given). */
  near(at: Vec2, range: number, where?: (p: Vec2) => boolean): boolean
}

/** The flood fill: blocked cells from the colliders (the same test as `moveWithCollision`), then out from the spawn. */
function walkable(d: District): Walkable {
  const half = d.def.size / 2 + 2
  const n = Math.ceil((2 * half) / STEP) + 1
  const x0 = -half
  const at = (i: number) => x0 + i * STEP
  const index = (v: number) => Math.round((v - x0) / STEP)
  const blocked = new Uint8Array(n * n)
  const mark = (c: AABB) => {
    const [ax, bx] = [c.minX - PLAYER_RADIUS, c.maxX + PLAYER_RADIUS]
    const [az, bz] = [c.minZ - PLAYER_RADIUS, c.maxZ + PLAYER_RADIUS]
    for (let i = Math.max(0, index(ax) - 1); i <= Math.min(n - 1, index(bx) + 1); i++) {
      const x = at(i)
      if (!(x > ax && x < bx)) continue
      for (let j = Math.max(0, index(az) - 1); j <= Math.min(n - 1, index(bz) + 1); j++) {
        const z = at(j)
        if (z > az && z < bz) blocked[i * n + j] = 1
      }
    }
  }
  for (const c of d.colliders) mark(c)
  // Beyond the outer boundary is not the street.
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (Math.abs(at(i)) > d.def.size / 2 + 1 || Math.abs(at(j)) > d.def.size / 2 + 1) blocked[i * n + j] = 1

  // The spawn's own cell, or the nearest free one beside it (the spawn itself is clear: district.test.ts).
  const si = index(d.def.spawn.x)
  const sj = index(d.def.spawn.z)
  const seen = new Uint8Array(n * n)
  const queue: number[] = []
  for (const [di, dj] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const k = (si + di) * n + (sj + dj)
    if (!blocked[k]) {
      seen[k] = 1
      queue.push(k)
      break
    }
  }
  expect(queue.length, `${d.def.id}: the spawn has a free cell`).toBe(1)
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q]!
    const i = Math.floor(k / n)
    const j = k % n
    for (const [ni, nj] of [
      [i + 1, j],
      [i - 1, j],
      [i, j + 1],
      [i, j - 1],
    ] as const) {
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue
      const m = ni * n + nj
      if (seen[m] || blocked[m]) continue
      seen[m] = 1
      queue.push(m)
    }
  }

  return {
    reached: (p) => {
      // the cells round the point: an exact spot (a taxi drop) may sit between grid points
      for (const i of [Math.floor((p.x - x0) / STEP), Math.ceil((p.x - x0) / STEP)])
        for (const j of [Math.floor((p.z - x0) / STEP), Math.ceil((p.z - x0) / STEP)])
          if (i >= 0 && j >= 0 && i < n && j < n && seen[i * n + j]) return true
      return false
    },
    near: (c, range, where) => {
      for (let i = Math.max(0, index(c.x - range)); i <= Math.min(n - 1, index(c.x + range)); i++)
        for (let j = Math.max(0, index(c.z - range)); j <= Math.min(n - 1, index(c.z + range)); j++) {
          if (!seen[i * n + j]) continue
          const p = { x: at(i), z: at(j) }
          if (Math.hypot(p.x - c.x, p.z - c.z) <= range && (!where || where(p))) return true
        }
      return false
    },
  }
}

const loaded = new Map<DistrictId, Promise<District>>()
const load = (id: DistrictId) => {
  if (!loaded.has(id)) loaded.set(id, loadDistrict(id))
  return loaded.get(id)!
}

/** The side a prop turned `rot` degrees faces (its front is its +z), as `seatPose` and `besideProp` turn it. */
const facing = (rot: number) => {
  const a = (-rot * Math.PI) / 180
  return { x: Math.sin(a), z: Math.cos(a) }
}

describe('on foot from the spawn', () => {
  it('covers Amer, Nahargarh, Galta Ji and every other district', () => {
    expect(DISTRICTS).toContain('amer')
    expect(DISTRICTS).toContain('nahargarh')
    expect(DISTRICTS).toContain('galta')
  })

  it.each(DISTRICTS)(
    '%s: every seat, landmark, taxi drop, poster wall, stair and the station or bus stand',
    async (id) => {
      const d = await load(id)
      const walk = walkable(d)
      const missed: string[] = []
      for (const b of benchesOf(d.def))
        if (!walk.near(b.at, BENCH_RANGE)) missed.push(`${b.kind} ${b.id} at ${b.at.x},${b.at.z}`)
      for (const l of d.def.landmarks) if (!walk.near(l.at, l.radius)) missed.push(`landmark ${l.id}'s ring`)
      for (const [landmark, drop] of Object.entries(TAXI[id].drops))
        if (!walk.reached(drop)) missed.push(`taxi drop by ${landmark} at ${drop.x},${drop.z}`)
      for (const w of wallsOf(d.def)) {
        // in front of it, where its posters face
        const front = facing(w.rot)
        const ahead = (p: Vec2) => (p.x - w.at.x) * front.x + (p.z - w.at.z) * front.z > 0
        if (!walk.near(w.at, WALL_RANGE, ahead)) missed.push(`poster wall ${w.index}'s front`)
      }
      if (d.def.roof && !walk.near(d.def.roof.stair, STAIR_RANGE)) missed.push("the rooftop stair's foot")
      if (!walk.near(d.def.station, STATION_RANGE)) missed.push(byBus(id) ? 'the bus stand' : 'the metro')
      // the cricket pitch: both its ends can be walked up to
      for (const end of d.def.cricket ? [d.def.cricket.stumps, d.def.cricket.bowler] : [])
        if (!walk.near(end, 1.5)) missed.push(`the cricket pitch at ${end.x},${end.z}`)
      expect(missed).toEqual([])
    },
  )
})
