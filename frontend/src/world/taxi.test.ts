import * as THREE from 'three'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DistrictId } from '../net/protocol'
import { createControls } from '../player/controls'
import { createPlayer } from '../player/player'
import { AUTO_RADIUS, createVehicle, crosses } from '../player/vehicle'
import { ARRIVE_M, targetDistance } from './cityMap'
import { DISTRICTS, loadDistrict, type District } from './district'
import type { ParkedAutos } from './props'
import {
  APPROACH_M,
  createTaxi,
  TAXI,
  TAXI_CUT_MS,
  TAXI_FADE_MS,
  TAXI_RIDE_MS,
  taxiAvailable,
  type TaxiHooks,
} from './taxi'
import type { AABB, Vec2 } from './types'

const loaded = new Map<DistrictId, Promise<District>>()
const load = (id: DistrictId) => {
  if (!loaded.has(id)) loaded.set(id, loadDistrict(id))
  return loaded.get(id)!
}

const hits = (p: Vec2, r: number, c: AABB) =>
  p.x > c.minX - r && p.x < c.maxX + r && p.z > c.minZ - r && p.z < c.maxZ + r

describe('the taxi line (taxi.json, which the server checks every ride against)', () => {
  it.each(DISTRICTS)(
    '%s: its stands are its parked autos, and every landmark has a drop point',
    async (id) => {
      const { def } = await load(id)
      expect(TAXI[id].stands).toEqual(def.props.filter((p) => p.kind === 'auto').map((p) => p.at))
      expect(Object.keys(TAXI[id].drops).sort()).toEqual(def.landmarks.map((l) => l.id).sort())
    },
  )

  it.each(DISTRICTS)(
    '%s: each drop is clear for an auto at the end of a clear run up, with room to get out by the landmark',
    async (id) => {
      const { def, colliders } = await load(id)
      for (const l of def.landmarks) {
        const drop = TAXI[id].drops[l.id]!
        expect(
          colliders.some((c) => hits(drop, AUTO_RADIUS, c)),
          l.id,
        ).toBe(false)
        // the run up: APPROACH_M straight along the way the auto faces at the drop, inside the district
        const from = {
          x: drop.x - Math.sin(drop.ry) * APPROACH_M,
          z: drop.z - Math.cos(drop.ry) * APPROACH_M,
        }
        expect(Math.max(Math.abs(from.x), Math.abs(from.z)), l.id).toBeLessThan(def.size / 2)
        expect(
          colliders.some((c) => crosses(from.x, from.z, drop.x, drop.z, c, AUTO_RADIUS)),
          l.id,
        ).toBe(false)
        // out of the auto: by the landmark (its card opens) and within the compass's reach of it (which clears)
        const auto = createVehicle('auto')
        auto.reset(drop.x, drop.z, drop.ry)
        const out = auto.exitPoint(colliders)!
        expect(out, l.id).not.toBeNull()
        expect(Math.hypot(out.x - l.at.x, out.z - l.at.z), l.id).toBeLessThanOrEqual(l.radius)
        expect(
          targetDistance(out, { id: l.id, kind: 'landmark', name: l.name, at: l.at, area: l.footprint }),
          l.id,
        ).toBeLessThanOrEqual(ARRIVE_M)
      }
    },
  )
})

describe('taxiAvailable', () => {
  const free = {
    near: true,
    seated: false,
    driving: false,
    card: false,
    kite: false,
    metro: false,
    roof: false,
  }
  it('is only by an auto at its stand, on foot, with nothing else on screen', () => {
    expect(taxiAvailable(free)).toBe(true)
    for (const k of ['seated', 'driving', 'card', 'kite', 'metro', 'roof'] as const)
      expect(taxiAvailable({ ...free, [k]: true }), k).toBe(false)
    expect(taxiAvailable({ ...free, near: false })).toBe(false)
  })
})

/** Johari Bazaar's auto stand, the auto nose to -z, and where a player stands beside it. */
const HOME = { x: -2.6, z: 30, ry: -Math.PI }
const BESIDE = { x: -0.6, z: 30 }
const HAWA = TAXI['walled-city'].drops['hawa-mahal']!

