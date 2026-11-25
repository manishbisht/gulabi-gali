import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { DistrictId } from '../net/protocol'
import { BENCH_RANGE, benchesOf } from './benches'
import {
  buildPitch,
  createPitch,
  cricketPlayed,
  kidGeometry,
  onCricketPlayed,
  pitchColliders,
  pitchDistance,
  pitchFrame,
  pitchNear,
  PITCH_RANGE,
} from './cricketPitch'
import { DISTRICTS, loadDistrict, type District } from './district'
import { MOUNT_RANGE } from './driving'
import { WALL_RANGE, wallsOf } from './posters'
import { STAIR_RANGE } from './rooftop'
import { TAXI } from './taxi'
import type { AABB, PitchDef, Vec2 } from './types'
import { STATION_RANGE } from './useTravel'

const PITCH: PitchDef = { stumps: { x: 10, z: 5 }, bowler: { x: 10, z: 12 } }

describe('the pitch', () => {
  it('measures from the line between the stumps and the bowler', () => {
    expect(pitchDistance(PITCH, { x: 10, z: 8 })).toBe(0)
    expect(pitchDistance(PITCH, { x: 12, z: 8 })).toBeCloseTo(2)
    expect(pitchDistance(PITCH, { x: 10, z: 2 })).toBeCloseTo(3) // behind the stumps: from the stumps
    expect(pitchDistance(PITCH, { x: 13, z: 16 })).toBeCloseTo(5) // past the bowler: from the bowler
    expect(pitchNear({ cricket: PITCH }, { x: 12, z: 8 })).toBe(true)
    expect(pitchNear({ cricket: PITCH }, { x: 13, z: 8 })).toBe(false)
    expect(pitchNear({}, { x: 10, z: 8 })).toBe(false) // a district with no pitch
  })

  it('has its own axes: from the stumps toward the bowler', () => {
    expect(pitchFrame(PITCH)).toEqual({ x: 10, z: 5, fx: 0, fz: 1, length: 7 })
    const west = pitchFrame({ stumps: { x: 0, z: 0 }, bowler: { x: -6, z: 0 } })
    expect(west.fx).toBe(-1)
    expect(west.length).toBe(6)
  })

  it('is two meshes with one material, the kid at the far end facing the bat, and two small colliders', () => {
    const g = buildPitch({ stumps: { x: 0, z: 0 }, bowler: { x: -7, z: 0 } })
    const meshes = g.children as THREE.Mesh[]
    expect(meshes.map((m) => m.name)).toEqual(['cricket-pitch', 'cricket-bowler'])
    expect(meshes[0]!.material).toBe(meshes[1]!.material)
    g.updateMatrixWorld(true)
    const kid = new THREE.Vector3().setFromMatrixPosition(meshes[1]!.matrixWorld)
    expect(kid.x).toBeCloseTo(-7)
    expect(kid.z).toBeCloseTo(0)
    // the chalk and bricks stay within the strip, turned to lie along the lane
    const box = new THREE.Box3().setFromObject(meshes[0]!)
    expect(box.min.x).toBeGreaterThan(-7)
    expect(box.max.x).toBeLessThan(0.3)
    expect(Math.max(-box.min.z, box.max.z)).toBeLessThan(1)
    expect(box.max.y).toBeLessThan(0.6) // the brick stack: knee-high stumps
    const cs = pitchColliders({ stumps: { x: 0, z: 0 }, bowler: { x: -7, z: 0 } })
    expect(cs).toHaveLength(2)
    for (const c of cs) expect(c.maxX - c.minX).toBe(0.5)
    // cheap: the whole pitch and the kid are a few hundred triangles
    const tris = meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0)
    expect(tris).toBeLessThan(400)
    const kidBox = new THREE.Box3().setFromBufferAttribute(
      kidGeometry().getAttribute('position') as THREE.BufferAttribute,
    )
    expect(kidBox.max.y).toBeGreaterThan(1.1)
    expect(kidBox.max.y).toBeLessThan(1.3)
  })

  it('says when the player comes up and goes, once each, and that it left', () => {
    const hooks = { near: vi.fn(), play: vi.fn(), left: vi.fn() }
    const p = createPitch(PITCH, hooks)
    p.update({ x: 30, z: 30 })
    expect(hooks.near).not.toHaveBeenCalled()
    p.update({ x: 11, z: 8 })
    p.update({ x: 11, z: 9 })
    expect(hooks.near.mock.calls).toEqual([[true]])
    p.update({ x: 20, z: 9 })
    expect(hooks.near.mock.calls).toEqual([[true], [false]])
    p.update({ x: 11, z: 9 })
    p.dispose()
    expect(hooks.near.mock.calls).toEqual([[true], [false], [true], [false]])
    expect(hooks.left).toHaveBeenCalledTimes(1)
  })

  it('tells whoever listens that a round ended, and a broken listener stops nobody', () => {
    const heard: number[] = []
    const off1 = onCricketPlayed(() => {
      throw new Error('broken')
    })
    const off2 = onCricketPlayed((runs) => heard.push(runs))
    cricketPlayed(23)
    off2()
    off1()
    cricketPlayed(4)
    expect(heard).toEqual([23])
  })
})

