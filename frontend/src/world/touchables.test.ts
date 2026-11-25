import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BENCH_RANGE } from './benches'
import { DISTRICTS, loadDistrict } from './district'
import { MOUNT_RANGE } from './driving'
import { footprint } from './kit'
import { WALL_RANGE } from './posters'
import { STAIR_RANGE } from './rooftop'
import { touchableColliders } from './touchableBoxes'
import {
  BELL_GAP_S,
  DIYAS_PER_STAND,
  FLIGHT_S,
  FLOCK,
  FLOCK_THIN,
  PUMP_S,
  STARTLE_RANGE,
  TOUCH_RANGE,
  createTouchables,
  createTouchMemory,
  type TouchableOptions,
} from './touchables'
import { onTouched, type Touched } from './touched'
import type { AABB, DistrictDef, TouchableSpec, Vec2 } from './types'
import { STATION_RANGE } from './useTravel'

const FRAME = 1 / 30
const BELL = { x: 0, z: 0 }
const PUMP = { x: 20, z: 0 }
const DIYAS = { x: 40, z: 0 }
const FLOCK_AT = { x: 0, z: 40 }
const FAR = { x: 200, z: 200 }
const def = {
  id: 'walled-city',
  touchables: [
    { kind: 'bell', at: BELL },
    { kind: 'pump', at: PUMP, rot: 90 },
    { kind: 'diyas', at: DIYAS },
    { kind: 'pigeons', at: FLOCK_AT },
  ],
} as unknown as DistrictDef

const offs: (() => void)[] = []
afterEach(() => {
  for (const off of offs.splice(0)) off()
})

function make(opts: Partial<TouchableOptions> & { night?: () => boolean } = {}) {
  const scene = new THREE.Group()
  const play = vi.fn()
  const near = vi.fn()
  const done: Touched[] = []
  offs.push(onTouched((k) => done.push(k)))
  const t = createTouchables(def, scene, {
    night: () => false,
    play,
    hooks: { near },
    reducedMotion: false,
    ...opts,
  })
  const run = (seconds: number, at: Vec2) => {
    for (let s = 0; s < seconds; s += FRAME) t.update(FRAME, at)
  }
  const mesh = (name: string) => scene.getObjectByName(name) as THREE.InstancedMesh
  /** Instance `i`'s place and size. */
  const instance = (name: string, i: number) => {
    const m = new THREE.Matrix4()
    mesh(name).getMatrixAt(i, m)
    return { p: new THREE.Vector3().setFromMatrixPosition(m) }
  }
  /** How many of a mesh's instances are drawn: a hidden one is scaled to nothing. */
  const shown = (name: string) => {
    const m = new THREE.Matrix4()
    let n = 0
    for (let i = 0; i < mesh(name).count; i++) {
      mesh(name).getMatrixAt(i, m)
      if (Math.abs(m.determinant()) > 1e-9) n++
    }
    return n
  }
  const state = (kind: string) => t.list().find((e) => e.kind === kind)!
  return { t, scene, play, near, done, run, mesh, instance, shown, state }
}

