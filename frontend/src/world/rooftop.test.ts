import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Controls } from '../player/controls'
import { createPlayer, PLAYER_RADIUS } from '../player/player'
import { benchesOf } from './benches'
import { DISTRICTS, loadDistrict, type District } from './district'
import { footprint } from './kit'
import { wallDistance, wallsOf } from './posters'
import {
  createRooftop,
  inside,
  MAX_HOP,
  ROOF_FADE_MS,
  roofHeight,
  roofOver,
  STAIR_RANGE,
  type RoofHooks,
} from './rooftop'
import type { AABB, BuildingSpec, DistrictDef, Vec2 } from './types'

/** The burst a walker gets after standing still, in metres: `SPEED_BURST_M` in backend/src/district.ts. */
const SERVER_BURST_M = 8

const loaded = new Map<string, Promise<District>>()
const load = (id: DistrictDef['id']) => {
  if (!loaded.has(id)) loaded.set(id, loadDistrict(id))
  return loaded.get(id)!
}
const overlaps = (a: AABB, b: AABB) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
const same = (a: AABB, b: AABB) =>
  a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)
const corners = (a: AABB, m = 0): Vec2[] => [
  { x: a.minX + m, z: a.minZ + m },
  { x: a.maxX - m, z: a.minZ + m },
  { x: a.minX + m, z: a.maxZ - m },
  { x: a.maxX - m, z: a.maxZ - m },
]

const HAVELI: BuildingSpec = { x: 0, z: 0, w: 10, d: 11, floors: 3, style: 'haveli' }

describe('roofOver', () => {
  it.each([0, 90, 180, 270] as const)(
    'turned %i°: the strip is on the roof at its front, the stair beside it on the street',
    (rot) => {
      for (const side of [1, -1] as const) {
        const b = { ...HAVELI, rot }
        const r = roofOver(b, side)
        const f = footprint(b)
        expect(r.y).toBeCloseTo(9.6)
        // the strip is inside the building, and runs along its front
        for (const c of corners(r.area)) expect(inside(c, f)).toBe(true)
        expect(inside(r.landing, r.area)).toBe(true)
        const front = { x: b.x + r.out.x * (b.d / 2), z: b.z + r.out.z * (b.d / 2) }
        expect(dist(r.landing, front)).toBeLessThan(b.d / 2)
        // the stair's foot and its flight are outside it, on the side `side` names
        expect(inside(r.stair, f, PLAYER_RADIUS)).toBe(false)
        expect(overlaps(r.flight, f)).toBe(false)
        const towards = (r.stair.x - b.x) * r.side.x + (r.stair.z - b.z) * r.side.z
        expect(towards).toBeGreaterThan(b.w / 2)
        expect(inside(r.stair, r.flight, PLAYER_RADIUS)).toBe(false)
      }
    },
  )

  it("climbing and coming down hop less than the server's speed check allows after standing still", () => {
    expect(MAX_HOP).toBeLessThan(SERVER_BURST_M)
    for (const style of ['haveli', 'shop', 'modern'] as const)
      for (const w of [7, 10, 14, 26])
        for (const side of [1, -1] as const) {
          const r = roofOver({ ...HAVELI, style, w }, side)
          // down: from anywhere on the strip to the foot
          for (const c of corners(r.area, PLAYER_RADIUS))
            expect(dist(r.stair, c)).toBeLessThanOrEqual(MAX_HOP)
          // up: from anywhere the climb is allowed to start, to the landing
          expect(dist(r.stair, r.landing) + STAIR_RANGE).toBeLessThanOrEqual(MAX_HOP)
        }
  })

  it('stands on the slab a shop or a modern block has on top', () => {
    expect(roofOver({ ...HAVELI, style: 'shop', floors: 2 }, 1).y).toBeCloseTo(6.85)
    expect(roofOver({ ...HAVELI, style: 'modern', floors: 3 }, 1).y).toBeCloseTo(9.9)
    expect(() => roofOver({ ...HAVELI, style: 'temple' }, 1)).toThrow()
    expect(() => roofOver({ ...HAVELI, w: 5 }, 1)).toThrow()
  })

  it('roofHeight: up on the strip, the roof; anywhere else, the street', () => {
    const r = roofOver(HAVELI, 1)
    expect(roofHeight(r, r.landing.x, r.landing.z)).toBeCloseTo(9.6)
    expect(roofHeight(r, r.stair.x, r.stair.z)).toBe(0)
    expect(roofHeight(undefined, r.landing.x, r.landing.z)).toBe(0)
  })
})

