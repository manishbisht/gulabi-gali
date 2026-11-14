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
import { benchesOf, seatPose } from './benches'
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
    personCard: { step() {}, tap() {}, close() {}, isOpen: () => false },
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
  const h: SessionHooks = {
    ...hooks(),
    presence: { token, replaced: vi.fn() },
    bench: { near: vi.fn(), seated: vi.fn(), line: vi.fn(), refused: vi.fn() },
  }
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

/** Opens a live district with one person dead ahead of the camera, and gives back the pieces to tap with. */
async function withPersonAhead() {
  const live = openLive()
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  const ws = sockets()[0]!
  ws.onopen?.()
  const look = { skin: 2, outfit: 'sandstone', head: 'none' } as const
  ws.say({
    t: 'welcome',
    you: { id: null, visible: false },
    people: [{ id: 'p1', name: 'Asha', look, status: '', x: 0, z: -5, ry: 0 }],
  })
  const canvas = document.querySelector('canvas')!
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
  const tapCentre = () => {
    live.stage.camera.position.set(0, 1, 0)
    live.stage.camera.lookAt(0, 1, -5)
    live.stage.camera.updateMatrixWorld(true)
    const at = { clientX: 50, clientY: 50 }
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), at))
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), at))
  }
  return { ...live, tapCentre }
}

it('a tap on a person reaches the person card, told whether a landmark or character card is up', async () => {
  const { hooks: h, tapCentre } = await withPersonAhead()
  const tap = vi.spyOn(h.personCard, 'tap')
  tapCentre()
  expect(tap).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), false)
  vi.spyOn(h.npcCard, 'isOpen').mockReturnValue(true)
  tapCentre()
  expect(tap).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1' }), true)
})

it('with a landmark in reach, a tap on a person is told it is blocked', async () => {
  const { hooks: h, tapCentre, tick, session } = await withPersonAhead()
  h.track = () => ({}) as never
  tick(0.016) // the interaction system learns a landmark is near
  const tap = vi.spyOn(h.personCard, 'tap')
  tapCentre()
  expect(tap).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), true)
  session.dispose()
})

it('E reaches the person card only when no character card or metro has the key', async () => {
  const live = await withPersonAhead()
  const { hooks: h, tick } = live
  const step = vi.spyOn(h.personCard, 'step')
  const pressed = vi.spyOn(controls, 'interact').mockReturnValue(true)
  tick(0.016)
  expect(step.mock.calls.at(-1)![2]).toBe(true)
  h.trackStation = () => true // E at the station opens the metro
  tick(0.016)
  expect(step.mock.calls.at(-1)![2]).toBe(false)
  h.trackStation = () => false
  vi.spyOn(h.npcCard, 'isOpen').mockReturnValue(true) // a character card is up: E closes that
  tick(0.016)
  expect(step.mock.calls.at(-1)![2]).toBe(false)
  pressed.mockRestore()
  live.session.dispose()
})

/** A live Walled City, welcomed, with the player standing 2 m in front of its tapri by Johari Bazaar. */
async function byTapri() {
  const live = openLive()
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  const ws = sockets()[0]!
  ws.onopen?.()
  ws.say({ t: 'welcome', you: { id: 'dev:asha', visible: true }, people: [] })
  const tapri = benchesOf(walledCity)[4]! // (-5.6, 36), facing +x
  live.session.player()!.teleport(tapri.at.x + 2, tapri.at.z)
  live.tick(1 / 30)
  const sent = () => ws.sent.map((m) => JSON.parse(m) as { t: string }).filter((m) => m.t !== 'move')
  return { ...live, ws, tapri, sent, bench: live.hooks.bench! }
}

