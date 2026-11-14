// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import { fallbackSnapshot } from '../net/api'
import type { DistrictId, ServerMsg } from '../net/protocol'
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

it('a throwing onLeave never skips disposal, and a throwing onEnter never fails a travel', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { session } = open()
  const first = fakeDistrict(walledCity)
  loads[0]!.resolve(first)
  await settle()
  const later = vi.fn()
  session.onLeave(() => {
    throw new Error('leave listener broke')
  })
  session.onLeave(later)
  session.onEnter(() => {
    throw new Error('enter listener broke')
  })
  session.onEnter(later)
  const second = fakeDistrict(miRoad)
  const trip = session.travelTo('mi-road')
  loads[1]!.resolve(second)
  await expect(trip).resolves.toBeUndefined()
  expect(first.dispose).toHaveBeenCalled()
  expect(session.district()).toBe(second)
  expect(later).toHaveBeenCalledTimes(2) // the listeners after the broken ones still ran
  expect(errors).toHaveBeenCalledTimes(2)
  session.dispose()
  expect(second.dispose).toHaveBeenCalled()
  errors.mockRestore()
})

/** A socket the test plays the server for. */
class FakeSocket {
  static all: FakeSocket[] = []
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.closed = true
  }
  say(m: ServerMsg) {
    this.onmessage?.({ data: JSON.stringify(m) })
  }
}

function openLive(token: () => Promise<string | null> = async () => null) {
  FakeSocket.all = []
  const s = fakeStage()
  const canvas = document.body.appendChild(document.createElement('canvas'))
  const bubbleHost = document.body.appendChild(document.createElement('div'))
  const h: SessionHooks = { ...hooks(), presence: { token, replaced: vi.fn() } }
  const session = createCitySession({
    stage: s.stage,
    controls,
    canvas,
    bubbleHost,
    start: 'walled-city',
    hooks: h,
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
  })
  return { ...s, session, hooks: h }
}

const sockets = () => FakeSocket.all
const openSockets = () => FakeSocket.all.filter((ws) => !ws.closed)

it('keeps one live socket per tab: travel closes the old district before opening the next', async () => {
  const { session } = openLive()
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  expect(openSockets().map((ws) => ws.url)).toEqual([expect.stringContaining('/districts/walled-city/live')])
  const trip = session.travelTo('mi-road')
  loads[1]!.resolve(fakeDistrict(miRoad))
  await trip
  await settle()
  expect(sockets()).toHaveLength(2)
  expect(openSockets().map((ws) => ws.url)).toEqual([expect.stringContaining('/districts/mi-road/live')])
  session.dispose()
  expect(openSockets()).toEqual([])
})

it('says where it stands right after welcome, and snaps back when a step was too fast', async () => {
  const { session, hooks: h } = openLive()
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  const ws = sockets()[0]!
  ws.onopen?.()
  const at = session.player()!.position()
  ws.say({ t: 'welcome', you: { id: null, visible: false }, people: [] })
  expect(ws.sent.map((s) => JSON.parse(s))).toEqual([{ t: 'move', x: at.x, z: at.z, ry: 0 }])
  expect(h.presence!.replaced).toHaveBeenLastCalledWith(false)
  ws.say({ t: 'error', code: 'too-fast', x: 7, z: 8, ry: 1 })
  expect(session.player()!.position()).toEqual({ x: 7, z: 8 })
  expect(session.player()!.heading()).toBe(1)
  ws.onclose?.({ code: 4001 }) // another tab of the same person took over
  expect(h.presence!.replaced).toHaveBeenLastCalledWith(true)
  session.dispose()
})

it('reconnects the live socket when who you are changes, with the token the getter now gives', async () => {
  let token: string | null = null
  const { session } = openLive(async () => token)
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  expect(sockets()[0]!.url).not.toContain('token=')
  token = 'dev.asha.1'
  session.reconnectLive()
  await settle()
  expect(sockets()[0]!.closed).toBe(true)
  expect(openSockets()).toHaveLength(1)
  expect(openSockets()[0]!.url).toContain('token=dev.asha.1')
  session.dispose()
})

it('shows remote people from the live socket and drops them with the district', async () => {
  const { session, stage, tick } = openLive()
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  const ws = sockets()[0]!
  ws.onopen?.()
  ws.say({
    t: 'welcome',
    you: { id: null, visible: false },
    people: [
      {
        id: 'dev:asha',
        name: 'Asha',
        look: { skin: 1, outfit: 'teal', head: 'none' },
        status: '',
        x: 1,
        z: 2,
        ry: 0,
      },
    ],
  })
  tick(1 / 30)
  expect(stage.scene.getObjectByName('person-dev:asha')).toBeDefined()
  session.dispose()
  expect(stage.scene.getObjectByName('person-dev:asha')).toBeUndefined()
})
