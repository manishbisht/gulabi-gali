import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLAP_AFTER_S, NEAR_M, onShowWatched, SHOW_S, STAY_M } from '../world/shows'
import type { AABB, DistrictDef, ShowKind, ShowSpec } from '../world/types'
import type { Tier } from './figures'
import type { ShowMusic } from './music'
import { createShows, type ShowsDeps } from './stage'

const SUNSET = '2026-11-25T12:05:00.000Z'
const NOON = '2026-11-25T06:30:00.000Z'
const EVENING = '2026-11-25T12:30:00.000Z'

const FRAME = 1 / 30

function make(
  specs: ShowSpec[],
  over: Partial<ShowsDeps> & { clock?: { now: string }; tier?: { q: Tier } } = {},
) {
  const scene = new THREE.Group()
  const wall: AABB = { minX: 50, maxX: 60, minZ: 50, maxZ: 60 }
  const colliders: AABB[] = [wall]
  const clock = over.clock ?? { now: NOON }
  const tier = over.tier ?? { q: 2 as Tier }
  const heard = { on: true }
  const music = {
    start: vi.fn(),
    update: vi.fn<ShowMusic['update']>(() => heard.on),
    stop: vi.fn(),
    clap: vi.fn(),
    dispose: vi.fn(),
  } satisfies ShowMusic
  const hooks = { began: vi.fn(), clap: vi.fn(), left: vi.fn() }
  const duck = vi.fn()
  const shows = createShows({
    scene,
    def: { shows: specs } as DistrictDef,
    colliders,
    quality: () => tier.q,
    now: () => new Date(clock.now),
    sunset: () => SUNSET,
    hooks,
    music,
    duck,
    reducedMotion: () => false,
    ...over,
  })
  /** Runs `seconds` of frames with the player at (x, z). */
  const run = (seconds: number, x: number, z: number) => {
    for (let t = 0; t < seconds; t += FRAME) shows.update(FRAME, { x, z })
  }
  /** How many times any piece of any show has been written. */
  const writes = () =>
    scene.children
      .flatMap((g) => g.children as THREE.InstancedMesh[])
      .reduce((n, m) => n + m.instanceMatrix.version, 0)
  return { shows, scene, colliders, wall, music, hooks, duck, run, writes, clock, tier, heard }
}

const PUPPETS: ShowSpec = { kind: 'kathputli', at: { x: 0, z: 0 } }
const phase = (s: ReturnType<typeof make>, kind: ShowKind = 'kathputli') =>
  s.shows.list().find((e) => e.kind === kind)!.phase

const watched = vi.fn()
const off = onShowWatched(watched)
afterEach(() => watched.mockClear())
void off

