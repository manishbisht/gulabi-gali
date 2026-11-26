import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  CALL_RANGE,
  CHEW_S,
  COW_LINES,
  FED_LINES,
  FOLLOW_GAP,
  PET_S,
  WAIT_MS,
  createAnimals,
  createStationMemory,
  type AnimalHooks,
  type Animals,
} from './animals'
import { DISTRICTS, loadDistrict } from './district'
import { onTouched, type Touched } from './touched'
import type { AABB, DistrictDef, Vec2 } from './types'

/** A district with nothing in it but its animals: a station, a spawn and a handful of animals on open ground. */
const def = {
  id: 'walled-city',
  station: { x: 50, z: 0 },
  animals: {
    dogs: [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 8, z: 0 },
      { x: 12, z: 0 },
    ],
    cats: [
      { x: 0, z: 6 },
      { x: 4, z: 6 },
    ],
    cow: { x: 0, z: -6 },
  },
} as unknown as DistrictDef

const FRAME = 1 / 30
const walk = (a: Animals, player: Vec2, to: Vec2, seconds: number, speed = 4) => {
  for (let t = 0; t < seconds; t += FRAME) {
    const dx = to.x - player.x
    const dz = to.z - player.z
    const d = Math.hypot(dx, dz)
    const step = Math.min(d, speed * FRAME)
    if (d > 0) {
      player.x += (dx / d) * step
      player.z += (dz / d) * step
    }
    a.update(FRAME, player)
  }
}
const make = (
  opts: {
    colliders?: AABB[]
    memory?: ReturnType<typeof createStationMemory>
    hooks?: AnimalHooks
    reducedMotion?: boolean
    play?: (sound: string) => void
  } = {},
) => {
  const scene = new THREE.Group()
  return { scene, a: createAnimals(def, scene, { colliders: opts.colliders ?? [], ...opts }) }
}
const where = (a: Animals, id: string) => a.list().find((e) => e.id === id)!
const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.z - q.z)