/*
 * Where the pitches are chalked, read from the district defs: adding one elsewhere is data only, and this says
 * whether the spot will do. A pitch must not put "Cricket khelo" where another prompt already is (a landmark's
 * ring, a bench, an auto, the metro, a poster wall, the stair), nor stand in anyone's way.
 */

const loaded = new Map<DistrictId, Promise<District>>()
const load = (id: DistrictId) => {
  if (!loaded.has(id)) loaded.set(id, loadDistrict(id))
  return loaded.get(id)!
}
const inside = (p: Vec2, a: AABB) => p.x > a.minX && p.x < a.maxX && p.z > a.minZ && p.z < a.maxZ
const same = (a: AABB, b: AABB) =>
  a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ
/** Points every half metre along a path (closed when `loop`). */
function along(route: readonly Vec2[], loop: boolean): Vec2[] {
  const out: Vec2[] = []
  const n = loop ? route.length : route.length - 1
  for (let i = 0; i < n; i++) {
    const a = route[i]!
    const b = route[(i + 1) % route.length]!
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5))
    for (let s = 0; s <= steps; s++)
      out.push({ x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps })
  }
  return out
}

describe('where the pitches are', () => {
  it('in a lane of the Walled City, MI Road and Malviya Nagar at least', async () => {
    for (const id of ['walled-city', 'mi-road', 'malviya-nagar'] as const)
      expect((await load(id)).def.cricket, id).toBeDefined()
  })

  it.each(DISTRICTS)(
    '%s: its pitch, if it has one, is clear of everything else on the street',
    async (id) => {
      const d = await load(id)
      const pitch = d.def.cricket
      if (!pitch) return
      const f = pitchFrame(pitch)
      const fouls: string[] = []
      if (f.length < 6 || f.length > 8) fouls.push(`${f.length} m long (6 to 8)`)

      // the game's ground: from behind the stumps (where its camera stands) to past the bowler (its fielders),
      // 2.4 m either side, holds no collider but the pitch's own two
      const own = pitchColliders(pitch)
      const others = d.colliders.filter((c) => !own.some((o) => same(o, c)))
      expect(others.length).toBe(d.colliders.length - 2)
      for (let a = -2.5; a <= f.length + 5; a += 0.25)
        for (let s = -2.4; s <= 2.4; s += 0.2) {
          const p = { x: f.x + f.fx * a - f.fz * s, z: f.z + f.fz * a + f.fx * s }
          const hit = others.find((c) => inside(p, c))
          if (hit) fouls.push(`a collider on its ground at ${p.x.toFixed(1)},${p.z.toFixed(1)}`)
          if (hit) a = Infinity
          if (hit) break
        }

      // no other prompt within reach of anywhere "Cricket khelo" is offered
      const far = (what: string, at: Vec2, range: number) => {
        const gap = pitchDistance(pitch, at)
        if (gap <= range + PITCH_RANGE) fouls.push(`${what} is ${gap.toFixed(1)} m away`)
      }
      for (const l of d.def.landmarks) far(`landmark ${l.id}'s ring`, l.at, l.radius)
      for (const b of benchesOf(d.def)) far(`${b.kind} ${b.id}`, b.at, BENCH_RANGE)
      for (const p of d.def.props) if (p.kind === 'auto') far('a parked auto', p.at, MOUNT_RANGE)
      for (const s of TAXI[id].stands) far('a taxi stand', s, MOUNT_RANGE)
      for (const [to, drop] of Object.entries(TAXI[id].drops)) far(`the taxi drop by ${to}`, drop, 1)
      for (const w of wallsOf(d.def)) far(`poster wall ${w.index}`, w.at, WALL_RANGE)
      far('the station', d.def.station, STATION_RANGE)
      if (d.def.roof) far('the rooftop stair', d.def.roof.stair, STAIR_RANGE)
      for (const s of d.def.signposts ?? []) far('a signpost', s, 0)
      // nobody arrives standing on it, and no animal lives on it
      far('the spawn', d.def.spawn, 0)
      for (const a of [...d.def.animals.dogs, ...d.def.animals.cats, d.def.animals.cow])
        far('an animal', a, 0)
      // the procession passes clear of it, and no character walks through the stumps or the kid
      for (const p of along(d.def.processionRoute, true)) {
        if (pitchDistance(pitch, p) > 2.5) continue
        fouls.push('the procession crosses it')
        break
      }
      for (const n of d.def.npcs)
        for (const p of along(n.route, false)) {
          const gap = Math.min(
            Math.hypot(p.x - pitch.stumps.x, p.z - pitch.stumps.z),
            Math.hypot(p.x - pitch.bowler.x, p.z - pitch.bowler.z),
          )
          if (gap >= 1) continue
          fouls.push(`${n.id} walks into the stumps or the bowler`)
          break
        }
      expect(fouls).toEqual([])
    },
  )
})