describe('a street show', () => {
  it('holds still until the player comes near: far or in view, nothing is written', () => {
    const s = make([PUPPETS])
    const before = s.writes()
    s.run(2, 300, 0)
    expect(s.scene.children[0]!.visible).toBe(false) // too far to be drawn at all
    s.run(2, NEAR_M + 4, 0)
    expect(s.scene.children[0]!.visible).toBe(true)
    expect(s.writes()).toBe(before)
    expect(phase(s)).toBe('idle')
    expect(s.music.start).not.toHaveBeenCalled()
    expect(s.hooks.began).not.toHaveBeenCalled()
  })

  it('performs when the player is within reach, with its tune, and offers the clap', () => {
    const s = make([PUPPETS])
    const before = s.writes()
    s.run(1, NEAR_M - 1, 0)
    expect(phase(s)).toBe('playing')
    expect(s.music.start).toHaveBeenCalledExactlyOnceWith('kathputli')
    expect(s.hooks.began).toHaveBeenCalledExactlyOnceWith('kathputli')
    expect(s.hooks.clap).toHaveBeenLastCalledWith('kathputli')
    expect(s.writes()).toBeGreaterThan(before)
    // the ambience steps back while the tune can be heard
    expect(s.duck).toHaveBeenLastCalledWith(true)
    // louder beside the performers than at the edge of earshot
    const loud = (x: number) => {
      s.run(FRAME, x, 0)
      return s.music.update.mock.lastCall![1]
    }
    expect(loud(3)).toBe(1)
    expect(loud(12)).toBeLessThan(1)
    expect(loud(12)).toBeGreaterThan(0)
  })

  it('watched to the end: `showWatched` once, then a small idle while the player stays, and the clap for a while', () => {
    const s = make([PUPPETS])
    s.run(SHOW_S.kathputli - 1, 4, 0)
    expect(watched).not.toHaveBeenCalled()
    s.run(2, 4, 0)
    expect(watched).toHaveBeenCalledExactlyOnceWith('kathputli')
    expect(phase(s)).toBe('after')
    expect(s.music.stop).toHaveBeenCalled()
    expect(s.duck).toHaveBeenLastCalledWith(false)
    // still offered: the end is when people clap
    expect(s.hooks.clap).toHaveBeenLastCalledWith('kathputli')
    const before = s.writes()
    s.run(CLAP_AFTER_S + 1, 4, 0)
    expect(s.hooks.clap).toHaveBeenLastCalledWith(null)
    expect(s.writes()).toBeGreaterThan(before) // the looping idle
    // it does not start over by itself
    expect(s.music.start).toHaveBeenCalledOnce()
    expect(watched).toHaveBeenCalledOnce()
  })

  it('walking off ends it unwatched; the figures settle and stop, and the next approach starts it again', () => {
    const s = make([PUPPETS])
    s.run(5, 4, 0)
    s.run(0.2, STAY_M + 1, 0)
    expect(phase(s)).toBe('settling')
    expect(s.music.stop).toHaveBeenCalledOnce()
    expect(s.hooks.left).toHaveBeenCalledExactlyOnceWith('kathputli')
    expect(s.hooks.clap).toHaveBeenLastCalledWith(null)
    expect(s.duck).toHaveBeenLastCalledWith(false)
    s.run(4, STAY_M + 1, 0)
    expect(phase(s)).toBe('idle')
    const settled = s.writes()
    s.run(2, STAY_M + 1, 0)
    expect(s.writes()).toBe(settled)
    expect(watched).not.toHaveBeenCalled()
    s.run(1, 4, 0)
    expect(phase(s)).toBe('playing')
    expect(s.music.start).toHaveBeenCalledTimes(2)
  })

  it('a clap is answered with a clap sound and a bow, only while a show is on or just over', () => {
    const s = make([PUPPETS])
    expect(s.shows.clap()).toBe(false)
    s.run(1, 4, 0)
    expect(s.shows.clap()).toBe(true)
    expect(s.music.clap).toHaveBeenCalledOnce()
    s.run(SHOW_S.kathputli + CLAP_AFTER_S + 1, 4, 0)
    expect(s.shows.clap()).toBe(false)
    expect(s.music.clap).toHaveBeenCalledOnce()
  })

  it('one show at a time, each where its district put it, turned as told', () => {
    const s = make([PUPPETS, { kind: 'ravanhatta', at: { x: 6, z: 0 }, rot: 90 }])
    const [a, b] = s.scene.children
    expect(a!.position.x).toBe(0)
    expect(b!.position.x).toBe(6)
    expect(b!.rotation.y).toBeCloseTo(-Math.PI / 2)
    s.run(1, 3, 0)
    expect(s.shows.list().map((e) => e.phase)).toEqual(['playing', 'idle'])
  })

  it('adds what nobody walks through to the colliders, and takes it back', () => {
    const s = make([PUPPETS])
    expect(s.colliders).toHaveLength(2)
    expect(s.colliders[0]).toBe(s.wall)
    s.shows.dispose()
    expect(s.colliders).toEqual([s.wall])
    expect(s.scene.children).toHaveLength(0)
    expect(s.music.dispose).toHaveBeenCalledOnce()
  })

  it('the dancers are out only in the evening: they come when it is time and go when nobody is watching', () => {
    const clock = { now: NOON }
    const s = make([{ kind: 'dancers', at: { x: 0, z: 0 } }], { clock })
    expect(s.shows.list()[0]).toMatchObject({ out: false, calls: 0 })
    expect(s.scene.children).toHaveLength(0)
    expect(s.colliders).toHaveLength(1)
    s.run(2, 3, 0)
    expect(s.music.start).not.toHaveBeenCalled()
    clock.now = EVENING
    s.run(6, 30, 0)
    expect(s.shows.list()[0]).toMatchObject({ out: true, calls: 4 })
    expect(s.colliders).toHaveLength(2)
    s.run(1, 3, 0)
    expect(phase(s, 'dancers')).toBe('playing')
    // the hour passes mid-dance: they finish for whoever is there
    clock.now = '2026-11-25T15:00:00.000Z'
    s.run(6, 3, 0)
    expect(s.shows.list()[0]!.out).toBe(true)
    s.run(10, 40, 0)
    expect(s.shows.list()[0]).toMatchObject({ out: false, phase: 'idle' })
    expect(s.scene.children).toHaveLength(0)
    expect(s.colliders).toHaveLength(1)
  })

  it('reduced motion: a held pose with the music; a clap is a bow held for a moment', () => {
    const s = make([PUPPETS], { reducedMotion: () => true })
    const before = s.writes()
    s.run(3, 4, 0)
    expect(phase(s)).toBe('playing')
    expect(s.music.update).toHaveBeenCalled()
    expect(s.writes()).toBe(before)
    s.shows.clap()
    s.run(0.1, 4, 0)
    const bowed = s.writes()
    expect(bowed).toBeGreaterThan(before)
    s.run(0.5, 4, 0)
    expect(s.writes()).toBe(bowed) // held, not animated
    s.run(2, 4, 0)
    expect(s.writes()).toBeGreaterThan(bowed) // and back upright, once
    const upright = s.writes()
    s.run(1, 4, 0)
    expect(s.writes()).toBe(upright)
  })

  it('a slower phone gets thinner figures, and the show carries on', () => {
    const tier = { q: 2 as Tier }
    const clock = { now: EVENING }
    const s = make([{ kind: 'dancers', at: { x: 0, z: 0 } }], { tier, clock })
    s.run(2, 3, 0)
    expect(s.shows.list()[0]!.calls).toBe(4)
    tier.q = 0
    s.run(0.1, 3, 0)
    expect(s.shows.list()[0]).toMatchObject({ calls: 2, phase: 'playing' })
    expect(s.scene.children).toHaveLength(1)
  })

  it('sound off or out of earshot: the ambience is not ducked for a tune nobody hears', () => {
    const s = make([PUPPETS])
    s.heard.on = false
    s.run(1, 4, 0)
    expect(phase(s)).toBe('playing')
    expect(s.duck).not.toHaveBeenCalledWith(true)
  })

  it('the test hook can move a performance on; leaving the district mid-show cleans up', () => {
    const s = make([PUPPETS])
    s.run(1, 4, 0)
    s.shows.skip(SHOW_S.kathputli)
    s.run(0.1, 4, 0)
    expect(phase(s)).toBe('after')
    expect(watched).toHaveBeenCalledOnce()
    const t = make([PUPPETS])
    t.run(1, 4, 0)
    t.shows.dispose()
    expect(t.hooks.clap).toHaveBeenLastCalledWith(null)
    expect(t.duck).toHaveBeenLastCalledWith(false)
    expect(t.music.stop).toHaveBeenCalled()
  })
})