describe('street animals', () => {
  it('has 3-5 dogs, 2-3 cats and a cow, each with a name', () => {
    const { a } = make()
    const kinds = a.list().map((e) => e.kind)
    expect(kinds.filter((k) => k === 'dog')).toHaveLength(4)
    expect(kinds.filter((k) => k === 'cat')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'cow')).toHaveLength(1)
    const names = a.list().map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
    expect(a.list().every((e) => e.name.length > 0)).toBe(true)
    a.dispose()
  })

  it('follows at 1.5 m', () => {
    const { a } = make()
    const me = { x: 1, z: 0 }
    const result = a.call(me)
    expect(result?.kind).toBe('follow')
    const id = a.following()!
    expect(id).toBe(where(a, id).id)
    walk(a, me, { x: 40, z: 0 }, 12) // out along the street
    expect(dist(where(a, id), me)).toBeCloseTo(FOLLOW_GAP, 1)
    // and it stays there when the player stands still
    walk(a, me, me, 3)
    expect(dist(where(a, id), me)).toBeCloseTo(FOLLOW_GAP, 1)
    a.dispose()
  })

  it('catches up at a trot when far behind', () => {
    const { a } = make()
    const me = { x: 1, z: 0 }
    a.call(me)
    const id = a.following()!
    me.x = 0
    me.z = 30 // 30 m away: past the 20 m line
    const before = dist(where(a, id), me)
    a.update(1, me)
    const gained = before - dist(where(a, id), me)
    expect(gained).toBeGreaterThan(8) // two times the 4.4 m/s of an ordinary follow
    expect(gained).toBeLessThanOrEqual(8.9)
    a.dispose()
  })

  it('snaps in behind the player when more than 40 m behind', () => {
    const { a } = make()
    const me = { x: 1, z: 0 }
    a.call(me)
    const id = a.following()!
    me.x = 200
    me.z = 0
    a.update(FRAME, me)
    expect(dist(where(a, id), me)).toBeLessThanOrEqual(FOLLOW_GAP + 0.01)
    a.dispose()
  })

  it('a follower pinned on a wall is set down behind the player within a couple of seconds', () => {
    // a long wall between the dog and the player, who walks round the end of it and stands still
    const wallBox: AABB = { minX: 1.5, maxX: 2.5, minZ: -30, maxZ: 3 }
    const { a } = make({ colliders: [wallBox] })
    const me = { x: 1, z: 0 }
    a.call(me)
    const id = a.following()!
    me.x = 6 // across the wall, the dog on its other face
    me.z = 0
    a.update(FRAME, me)
    walk(a, me, me, 2.5)
    expect(dist(where(a, id), me)).toBeLessThan(3)
    a.dispose()
  })

  it('never lets a follower into a collider', () => {
    const wallBox: AABB = { minX: 10, maxX: 12, minZ: -50, maxZ: 50 }
    const { a } = make({ colliders: [wallBox] })
    const me = { x: 1, z: 0 }
    a.call(me)
    const id = a.following()!
    walk(a, me, { x: 8, z: 40 }, 15)
    const p = where(a, id)
    expect(p.x < wallBox.minX || p.x > wallBox.maxX).toBe(true)
    a.dispose()
  })

  it('cow ignores call, with a fresh line each time', () => {
    const hooks = { near: vi.fn(), following: vi.fn(), notice: vi.fn() }
    const { a } = make({ hooks })
    const me = { x: 0, z: -4.5 }
    const lines = new Set<number>()
    for (let i = 0; i < COW_LINES; i++) {
      const r = a.call(me)
      expect(r?.kind).toBe('cow')
      if (r?.kind === 'cow') lines.add(r.line)
    }
    expect(lines.size).toBe(COW_LINES)
    expect(a.following()).toBeNull()
    a.dispose()
  })

  it('calls nothing out of reach', () => {
    const { a } = make()
    expect(a.call({ x: 30, z: 30 })).toBeNull()
    expect(a.nearest({ x: 0, z: 0 }, CALL_RANGE)?.kind).toBe('dog')
    a.dispose()
  })

  it('has one follower at a time: the first goes home', () => {
    const hooks = { near: vi.fn(), following: vi.fn(), notice: vi.fn() }
    const { a } = make({ hooks })
    const me = { x: 2, z: 0 } // within reach of the dogs at x = 0 and x = 4
    a.call(me)
    const first = a.following()!
    // beside the dog at x = 8, and not the first
    me.x = 7
    const second = 'walled-city-dog-2'
    expect(second).not.toBe(first)
    a.call(me, second)
    expect(a.following()).toBe(second)
    // the first walks back to where it lives, and does not trail the player
    const home = def.animals.dogs[Number(first.split('-').pop())]!
    walk(a, me, me, 20)
    expect(dist(where(a, first), home)).toBeLessThan(4)
    expect(a.list().filter((e) => e.following)).toHaveLength(1)
    a.dispose()
  })

  it('sends the follower home', () => {
    const { a } = make()
    const me = { x: 1, z: 0 }
    a.call(me)
    expect(a.following()).not.toBeNull()
    a.sendHome()
    expect(a.following()).toBeNull()
    a.dispose()
  })

  it('waits at the station during travel and rejoins within 10 minutes', () => {
    let now = 1_000_000
    const memory = createStationMemory(() => now)
    const first = make({ memory })
    const me = { x: 1, z: 0 }
    first.a.call(me)
    const id = first.a.following()!
    const waiting = first.a.beginTravel()
    expect(waiting?.id).toBe(id)
    expect(waiting?.name.length).toBeGreaterThan(0)
    first.a.dispose() // the district is torn down by the trip

    now += WAIT_MS - 1000 // back inside ten minutes
    const again = make({ memory })
    expect(again.a.following()).toBe(id)
    expect(dist(where(again.a, id), def.station)).toBeLessThan(10) // at the station, not at home
    again.a.dispose()
  })

  it('does not rejoin after 10 minutes', () => {
    let now = 1_000_000
    const memory = createStationMemory(() => now)
    const first = make({ memory })
    first.a.call({ x: 1, z: 0 })
    const id = first.a.following()!
    first.a.beginTravel()
    first.a.dispose()

    now += WAIT_MS + 1
    const again = make({ memory })
    expect(again.a.following()).toBeNull()
    const home = def.animals.dogs[Number(id.split('-').pop())]!
    expect(dist(where(again.a, id), home)).toBeLessThan(0.01)
    again.a.dispose()
  })

  it('an animal waiting in one district does not rejoin in another', () => {
    const memory = createStationMemory()
    const first = make({ memory })
    first.a.call({ x: 1, z: 0 })
    first.a.beginTravel()
    first.a.dispose()
    const other = createAnimals({ ...def, id: 'mi-road' } as DistrictDef, new THREE.Group(), {
      colliders: [],
      memory,
    })
    expect(other.following()).toBeNull()
    other.dispose()
  })

  it('wanders the same way every time, from a seed made of the district id', () => {
    const run = () => {
      const { a } = make()
      walk(a, { x: 100, z: 100 }, { x: 100, z: 100 }, 30)
      const out = a.list().map((e) => `${e.id}:${e.x.toFixed(3)},${e.z.toFixed(3)}`)
      a.dispose()
      return out
    }
    expect(run()).toEqual(run())
  })

  it('halves the population at tier 0, keeping a follower', () => {
    const { a } = make()
    expect(a.visibleCount()).toBe(7)
    a.call({ x: 4, z: 0 })
    const id = a.following()!
    a.setQuality(0)
    expect(a.visibleCount()).toBe(5) // half of each kind, and the follower though it would be hidden
    expect(a.list().find((e) => e.id === id)!.visible).toBe(true)
    a.setQuality(2)
    expect(a.visibleCount()).toBe(7)
    a.dispose()
  })

  it('stays at half at tier 0 after the follower is sent home', () => {
    const { a } = make()
    a.call({ x: 4, z: 0 }) // the dog in slot 1, hidden at tier 0 unless it follows
    a.setQuality(0)
    expect(a.visibleCount()).toBe(5)
    a.sendHome()
    expect(a.visibleCount()).toBe(4)
    a.dispose()
  })

  it('does not pick an animal a tap crosses from far away', () => {
    const { a } = make()
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0.35, -20), new THREE.Vector3(0, 0, 1))
    expect(a.pick(ray, { x: 0, z: 0 })?.kind).toBe('dog')
    expect(a.pick(ray, { x: 0, z: -20 })).toBeNull()
    a.dispose()
  })

  it('stays inside the budget: under 300 triangles a model, at most 3 draw calls', () => {
    const { a, scene } = make()
    const meshes: THREE.InstancedMesh[] = []
    scene.traverse((o) => o instanceof THREE.InstancedMesh && meshes.push(o))
    expect(meshes.length).toBeLessThanOrEqual(3)
    for (const m of meshes) {
      const g = m.geometry
      const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3
      expect(tris).toBeLessThan(300)
    }
    a.dispose()
  })

  it('takes everything it made out of the scene on dispose', () => {
    const { a, scene } = make()
    expect(scene.children.length).toBeGreaterThan(0)
    a.dispose()
    expect(scene.children).toHaveLength(0)
  })
})