describe('a ride', () => {
  let district: District
  beforeAll(async () => {
    district = await load('walled-city')
  })

  /** One parked auto, at the stand unless told otherwise. */
  function autos(at = HOME) {
    let spot = { ...at }
    let taken = false
    return {
      nearest: (p: Vec2, range: number) =>
        !taken && Math.hypot(p.x - spot.x, p.z - spot.z) <= range ? 0 : -1,
      pose: () => spot,
      take: vi.fn(() => void (taken = true)),
      leave: vi.fn((_i: number, x: number, z: number, ry: number) => {
        taken = false
        spot = { x, z, ry }
      }),
    } satisfies ParkedAutos
  }

  function setup(opts: { at?: typeof HOME; reduced?: boolean; blocked?: boolean; send?: boolean } = {}) {
    const scene = new THREE.Scene()
    const controls = createControls(new EventTarget() as unknown as Window)
    const player = createPlayer({
      scene,
      camera: new THREE.PerspectiveCamera(),
      controls,
      look: { skin: 0, outfit: 'pink', head: 'none' },
      colliders: district.colliders,
    })
    player.teleport(BESIDE.x, BESIDE.z)
    let clock = 1000
    const hooks = { near: vi.fn(), riding: vi.fn(), dark: vi.fn(), refused: vi.fn() } satisfies TaxiHooks
    const send = vi.fn()
    const parked = autos(opts.at)
    const taxi = createTaxi({
      def: district.def,
      autos: parked,
      player,
      send: opts.send === false ? undefined : send,
      blocked: () => opts.blocked ?? false,
      hooks,
      now: () => clock,
      reducedMotion: () => opts.reduced ?? false,
    })
    /** Frames of 1/30 s for `ms`, each told to `each`. */
    const run = (ms: number, each?: () => void) => {
      const end = clock + ms
      while (clock < end) {
        clock += 1000 / 30
        player.update(1 / 30)
        taxi.update(1 / 30, player.position())
        each?.()
      }
    }
    run(50) // a frame or two to see the auto
    return { player, controls, taxi, hooks, send, parked, run, elapsed: () => clock }
  }

  const fromDrop = (p: Vec2) => Math.hypot(p.x - HAWA.x, p.z - HAWA.z)

  it('is offered by an auto at its stand, on foot; not by one left elsewhere', () => {
    const at = setup()
    expect(at.taxi.near()).toBe(true)
    expect(at.hooks.near).toHaveBeenLastCalledWith(true)
    const moved = setup({ at: { x: BESIDE.x - 2, z: 33, ry: 0 } }) // driven off and left 3 m up the road
    expect(moved.taxi.near()).toBe(false)
    expect(moved.taxi.go('hawa-mahal')).toBe(false)
  })

  it('gets in at the stand, tells the server where from, rides up to the landmark and sets the player down beside it', () => {
    const { player, taxi, hooks, send, parked, run, elapsed } = setup()
    const start = elapsed()
    expect(taxi.go('hawa-mahal')).toBe(true)
    expect(send).toHaveBeenCalledWith({ t: 'ride', to: 'hawa-mahal', x: BESIDE.x, z: BESIDE.z })
    expect(parked.take).toHaveBeenCalledWith(0)
    expect(player.driving()).toBe(true)
    expect(hooks.riding).toHaveBeenLastCalledWith(true)
    expect(hooks.dark).toHaveBeenLastCalledWith(true) // getting in: the screen goes dark
    expect(taxi.riding()).toBe(true)
    expect(taxi.near()).toBe(false)

    // out of the dark at the start of the run up, the view behind the auto, and on to the drop
    run(TAXI_FADE_MS + 50)
    expect(hooks.dark).toHaveBeenLastCalledWith(false)
    expect(fromDrop(player.position())).toBeGreaterThan(APPROACH_M - 3)
    expect(Math.cos(player.view().yaw - (HAWA.ry + Math.PI))).toBeCloseTo(1, 2)
    let last = fromDrop(player.position())
    run(1000, () => {
      const d = fromDrop(player.position())
      expect(d).toBeLessThanOrEqual(last + 1e-9) // always closer, never back
      last = d
    })
    expect(player.driving()).toBe(true)

    run(TAXI_RIDE_MS - (elapsed() - start) + 50)
    expect(taxi.riding()).toBe(false)
    expect(hooks.riding).toHaveBeenLastCalledWith(false)
    expect(hooks.dark).toHaveBeenLastCalledWith(false)
    expect(player.driving()).toBe(false)
    expect(fromDrop(player.position())).toBeLessThanOrEqual(6)
    expect(elapsed() - start).toBeLessThan(4000)
    // the auto goes back to its stand, for the next rider
    expect(parked.leave).toHaveBeenCalledWith(0, HOME.x, HOME.z, HOME.ry)
    expect(taxi.near()).toBe(false) // 60 m from it now
    // and walking works again, from where they stand
    const out = player.position()
    run(500)
    expect(player.position()).toEqual(out)
  })

  it('a skip sets the player down beside the landmark at once', () => {
    const { player, taxi, hooks, run } = setup()
    taxi.go('hawa-mahal')
    run(TAXI_FADE_MS + 400)
    taxi.skip()
    expect(taxi.riding()).toBe(false)
    expect(player.driving()).toBe(false)
    expect(fromDrop(player.position())).toBeLessThanOrEqual(6)
    expect(hooks.dark).toHaveBeenLastCalledWith(false)
  })

  it('with reduced motion it is a cut: a moment of black, then beside the landmark, with no drive', () => {
    const { player, taxi, run, elapsed } = setup({ reduced: true })
    const pilot = vi.spyOn(player, 'autopilot')
    const start = elapsed()
    taxi.go('hawa-mahal')
    run(TAXI_CUT_MS + 50)
    expect(taxi.riding()).toBe(false)
    expect(elapsed() - start).toBeLessThan(TAXI_CUT_MS + 100)
    expect(pilot.mock.calls.filter(([p]) => p !== null)).toEqual([])
    expect(fromDrop(player.position())).toBeLessThanOrEqual(6)
  })

  it('refused by the server: out again by the stand, and told so', () => {
    const { player, taxi, hooks, run } = setup()
    taxi.go('hawa-mahal')
    run(TAXI_FADE_MS + 500)
    taxi.refused()
    expect(hooks.refused).toHaveBeenCalled()
    expect(taxi.riding()).toBe(false)
    expect(player.driving()).toBe(false)
    const p = player.position()
    expect(Math.hypot(p.x - HOME.x, p.z - HOME.z)).toBeLessThanOrEqual(6)
  })

  it('not while blocked (seated, a card), at the wheel, already riding, or to a landmark of another district', () => {
    expect(setup({ blocked: true }).taxi.go('hawa-mahal')).toBe(false)
    const { player, taxi, send } = setup()
    expect(taxi.go('albert-hall')).toBe(false)
    expect(taxi.go('toString')).toBe(false)
    player.mount(HOME.x, HOME.z, HOME.ry) // at the wheel ("Auto chalao")
    expect(taxi.go('hawa-mahal')).toBe(false)
    player.dismount(BESIDE)
    expect(taxi.go('hawa-mahal')).toBe(true)
    expect(taxi.go('jantar-mantar')).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('offline (no socket) it rides all the same', () => {
    const { player, taxi, run } = setup({ send: false })
    expect(taxi.go('hawa-mahal')).toBe(true)
    run(TAXI_RIDE_MS + 100)
    expect(fromDrop(player.position())).toBeLessThanOrEqual(6)
  })

  it('leaving the district mid-ride lets go of everything', () => {
    const { player, taxi, hooks, run } = setup()
    taxi.go('hawa-mahal')
    run(TAXI_FADE_MS + 100)
    taxi.dispose()
    expect(hooks.riding).toHaveBeenLastCalledWith(false)
    expect(hooks.dark).toHaveBeenLastCalledWith(false)
    expect(hooks.near).toHaveBeenLastCalledWith(false)
    // the wheel is the stick's again
    const at = player.position()
    run(200)
    expect(player.position()).toEqual(at)
  })
})