describe('the bell', () => {
  it('shows its prompt within reach, and rings once, gently: no second ring for three seconds', () => {
    const { t, play, near, done, run, state } = make()
    run(0.1, FAR)
    expect(near).not.toHaveBeenCalled()
    const me = { x: 0, z: TOUCH_RANGE - 0.5 }
    run(0.1, me)
    expect(near).toHaveBeenLastCalledWith({ id: 'walled-city-bell-0', kind: 'bell' })
    expect(t.touch(me)).toBe('bell')
    expect(state('bell').active).toBe(true)
    // hammering the button does nothing
    expect(t.touch(me)).toBeNull()
    run(BELL_GAP_S - 0.5, me)
    expect(t.touch(me)).toBeNull()
    expect(play.mock.calls).toEqual([['bell']])
    expect(done).toEqual(['bell'])
    run(0.6, me)
    expect(t.touch(me)).toBe('bell')
    expect(play).toHaveBeenCalledTimes(2)
    t.dispose()
  })

  it('swings and comes to rest where it hung', () => {
    const { t, run, mesh, state } = make()
    const me = { x: 0, z: 1.5 }
    const read = () => {
      const m = new THREE.Matrix4()
      mesh('touchables-bell').getMatrixAt(0, m)
      return m.elements.slice()
    }
    const rest = read()
    t.touch(me)
    run(0.3, me)
    expect(state('bell').active).toBe(true)
    expect(read()).not.toEqual(rest)
    run(4, me)
    expect(state('bell').active).toBe(false)
    expect(read()).toEqual(rest)
    t.dispose()
  })

  it('is out of reach from further off, and a far id is not rung', () => {
    const { t, play } = make()
    expect(t.touch({ x: 0, z: TOUCH_RANGE + 2 })).toBeNull()
    expect(t.touch({ x: 0, z: 30 }, 'walled-city-bell-0')).toBeNull()
    expect(play).not.toHaveBeenCalled()
    t.dispose()
  })
})

describe('the hand pump', () => {
  it('runs for a moment, and cannot be started again until it is done', () => {
    const { t, play, done, run, state, shown } = make()
    const me = { x: PUMP.x - 1.5, z: 0 }
    run(0.1, me)
    expect(shown('touchables-water')).toBe(0)
    expect(t.touch(me)).toBe('pump')
    expect(t.touch(me)).toBeNull()
    run(1, me)
    expect(state('pump').active).toBe(true)
    expect(shown('touchables-water')).toBeGreaterThan(0)
    run(PUMP_S, me)
    expect(state('pump').active).toBe(false)
    expect(shown('touchables-water')).toBe(0)
    expect(t.touch(me)).toBe('pump')
    expect(play.mock.calls).toEqual([['pump'], ['pump']])
    expect(done).toEqual(['pump', 'pump'])
    t.dispose()
  })

  it('has no water at tier 0', () => {
    const { t, run, shown } = make({ quality: 0 })
    const me = { x: PUMP.x - 1.5, z: 0 }
    t.touch(me)
    run(1, me)
    expect(shown('touchables-water')).toBe(0)
    t.setQuality(2)
    run(0.1, me)
    expect(shown('touchables-water')).toBeGreaterThan(0)
    t.dispose()
  })
})

describe('the diyas', () => {
  const me = { x: DIYAS.x, z: 1.5 }

  it('cannot be lit by day: no prompt, and a touch does nothing', () => {
    const { t, near, play, run, shown } = make({ night: () => false })
    run(0.1, me)
    expect(near).not.toHaveBeenCalled()
    expect(t.touch(me)).toBeNull()
    expect(t.touch(me, 'walled-city-diyas-0')).toBeNull()
    expect(play).not.toHaveBeenCalled()
    expect(shown('touchables-flame')).toBe(0)
    t.dispose()
  })

  it('are lit one at a time after sunset, until the stand is full; then the prompt goes', () => {
    let night = false
    const { t, near, done, run, shown, state } = make({ night: () => night })
    run(0.1, me)
    night = true // the sun goes down while the player stands there
    run(0.1, me)
    expect(near).toHaveBeenLastCalledWith({ id: 'walled-city-diyas-0', kind: 'diyas' })
    for (let i = 1; i <= DIYAS_PER_STAND; i++) {
      expect(t.touch(me)).toBe('diyas')
      expect(state('diyas').lit).toBe(i)
      expect(shown('touchables-flame')).toBe(i)
    }
    expect(t.touch(me)).toBeNull()
    run(0.1, me)
    expect(near).toHaveBeenLastCalledWith(null)
    expect(done).toEqual(Array(DIYAS_PER_STAND).fill('diyas'))
    // and they burn on after sunrise
    night = false
    run(0.5, me)
    expect(shown('touchables-flame')).toBe(DIYAS_PER_STAND)
    t.dispose()
  })

  it('stay lit for the visit: leaving the district and coming back finds them burning', () => {
    const memory = createTouchMemory()
    const first = make({ night: () => true, memory })
    first.t.touch(me)
    first.t.touch(me)
    first.t.dispose()
    const again = make({ night: () => true, memory })
    expect(again.state('diyas').lit).toBe(2)
    expect(again.shown('touchables-flame')).toBe(2)
    again.t.dispose()
    // another visit (a reload) starts dark
    const fresh = make({ night: () => true })
    expect(fresh.state('diyas').lit).toBe(0)
    fresh.t.dispose()
  })
})