describe('a kindness for each animal', () => {
  const hooks = () => ({ near: vi.fn(), following: vi.fn(), notice: vi.fn() })
  const heard = () => {
    const done: Touched[] = []
    return { done, off: onTouched((k) => done.push(k)) }
  }

  it('the cow takes a roti and chews it over: a line each time, and no second roti until she is done', () => {
    const h = hooks()
    const { done, off } = heard()
    const { a } = make({ hooks: h })
    const me = { x: 0, z: -4.5 }
    expect(a.feed(me)).toEqual({ line: 0 })
    expect(h.notice).toHaveBeenLastCalledWith({ kind: 'fed', line: 0 })
    // still chewing
    expect(a.feed(me)).toBeNull()
    walk(a, me, me, CHEW_S - 0.5)
    expect(a.feed(me)).toBeNull()
    walk(a, me, me, 0.6)
    const lines = new Set([0])
    for (let i = 1; i < FED_LINES; i++) {
      lines.add(a.feed(me)!.line)
      walk(a, me, me, CHEW_S + 0.1)
    }
    expect(lines.size).toBe(FED_LINES)
    expect(done).toEqual(Array(FED_LINES).fill('feed'))
    // she stays where she is, and follows nobody
    expect(where(a, 'walled-city-cow-0')).toMatchObject({ x: 0, z: -6, following: false })
    expect(a.following()).toBeNull()
    off()
    a.dispose()
  })

  it('a roti is for the cow only, and only within reach', () => {
    const h = hooks()
    const { a } = make({ hooks: h })
    a.freeze(true)
    expect(a.feed({ x: 1, z: 0 })).toBeNull() // beside a dog
    expect(a.feed({ x: 0, z: -6 - CALL_RANGE - 1 })).toBeNull()
    expect(a.feed({ x: 30, z: 30 }, 'walled-city-cow-0')).toBeNull()
    expect(a.feed({ x: 1, z: 0 }, 'walled-city-dog-0')).toBeNull()
    expect(h.notice).not.toHaveBeenCalled()
    a.dispose()
  })

  it('a dog or cat can be petted: it wriggles where it is, and is not called along', () => {
    const h = hooks()
    const { done, off } = heard()
    const { a, scene } = make({ hooks: h, reducedMotion: false })
    a.freeze(true)
    const me = { x: 1, z: 0 }
    const dogs = scene.getObjectByName('animals-dog') as THREE.InstancedMesh
    const turn = () => {
      const m = new THREE.Matrix4()
      dogs.getMatrixAt(0, m)
      return new THREE.Euler().setFromRotationMatrix(m, 'YXZ').y
    }
    a.update(FRAME, me)
    const rest = turn()
    const petted = a.pet(me)
    expect(petted).toMatchObject({ id: 'walled-city-dog-0', kind: 'dog' })
    expect(h.notice).toHaveBeenLastCalledWith({ kind: 'pet', animal: petted })
    expect(done).toEqual(['pet'])
    // one pat at a time
    expect(a.pet(me)).toBeNull()
    let wagged = 0
    for (let t = 0; t < PET_S - 0.2; t += FRAME) {
      a.update(FRAME, me)
      wagged = Math.max(wagged, Math.abs(turn() - rest))
    }
    expect(wagged).toBeGreaterThan(0.05)
    walk(a, me, me, 0.5)
    expect(turn()).toBeCloseTo(rest, 6)
    expect(a.following()).toBeNull()
    expect(h.following).not.toHaveBeenCalled()
    expect(where(a, 'walled-city-dog-0')).toMatchObject({ x: 0, z: 0 })
    expect(a.pet(me)).toMatchObject({ kind: 'dog' })
    // a cat too; the cow is fed, not petted
    expect(a.pet({ x: 0, z: 6.5 })).toMatchObject({ kind: 'cat' })
    expect(a.pet({ x: 0, z: -4.5 })).toBeNull()
    off()
    a.dispose()
  })

  it('a petted cat purrs; a dog does not', () => {
    const play = vi.fn()
    const { a } = make({ play })
    a.freeze(true)
    expect(a.pet({ x: 1, z: 0 })).toMatchObject({ kind: 'dog' })
    expect(play).not.toHaveBeenCalled()
    expect(a.pet({ x: 0, z: 6.5 })).toMatchObject({ kind: 'cat' })
    expect(play.mock.calls).toEqual([['purr']])
    a.dispose()
  })

  it('the follower can be petted too: in reach with no other animal nearer to hand, the buttons are for it', () => {
    const h = hooks()
    const { a } = make({ hooks: h })
    a.freeze(true)
    const me = { x: 1, z: 0 }
    a.call(me)
    const id = a.following()!
    // out along the street, away from everyone else: the follower is the one in reach
    walk(a, me, { x: 40, z: 0 }, 12)
    expect(h.near).toHaveBeenLastCalledWith(expect.objectContaining({ id }))
    expect(a.pet(me)).toMatchObject({ id })
    expect(a.following()).toBe(id) // petted, and still along
    // "Saath chalo" and E are not for it: there is nobody else to call
    expect(a.call(me)).toBeNull()
    expect(a.nearest(me, CALL_RANGE)).toBeNull()
    // beside another animal, the buttons are for that one
    walk(a, me, { x: 4, z: 6.5 }, 12)
    expect(h.near).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'walled-city-cat-1' }))
    walk(a, me, me, PET_S + 0.2)
    expect(a.pet(me)).toMatchObject({ id: 'walled-city-cat-1' })
    a.dispose()
  })

  it('under reduced motion the petted animal holds still (the emote and the line still say it)', () => {
    const { a, scene } = make({ reducedMotion: true })
    a.freeze(true)
    const me = { x: 1, z: 0 }
    const dogs = scene.getObjectByName('animals-dog') as THREE.InstancedMesh
    const read = () => {
      const m = new THREE.Matrix4()
      dogs.getMatrixAt(0, m)
      return m.elements.slice()
    }
    a.update(FRAME, me)
    const rest = read()
    expect(a.pet(me)).not.toBeNull()
    for (let t = 0; t < PET_S; t += FRAME) {
      a.update(FRAME, me)
      expect(read()).toEqual(rest)
    }
    a.dispose()
  })

  it('petting changes nothing about following: the follower still trails, and "Saath chalo" still calls', () => {
    const { a } = make()
    const me = { x: 1, z: 0 }
    a.pet(me)
    expect(a.call(me)?.kind).toBe('follow')
    const id = a.following()!
    walk(a, me, { x: 40, z: 0 }, 12)
    expect(dist(where(a, id), me)).toBeCloseTo(FOLLOW_GAP, 1)
    a.dispose()
  })

  it('says where an animal stands without allocating a list', () => {
    const { a } = make()
    const out = { x: 99, z: 99 }
    expect(a.at('walled-city-cow-0', out)).toBe(true)
    expect(out).toEqual({ x: 0, z: -6 })
    expect(a.at('nobody', out)).toBe(false)
    a.dispose()
  })
})