it("sits only on the server's word, snaps to the seat, hears the bench, and walking off stands up", async () => {
  const { session, ws, tapri, sent, bench, tick } = await byTapri()
  expect(bench.near).toHaveBeenLastCalledWith(tapri)
  session.sit()
  expect(sent()).toEqual([{ t: 'sit', bench: 'walled-city:4' }])
  // nothing moves until the server answers
  expect(session.player()!.position()).toEqual({ x: tapri.at.x + 2, z: tapri.at.z })
  expect(bench.seated).not.toHaveBeenCalled()

  ws.say({ t: 'seated', bench: 'walled-city:4', seat: 2, with: ['Ravi'] })
  const pose = seatPose(tapri, 2)
  expect(session.player()!.position()).toEqual({ x: pose.x, z: pose.z })
  expect(session.player()!.heading()).toBeCloseTo(pose.ry)
  expect(bench.seated).toHaveBeenLastCalledWith({ bench: tapri, seat: 2, with: ['Ravi'] })

  ws.say({ t: 'bench', bench: 'walled-city:4', from: 'dev:ravi', name: 'Ravi', text: 'chai?', at: 5 })
  ws.say({ t: 'bench', bench: 'walled-city:9', from: 'dev:x', name: 'X', text: 'elsewhere', at: 6 })
  expect(bench.line).toHaveBeenCalledTimes(1)
  expect(bench.line).toHaveBeenCalledWith({ from: 'dev:ravi', name: 'Ravi', text: 'chai?', at: 5 })
  expect(session.say('  haan, do cutting  ')).toBe(true)
  expect(session.say('   ')).toBe(false)
  expect(sent().at(-1)).toEqual({ t: 'say', text: 'haan, do cutting' })

  // someone else sits down: the list changes, the player stays put
  session.player()!.teleport(pose.x + 0.3, pose.z)
  ws.say({ t: 'seated', bench: 'walled-city:4', seat: 2, with: ['Ravi', 'Meena'] })
  expect(session.player()!.position()).toEqual({ x: pose.x + 0.3, z: pose.z })
  expect(bench.seated).toHaveBeenLastCalledWith({ bench: tapri, seat: 2, with: ['Ravi', 'Meena'] })

  // walking off stands the player up, once
  session.player()!.teleport(tapri.at.x + 2.6, tapri.at.z)
  tick(1 / 30)
  tick(1 / 30)
  expect(sent().filter((m) => m.t === 'sit')).toEqual([
    { t: 'sit', bench: 'walled-city:4' },
    { t: 'sit', bench: null },
  ])
  expect(bench.seated).toHaveBeenLastCalledWith(null)
  session.dispose()
})

it('a refused sit is reported; a new socket or leaving the district stands the sitter up', async () => {
  const { session, ws, sent, bench, tick } = await byTapri()
  session.sit()
  ws.say({ t: 'error', code: 'ghost' })
  expect(bench.refused).toHaveBeenLastCalledWith('ghost')
  session.sit()
  ws.say({ t: 'error', code: 'full' })
  expect(bench.refused).toHaveBeenLastCalledWith('full')
  // an error with no sit waiting on it is not about benches
  ws.say({ t: 'error', code: 'invalid' })
  expect(bench.refused).toHaveBeenCalledTimes(2)
  // seated, a line too soon is the server's `rate`
  session.sit()
  ws.say({ t: 'seated', bench: 'walled-city:4', seat: 0, with: [] })
  ws.say({ t: 'error', code: 'rate' })
  expect(bench.refused).toHaveBeenLastCalledWith('rate')
  // and not seated, a say goes nowhere
  ws.say({ t: 'seated', bench: null, seat: null, with: [] })
  expect(bench.seated).toHaveBeenLastCalledWith(null)
  expect(session.say('hello?')).toBe(false)
  expect(sent().filter((m) => m.t === 'say')).toEqual([])

  session.sit()
  ws.say({ t: 'seated', bench: 'walled-city:4', seat: 0, with: [] })
  ws.say({ t: 'welcome', you: { id: 'dev:asha', visible: true }, people: [] }) // a fresh socket
  expect(bench.seated).toHaveBeenLastCalledWith(null)
  tick(1 / 30)
  expect(bench.near).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'walled-city:4' }))
  session.sit()
  ws.say({ t: 'seated', bench: 'walled-city:4', seat: 0, with: [] })
  session.dispose()
  expect(bench.seated).toHaveBeenLastCalledWith(null)
  expect(bench.near).toHaveBeenLastCalledWith(null)
})

it('E sits at a bench in reach and stands up again, unless a card has the key', async () => {
  const { session, ws, sent, hooks: h, tick } = await byTapri()
  const pressed = vi.spyOn(controls, 'interact').mockReturnValue(true)
  const person = vi.spyOn(h.personCard, 'step')
  vi.spyOn(h.npcCard, 'isOpen').mockReturnValue(true) // a character's card has E: it closes that
  tick(1 / 30)
  expect(sent()).toEqual([])
  vi.spyOn(h.npcCard, 'isOpen').mockReturnValue(false)
  tick(1 / 30)
  expect(sent()).toEqual([{ t: 'sit', bench: 'walled-city:4' }])
  expect(person.mock.calls.at(-1)![2]).toBe(false) // the bench took the key from the person card
  ws.say({ t: 'seated', bench: 'walled-city:4', seat: 1, with: [] })
  tick(1 / 30)
  expect(sent().at(-1)).toEqual({ t: 'sit', bench: null })
  pressed.mockRestore()
  session.dispose()
})