describe('the pigeons', () => {
  const among = { x: FLOCK_AT.x + 1, z: FLOCK_AT.z }
  const heights = (m: ReturnType<typeof make>) =>
    Array.from({ length: FLOCK }, (_, i) => m.instance('touchables-pigeon', i).p.y)
  const places = (m: ReturnType<typeof make>) =>
    Array.from({ length: FLOCK }, (_, i) => m.instance('touchables-pigeon', i).p.clone())

  it('lift when walked into, wheel once and settle exactly where they stood', () => {
    const m = make()
    m.run(0.1, { x: FLOCK_AT.x, z: FLOCK_AT.z + STARTLE_RANGE + 3 })
    const before = places(m)
    expect(Math.max(...heights(m))).toBe(0)
    expect(m.shown('touchables-wing')).toBe(0) // folded on the ground
    expect(m.state('pigeons').active).toBe(false)
    m.run(0.1, among)
    expect(m.state('pigeons').active).toBe(true)
    expect(m.play.mock.calls).toEqual([['pigeons']])
    expect(m.done).toEqual(['pigeons'])
    m.run(FLIGHT_S / 2, among)
    expect(Math.min(...heights(m))).toBeGreaterThan(2)
    expect(m.shown('touchables-wing')).toBe(FLOCK)
    m.run(FLIGHT_S / 2 + 0.5, among)
    expect(m.state('pigeons').active).toBe(false)
    const after = places(m)
    for (let i = 0; i < FLOCK; i++) expect(after[i]!.distanceTo(before[i]!)).toBeLessThan(1e-6)
    expect(m.shown('touchables-wing')).toBe(0)
    m.t.dispose()
  })

  it('do not go up again while the player stands among them, only after stepping away and back', () => {
    const m = make()
    m.run(FLIGHT_S + 3, among)
    expect(m.play).toHaveBeenCalledTimes(1)
    m.run(0.5, { x: FLOCK_AT.x, z: FLOCK_AT.z + STARTLE_RANGE + 3 })
    m.run(0.5, among)
    expect(m.play).toHaveBeenCalledTimes(2)
    m.t.dispose()
  })

  it('is a smaller flock at tier 0', () => {
    const m = make({ quality: 0 })
    expect(m.shown('touchables-pigeon')).toBe(FLOCK_THIN)
    m.t.setQuality(1)
    expect(m.shown('touchables-pigeon')).toBe(FLOCK)
    m.t.dispose()
  })

  it('under reduced motion they hop aside instead of wheeling, and come back once the player has gone', () => {
    const m = make({ reducedMotion: true })
    m.run(0.1, FAR)
    const before = places(m)
    let highest = 0
    for (let s = 0; s < 3; s += FRAME) {
      m.t.update(FRAME, among)
      highest = Math.max(highest, ...heights(m))
    }
    expect(highest).toBeLessThan(0.2)
    expect(highest).toBeGreaterThan(0)
    expect(m.state('pigeons').active).toBe(true)
    expect(m.shown('touchables-wing')).toBe(0)
    // every bird moved away from the player, by the same short step
    const moved = places(m).map((p, i) => p.distanceTo(before[i]!))
    for (const d of moved) expect(d).toBeCloseTo(1.5, 5)
    m.run(3, FAR)
    expect(m.state('pigeons').active).toBe(false)
    const after = places(m)
    for (let i = 0; i < FLOCK; i++) expect(after[i]!.distanceTo(before[i]!)).toBeLessThan(1e-6)
    m.t.dispose()
  })
})