describe('district animals', () => {
  it.each(DISTRICTS)(
    "%s: the cow stands outside every landmark's ring, where her buttons can show",
    async (id) => {
      const d = await loadDistrict(id)
      // inside a ring the landmark's card has the screen, and "Gaay ko namaste" and "Roti khilao" are hidden
      const { cow } = d.def.animals
      /** How far she wanders from where she lives: she stands where she is. */
      const wander = 0
      for (const l of d.def.landmarks)
        expect(Math.hypot(cow.x - l.at.x, cow.z - l.at.z) - wander, l.id).toBeGreaterThan(l.radius)
      d.dispose()
    },
  )

  it.each(DISTRICTS)(
    '%s: spawn points, and every place they wander to, are clear of colliders',
    async (id) => {
      const d = await loadDistrict(id)
      const { dogs, cats, cow } = d.def.animals
      expect(dogs.length).toBeGreaterThanOrEqual(3)
      expect(dogs.length).toBeLessThanOrEqual(5)
      expect(cats.length).toBeGreaterThanOrEqual(2)
      expect(cats.length).toBeLessThanOrEqual(3)
      const clear = (p: Vec2, r: number) =>
        !d.colliders.some((c) => p.x > c.minX - r && p.x < c.maxX + r && p.z > c.minZ - r && p.z < c.maxZ + r)
      for (const p of [...dogs, ...cats, cow]) expect(clear(p, 0.5), `${p.x},${p.z}`).toBe(true)

      const scene = new THREE.Group()
      const a = createAnimals(d.def, scene, { colliders: d.colliders })
      const far = { x: 1000, z: 1000 }
      for (let t = 0; t < 120; t += 0.1) {
        a.update(0.1, far)
        for (const e of a.list()) expect(clear(e, 0.29), `${e.id} at ${e.x},${e.z}`).toBe(true)
      }
      a.dispose()
      d.dispose()
    },
  )
})