describe.each(DISTRICTS)('%s: its rooftop viewpoint', (id) => {
  it('has one, on a building of the district, with a stair that stands clear on the street', async () => {
    const d = await load(id)
    const roof = d.def.roof!
    expect(roof).toBeDefined()
    const own = d.def.buildings.map(footprint).find((f) => same(f, roof.building))
    expect(own).toBeDefined()
    // nothing but its own building is in the way of the flight, or of standing at its foot
    const others = d.colliders.filter((c) => !same(c, roof.building) && !same(c, roof.flight))
    for (const c of others) {
      expect(overlaps(roof.flight, c), JSON.stringify(c)).toBe(false)
      expect(inside(roof.stair, c, PLAYER_RADIUS)).toBe(false)
    }
    expect(inside(roof.stair, roof.flight, PLAYER_RADIUS)).toBe(false)
    // the flight is a collider: nobody walks through the steps
    expect(d.colliders).toContainEqual(roof.flight)
    expect(d.root.getObjectByName('roof-stair')).toBeDefined()
  })

  it('is out of reach of every other thing E opens, at the foot and up on the strip', async () => {
    const d = await load(id)
    const { def } = d
    const roof = def.roof!
    const spots = [roof.stair, roof.landing, ...corners(roof.area)]
    for (const p of spots) {
      for (const l of def.landmarks) expect(dist(p, l.at), l.id).toBeGreaterThan(l.radius + 1)
      expect(dist(p, def.station)).toBeGreaterThan(4 + 1)
      for (const b of benchesOf(def)) expect(dist(p, b.at), b.id).toBeGreaterThan(2.5 + 1)
      for (const w of wallsOf(def)) expect(wallDistance(p, w)).toBeGreaterThan(3 + 1)
      for (const a of def.props.filter((x) => x.kind === 'auto'))
        expect(dist(p, a.at)).toBeGreaterThan(2.5 + 1)
    }
  })
})

/** A player's body, stood on the roof by a fake, and what React was told. */
function setup(roof = roofOver(HAVELI, 1)) {
  const calls: string[] = []
  const hooks: RoofHooks = {
    near: (on) => calls.push(`near ${on}`),
    up: (on) => calls.push(`up ${on}`),
    fade: (on) => calls.push(`fade ${on}`),
  }
  let at: Vec2 = { x: 0, z: 0 }
  let floor: { y: number; walls: AABB[] } | null = null
  const player = {
    teleport: vi.fn((x: number, z: number) => void (at = { x, z })),
    setFloor: vi.fn((f: { y: number; walls: AABB[] } | null) => void (floor = f)),
  }
  const face = vi.fn()
  const top = createRooftop({ roof, player, hooks, face })
  return { roof, top, calls, player, face, at: () => at, floor: () => floor }
}