describe('the touchables as a whole', () => {
  it('draw with at most seven calls, and dispose takes everything off the street', () => {
    const { t, scene, near } = make()
    const group = scene.getObjectByName('touchables')!
    expect(group.children.length).toBeLessThanOrEqual(7)
    const geometries = group.children.map((c) => (c as THREE.Mesh).geometry)
    const freed = geometries.map((g) => vi.spyOn(g, 'dispose'))
    t.update(FRAME, { x: 0, z: 1 })
    expect(near).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'bell' }))
    t.dispose()
    expect(scene.getObjectByName('touchables')).toBeUndefined()
    for (const f of freed) expect(f).toHaveBeenCalled()
    expect(near).toHaveBeenLastCalledWith(null)
  })

  it('a district with none draws nothing and answers nothing', () => {
    const scene = new THREE.Group()
    const t = createTouchables({ id: 'galta' } as unknown as DistrictDef, scene, { night: () => true })
    t.update(FRAME, { x: 0, z: 0 })
    expect(t.near()).toBeNull()
    expect(t.touch({ x: 0, z: 0 })).toBeNull()
    expect(scene.getObjectByName('touchables')!.children).toHaveLength(0)
    t.dispose()
  })

  it('a tap picks the one the ray passes by, within reach only', () => {
    const { t } = make()
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1.7, 6), new THREE.Vector3(0, 0, -1))
    expect(t.pick(ray, { x: 0, z: 2 })).toEqual({ id: 'walled-city-bell-0', kind: 'bell' })
    expect(t.pick(ray, { x: 0, z: 6 })).toBeNull() // too far to reach
    const miss = new THREE.Raycaster(new THREE.Vector3(5, 1.7, 6), new THREE.Vector3(0, 0, -1))
    expect(t.pick(miss, { x: 0, z: 2 })).toBeNull()
    t.dispose()
  })

  it('the standing ones are solid, turned with their `rot`; the pigeons are not', () => {
    const boxes = touchableColliders(def.touchables)
    expect(boxes).toHaveLength(3)
    const pump = boxes[1]!
    // the pump is longer front to back; turned a quarter, that is along x
    expect(pump.maxX - pump.minX).toBeCloseTo(1.5)
    expect(pump.maxZ - pump.minZ).toBeCloseTo(0.7)
    expect(touchableColliders(undefined)).toEqual([])
  })
})

// ---- where they stand, from the districts' defs ------------------------------------------------------

const clearAt = (cs: AABB[], p: Vec2, r: number) =>
  !cs.some((c) => p.x > c.minX - r && p.x < c.maxX + r && p.z > c.minZ - r && p.z < c.maxZ + r)
const segment = (p: Vec2, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const l = dx * dx + dz * dz
  const k = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l)) : 0
  return Math.hypot(p.x - a.x - k * dx, p.z - a.z - k * dz)
}
const apart = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)
const same = (a: AABB, b: AABB) =>
  a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ
const name = (s: TouchableSpec) => `${s.kind} at ${s.at.x},${s.at.z}`

