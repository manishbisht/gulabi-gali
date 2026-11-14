// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import { fallbackSnapshot } from '../net/api'
import type { DistrictId } from '../net/protocol'
import type { Controls } from '../player/controls'
import type { District } from './district'
import miRoad from './districts/miRoad'
import walledCity from './districts/walledCity'
import { createCitySession, type SessionHooks } from './session'
import type { DistrictDef } from './types'

/** Each district asked for waits here until the test lets it arrive (or fail). */
const loads = vi.hoisted(() => [] as { id: string; resolve(d: unknown): void; reject(e: unknown): void }[])
vi.mock('./district', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./district')>()),
  loadDistrict: (id: DistrictId) => new Promise((resolve, reject) => loads.push({ id, resolve, reject })),
}))

afterEach(() => {
  loads.length = 0
  document.body.innerHTML = ''
})

/** A district with nothing built: a named root, real lights for the sky to paint, spied disposal. */
function fakeDistrict(def: DistrictDef, log: string[] = []): District {
  const root = new THREE.Group()
  root.name = def.id
  const hemi = new THREE.HemisphereLight()
  const sun = new THREE.DirectionalLight()
  root.add(hemi, sun)
  return {
    def: { ...def, npcs: [] },
    root,
    colliders: [],
    occluders: [],
    lights: { hemi, sun },
    focus: () => {},
    dispose: vi.fn(() => {
      log.push(`dispose ${def.id}`)
      root.removeFromParent()
    }),
  }
}

function fakeStage() {
  const frames = new Set<(dt: number) => void>()
  const qualities = new Set<(q: 0 | 1 | 2) => void>()
  const stage = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    quality: 2,
    onFrame: (f: (dt: number) => void) => (frames.add(f), () => void frames.delete(f)),
    onQuality: (f: (q: 0 | 1 | 2) => void) => (qualities.add(f), () => void qualities.delete(f)),
    framesSinceRestore: () => 0,
    dispose: () => {},
  } as unknown as Stage
  return { stage, frames, qualities, tick: (dt: number) => frames.forEach((f) => f(dt)) }
}

const controls: Controls = {
  move: () => ({ x: 0, z: 0 }),
  interact: () => false,
  setJoystick() {},
  dispose() {},
}

function hooks(): SessionHooks {
  return {
    lang: () => 'en',
    track: () => null,
    trackStation: () => false,
    npcCard: { step() {}, tap() {}, close() {}, isOpen: () => false },
    live: { current: () => fallbackSnapshot(new Date()), now: () => new Date(), patch() {}, freeze() {} },
    festival: () => null,
    place: vi.fn(),
  }
}

function open(start: DistrictId = 'walled-city') {
  const s = fakeStage()
  const canvas = document.body.appendChild(document.createElement('canvas'))
  const bubbleHost = document.body.appendChild(document.createElement('div'))
  const h = hooks()
  const session = createCitySession({ stage: s.stage, controls, canvas, bubbleHost, start, hooks: h })
  return { ...s, session, hooks: h }
}

/** Lets a load that was just resolved run on to the end of `enter`. */
const settle = () => new Promise((r) => setTimeout(r))

it('enter then travel disposes the first district before the second onEnter', async () => {
  const log: string[] = []
  const { session, stage } = open()
  session.onEnter((d) => log.push(`enter ${d.def.id}`))
  session.onLeave((d) => log.push(`leave ${d.def.id}`))
  const first = fakeDistrict(walledCity, log)
  loads[0]!.resolve(first)
  await settle()
  expect(session.district()).toBe(first)
  expect(stage.scene.getObjectByName('walled-city')).toBeDefined()

  const second = fakeDistrict(miRoad, log)
  const trip = session.travelTo('mi-road')
  expect(loads[1]!.id).toBe('mi-road')
  expect(log).toEqual(['enter walled-city']) // the old district runs on while the new one loads
  loads[1]!.resolve(second)
  await trip
  expect(log).toEqual(['enter walled-city', 'leave walled-city', 'dispose walled-city', 'enter mi-road'])
  expect(session.district()).toBe(second)
  expect(stage.scene.getObjectByName('walled-city')).toBeUndefined()
  const p = session.player()!.position()
  expect(p).toEqual(miRoad.station) // arrived by metro
  session.dispose()
  expect(log.at(-2)).toBe('leave mi-road')
  expect(second.dispose).toHaveBeenCalled()
})

it('keeps the old district when the next one fails to load', async () => {
  const { session, frames } = open()
  const first = fakeDistrict(walledCity)
  loads[0]!.resolve(first)
  await settle()
  const listeners = frames.size
  const trip = session.travelTo('mi-road')
  loads[1]!.reject(new Error('chunk failed'))
  await expect(trip).rejects.toThrow()
  expect(session.district()).toBe(first)
  expect(first.dispose).not.toHaveBeenCalled()
  expect(frames.size).toBe(listeners)
  session.dispose()
})

it('dispose during a pending load disposes the late district', async () => {
  const { session, stage, hooks: h } = open()
  const entered = vi.fn()
  session.onEnter(entered)
  session.dispose()
  const late = fakeDistrict(walledCity)
  loads[0]!.resolve(late)
  await settle()
  expect(late.dispose).toHaveBeenCalled()
  expect(entered).not.toHaveBeenCalled()
  expect(h.place).not.toHaveBeenCalled()
  expect(session.district()).toBeNull()
  expect(stage.scene.children.filter((c) => c.name === 'walled-city')).toEqual([])
})

it('onFrame listeners get the player position', async () => {
  const { session, tick } = open()
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  const seen = vi.fn()
  const off = session.onFrame(seen)
  session.player()!.teleport(3, 4)
  tick(1 / 30)
  expect(seen).toHaveBeenCalledWith(1 / 30, { x: 3, z: 4 })
  off()
  tick(1 / 30)
  expect(seen).toHaveBeenCalledTimes(1)
  session.dispose()
})

it('says the city failed to open when the first district cannot load', async () => {
  const { session, hooks: h } = open()
  loads[0]!.reject(new Error('chunk failed'))
  await settle()
  expect(h.place).toHaveBeenCalledWith(null)
  expect(session.district()).toBeNull()
  session.dispose()
})