describe('createRooftop', () => {
  afterEach(() => vi.useRealTimers())

  it('up behind a fade, and down again to the same stair', () => {
    vi.useFakeTimers()
    const { roof, top, calls, at, floor, face } = setup()
    top.update({ x: roof.stair.x + STAIR_RANGE + 0.5, z: roof.stair.z })
    expect(top.near()).toBe(false)
    top.toggle() // out of reach: nothing
    expect(calls).toEqual([])
    top.update(roof.stair)
    expect(calls).toEqual(['near true'])
    top.toggle()
    expect(calls.at(-1)).toBe('fade true')
    top.toggle() // a second press under the fade does nothing
    vi.advanceTimersByTime(ROOF_FADE_MS)
    expect(top.up()).toBe(true)
    expect(at()).toEqual(roof.landing)
    expect(floor()!.y).toBe(roof.y)
    // facing out over the street: the view looks along `out`
    const yaw = face.mock.calls[0]![0] as number // the view looks along (-sin yaw, -cos yaw)
    expect(-Math.sin(yaw)).toBeCloseTo(roof.out.x)
    expect(-Math.cos(yaw)).toBeCloseTo(roof.out.z)
    vi.advanceTimersByTime(ROOF_FADE_MS)
    expect(calls).toEqual(['near true', 'fade true', 'near false', 'up true', 'fade false'])

    top.update(roof.landing)
    expect(top.near()).toBe(false)
    top.toggle()
    vi.advanceTimersByTime(2 * ROOF_FADE_MS)
    expect(top.up()).toBe(false)
    expect(at()).toEqual(roof.stair)
    expect(floor()).toBeNull()
    expect(calls.slice(5)).toEqual(['fade true', 'up false', 'fade false'])
    top.update(at())
    expect(top.near()).toBe(true)
  })

  it('never leaves the player in the air: moved off the strip (the server putting them back), they are down', () => {
    vi.useFakeTimers()
    const { roof, top, floor } = setup()
    top.update(roof.stair)
    top.toggle()
    vi.advanceTimersByTime(2 * ROOF_FADE_MS)
    top.update(roof.landing)
    expect(top.up()).toBe(true)
    top.update(roof.stair) // a 'too-fast' snap back to where the server last heard of them
    expect(top.up()).toBe(false)
    expect(floor()).toBeNull()
  })

  it('walking away from the foot while the screen goes dark climbs nothing (the hop up would be too long)', () => {
    vi.useFakeTimers()
    const { roof, top, calls, floor } = setup()
    top.update(roof.stair)
    top.toggle()
    top.update({
      x: roof.stair.x + roof.out.x * (STAIR_RANGE + 0.5),
      z: roof.stair.z + roof.out.z * (STAIR_RANGE + 0.5),
    })
    vi.advanceTimersByTime(2 * ROOF_FADE_MS)
    expect(top.up()).toBe(false)
    expect(floor()).toBeNull()
    expect(calls).toEqual(['near true', 'fade true', 'fade false'])
  })

  it('leaving the district mid-fade or up top tells React it is over', () => {
    vi.useFakeTimers()
    const { roof, top, calls } = setup()
    top.update(roof.stair)
    top.toggle()
    vi.advanceTimersByTime(ROOF_FADE_MS)
    top.dispose()
    expect(calls.slice(-2)).toEqual(['fade false', 'up false'])
    vi.advanceTimersByTime(ROOF_FADE_MS)
    expect(calls.at(-1)).toBe('up false')
  })
})

describe('up on the roof, with the real player', () => {
  /** Controls that push the stick one way and turn nothing. */
  function stick() {
    const move = { x: 0, z: 0 }
    const controls = {
      move: () => move,
      look: () => ({ yaw: 0, pitch: 0, held: false }),
      drive: () => ({ x: 0, z: 0 }),
    } as unknown as Controls
    return { controls, move }
  }

  it('cannot walk off the strip in any direction, and the camera rises with it', () => {
    const roof = roofOver(HAVELI, 1)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const { controls, move } = stick()
    // the street's colliders (the building itself among them) do not hold anyone up there
    const player = createPlayer({
      scene,
      camera,
      controls,
      look: { skin: 1, outfit: 'teal', head: 'none' },
      colliders: [footprint(HAVELI)],
      occluders: [footprint(HAVELI)],
    })
    const top = createRooftop({ roof, player, hooks: { near() {}, up() {}, fade() {} } })
    vi.useFakeTimers()
    top.update(roof.stair)
    top.toggle()
    vi.advanceTimersByTime(2 * ROOF_FADE_MS)
    vi.useRealTimers()
    expect(top.up()).toBe(true)
    expect(player.elevation()).toBeCloseTo(roof.y)
    for (const [x, z] of [
      [0, 1],
      [1, 1],
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, -1],
      [-1, 0],
      [-1, 1],
    ]) {
      move.x = x!
      move.z = z!
      for (let i = 0; i < 120; i++) {
        player.update(1 / 30)
        top.update(player.position())
      }
      const p = player.position()
      expect(inside(p, roof.area)).toBe(true)
      expect(top.up()).toBe(true)
    }
    // the camera is up there too, above the roof, and not pulled in to the player's head by the building
    expect(camera.position.y).toBeGreaterThan(roof.y + 2)
    expect(dist({ x: camera.position.x, z: camera.position.z }, player.position())).toBeGreaterThan(3)
    vi.useFakeTimers()
    top.toggle()
    vi.advanceTimersByTime(2 * ROOF_FADE_MS)
    vi.useRealTimers()
    expect(player.position()).toEqual(roof.stair)
    expect(player.elevation()).toBe(0)
    player.dispose()
  })
})