describe('where the touchables stand', () => {
  it.each(DISTRICTS)('%s has at least two kinds', async (id) => {
    const d = await loadDistrict(id)
    const kinds = new Set((d.def.touchables ?? []).map((s) => s.kind))
    expect(kinds.size).toBeGreaterThanOrEqual(2)
    d.dispose()
  })

  it('a temple bell hangs in the Walled City, at Amer and at Galta Ji, by a temple where there is one', async () => {
    for (const id of ['walled-city', 'amer', 'galta'] as const) {
      const d = await loadDistrict(id)
      const bells = (d.def.touchables ?? []).filter((s) => s.kind === 'bell')
      expect(bells.length, id).toBeGreaterThanOrEqual(1)
      const temples = d.def.buildings.filter((b) => b.style === 'temple').map(footprint)
      if (id !== 'walled-city')
        expect(
          bells.some((b) => !clearAt(temples, b.at, 8)),
          id,
        ).toBe(true)
      d.dispose()
    }
    // Galta Ji's is on the path before the main temple
    const galta = await loadDistrict('galta')
    const temple = galta.def.landmarks[0]!
    const bell = galta.def.touchables!.find((s) => s.kind === 'bell')!
    expect(apart(bell.at, temple.at)).toBeLessThan(temple.radius + 6)
    galta.dispose()
  })

  it.each(DISTRICTS)(
    '%s: each stands on open ground, clear of every ring and prompt it could fight',
    async (id) => {
      const d = await loadDistrict(id)
      const f = d.def
      const list = f.touchables ?? []
      const own = touchableColliders(list)
      // everything solid but the touchables themselves
      const solid = d.colliders.filter((c) => !own.some((o) => same(o, c)))
      expect(solid.length).toBe(d.colliders.length - own.length)
      const half = f.size / 2
      for (const s of list) {
        const at = s.at
        expect(Math.abs(at.x) < half - 4 && Math.abs(at.z) < half - 4, name(s)).toBe(true)
        if (s.kind === 'pigeons') {
          // an open square: room to stand, to step aside and to wheel
          expect(clearAt(solid, at, 4), name(s)).toBe(true)
          expect(apart(at, f.station), name(s)).toBeGreaterThan(STATION_RANGE + 2)
          continue
        }
        // room to walk up to it and round it
        expect(clearAt(solid, at, 1.2), name(s)).toBe(true)
        // outside every landmark's ring, with the whole of its own reach
        for (const l of f.landmarks)
          expect(apart(at, l.at), `${name(s)} in ${l.id}'s ring`).toBeGreaterThan(l.radius + TOUCH_RANGE)
        expect(apart(at, f.station), name(s)).toBeGreaterThan(STATION_RANGE + TOUCH_RANGE)
        for (const p of f.props) {
          const reach =
            p.kind === 'poster-wall'
              ? WALL_RANGE
              : p.kind === 'auto'
                ? MOUNT_RANGE
                : p.kind === 'bench' || p.kind === 'tapri'
                  ? BENCH_RANGE
                  : p.kind === 'tree' || p.kind === 'lamp'
                    ? -1
                    : STATION_RANGE
          expect(apart(at, p.at), `${name(s)} by a ${p.kind}`).toBeGreaterThan(reach + TOUCH_RANGE)
        }
        if (f.roof) expect(apart(at, f.roof.stair), name(s)).toBeGreaterThan(STAIR_RANGE + TOUCH_RANGE)
        for (const p of f.signposts ?? []) expect(apart(at, p), name(s)).toBeGreaterThan(2.5)
        // nobody's walk runs into it: the characters', and the festival procession's (1.3 m clear of every collider)
        for (const n of f.npcs)
          for (let i = 0; i + 1 < n.route.length; i++)
            expect(segment(at, n.route[i]!, n.route[i + 1]!), `${name(s)} on ${n.id}'s walk`).toBeGreaterThan(
              2,
            )
        const route = f.processionRoute
        for (let i = 0; i < route.length; i++)
          expect(segment(at, route[i]!, route[(i + 1) % route.length]!), name(s)).toBeGreaterThan(2.5)
        // not where an animal lives, or where anybody arrives
        for (const a of [...f.animals.dogs, ...f.animals.cats, f.animals.cow])
          expect(apart(at, a), name(s)).toBeGreaterThan(3)
        expect(apart(at, f.spawn), name(s)).toBeGreaterThan(2)
      }
      // and not on top of each other
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          expect(apart(list[i]!.at, list[j]!.at), `${name(list[i]!)} and ${name(list[j]!)}`).toBeGreaterThan(
            6,
          )
      d.dispose()
    },
  )

  it.each(DISTRICTS)('%s: every animal still has room to stand where it lives', async (id) => {
    const d = await loadDistrict(id)
    const own = touchableColliders(d.def.touchables)
    const { dogs, cats, cow } = d.def.animals
    for (const a of [...dogs, ...cats, cow]) expect(clearAt(own, a, 0.5)).toBe(true)
    d.dispose()
  })
})
