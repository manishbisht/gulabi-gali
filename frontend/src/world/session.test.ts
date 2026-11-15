// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import { fallbackSnapshot } from '../net/api'
import type { DistrictId, PosterView, ServerMsg } from '../net/protocol'
import type { Controls } from '../player/controls'
import type { District } from './district'
import miRoad from './districts/miRoad'
import walledCity from './districts/walledCity'
import { benchesOf, seatPose } from './benches'
import { ROOF_FADE_MS } from './rooftop'
import { placeSpot } from './placeLink'
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
    autos: { nearest: () => -1, pose: () => ({ x: 0, z: 0, ry: 0 }), take() {}, leave() {} },
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
    gameTime: () => 0,
    settle: () => {},
    dispose: () => {},
  } as unknown as Stage
  return { stage, frames, qualities, tick: (dt: number) => frames.forEach((f) => f(dt)) }
}

const controls: Controls = {
  move: () => ({ x: 0, z: 0 }),
  interact: () => false,
  horn: () => false,
  drive: () => ({ x: 0, z: 0 }),
  setJoystick() {},
  freeze() {},
  holdSpace: vi.fn(),
  look: () => ({ yaw: 0, pitch: 0, held: false }),
  addLook: vi.fn(),
  holdLook: vi.fn(),
  jog: () => false,
  zoom: () => 1,
  addZoom: vi.fn(),
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

function open(start: DistrictId = 'walled-city', extra: Partial<SessionHooks> = {}, startAt?: string) {
  const s = fakeStage()
  const canvas = document.body.appendChild(document.createElement('canvas'))
  const bubbleHost = document.body.appendChild(document.createElement('div'))
  const h = { ...hooks(), ...extra }
  const session = createCitySession({
    stage: s.stage,
    controls,
    canvas,
    bubbleHost,
    start,
    startAt,
    hooks: h,
  })
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

describe('opened from a link to a place (`startAt`)', () => {
  it('stands the player at the place in the first district, facing it; later trips arrive at the station', async () => {
    const { session } = open('mi-road', {}, 'albert-hall')
    const first = fakeDistrict(miRoad)
    loads[0]!.resolve(first)
    await settle()
    const want = placeSpot(first, 'albert-hall')!
    expect(session.player()!.position()).toEqual({ x: want.x, z: want.z })
    expect(session.player()!.heading()).toBe(want.ry)
    expect(want).not.toEqual({ ...miRoad.spawn, ry: want.ry })
    // and the view looks the way they face (yaw 0 looks along -z, a heading of π)
    const yaw = session.player()!.view().yaw
    expect(Math.cos(yaw - (want.ry + Math.PI))).toBeCloseTo(1, 5)
    const trip = session.travelTo('walled-city')
    loads[1]!.resolve(fakeDistrict(walledCity))
    await trip
    expect(session.player()!.position()).toEqual(walledCity.station)
    session.dispose()
  })

  it('a place the district does not have falls back to the normal spawn', async () => {
    const { session } = open('walled-city', {}, 'nowhere-at-all')
    loads[0]!.resolve(fakeDistrict(walledCity))
    await settle()
    expect(session.player()!.position()).toEqual(walledCity.spawn)
    session.dispose()
  })
})

it('a zoom lasts while the player stays, and the next district starts at the usual distance', async () => {
  const { session, tick } = open()
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  const zoom = vi.spyOn(controls, 'zoom').mockReturnValueOnce(1.5)
  for (let i = 0; i < 60; i++) tick(1 / 30)
  expect(session.player()!.view().zoom).toBeCloseTo(1.5, 3)
  const trip = session.travelTo('mi-road')
  loads[1]!.resolve(fakeDistrict(miRoad))
  await trip
  tick(1 / 30)
  expect(session.player()!.view().zoom).toBe(1)
  zoom.mockRestore()
  session.dispose()
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

function openLive(token: () => Promise<string | null> = async () => null, over: Partial<SessionHooks> = {}) {
  FakeSocket.all = []
  const s = fakeStage()
  const canvas = document.body.appendChild(document.createElement('canvas'))
  const bubbleHost = document.body.appendChild(document.createElement('div'))
  const h: SessionHooks = {
    ...hooks(),
    presence: { token, replaced: vi.fn(), queued: vi.fn() },
    bench: { near: vi.fn(), seated: vi.fn(), line: vi.fn(), refused: vi.fn() },
    ...over,
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

it('a move made at a jog claims the jog pace (`pace: jog`), and a walk does not', async () => {
  const { session, tick } = openLive()
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  const ws = sockets()[0]!
  ws.onopen?.()
  ws.say({ t: 'welcome', you: { id: null, visible: false }, people: [] })
  const move = vi.spyOn(controls, 'move').mockReturnValue({ x: 0, z: 1 })
  const jog = vi.spyOn(controls, 'jog').mockReturnValue(true)
  let t = Date.now()
  const now = vi.spyOn(Date, 'now').mockImplementation(() => t)
  const sent = () =>
    ws.sent.map((s) => JSON.parse(s) as { t: string; pace?: string }).filter((m) => m.t === 'move')
  try {
    t += 1000 // past even a ghost's throttle
    tick(1 / 30)
    expect(sent().at(-1)).toMatchObject({ t: 'move', pace: 'jog' })
    jog.mockReturnValue(false)
    t += 1000
    tick(1 / 30)
    expect(sent().at(-1)!.t).toBe('move')
    expect(sent().at(-1)).not.toHaveProperty('pace')
    expect(sent()).toHaveLength(3) // the welcome's, the jog's and the walk's
  } finally {
    move.mockRestore()
    jog.mockRestore()
    now.mockRestore()
    session.dispose()
  }
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

it('tells the page where it waits in line for room, and when it gets in', async () => {
  const { session, hooks: h } = openLive(async () => 'dev.asha.1')
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  const ws = sockets()[0]!
  ws.onopen?.()
  const queued = h.presence!.queued as ReturnType<typeof vi.fn>
  ws.say({ t: 'welcome', you: { id: 'dev:asha', visible: false, queued: 3 }, people: [] })
  expect(queued).toHaveBeenLastCalledWith(3, false)
  ws.say({ t: 'queued', position: 2 })
  expect(queued).toHaveBeenLastCalledWith(2, false)
  ws.say({ t: 'welcome', you: { id: 'dev:asha', visible: true }, people: [] })
  expect(queued).toHaveBeenLastCalledWith(null, true)
  // A welcome always says it, so a reconnect as a ghost (signed out) clears the line too.
  ws.say({ t: 'welcome', you: { id: null, visible: false }, people: [] })
  expect(queued).toHaveBeenLastCalledWith(null, false)
  expect(queued).toHaveBeenCalledTimes(4)
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

const asha = {
  id: 'dev:asha',
  name: 'Asha',
  look: { skin: 1, outfit: 'teal', head: 'none' },
  status: '',
  x: 1,
  z: 2,
  ry: 0,
} as const

/** A live district whose socket has welcomed Asha, standing near the player. */
async function withAsha() {
  const live = openLive()
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  const ws = sockets()[0]!
  ws.onopen?.()
  ws.say({ t: 'welcome', you: { id: null, visible: false }, people: [asha] })
  live.tick(1 / 30)
  const drawn = () => live.stage.scene.getObjectByName('person-dev:asha')
  expect(drawn()).toBeDefined()
  return { ...live, ws, drawn }
}

it("people() gives the map the street's people: none offline, those the socket lists, none once they leave", async () => {
  const { session, ws } = await withAsha()
  expect(session.people().map((r) => r.person.id)).toEqual(['dev:asha'])
  ws.say({ t: 'leave', id: 'dev:asha' }) // hidden, blocked, or gone: the server says she left
  expect(session.people()).toEqual([])
  session.dispose()

  const offline = open()
  loads[1]!.resolve(fakeDistrict(walledCity))
  await settle()
  expect(offline.session.people()).toEqual([])
  offline.session.dispose()
})

it('clears the street when another tab takes over: nobody stays frozen in place', async () => {
  const { session, ws, drawn } = await withAsha()
  ws.onclose?.({ code: 4001 })
  expect(drawn()).toBeUndefined()
  session.dispose()
})

it('clears the street after 3 s without a socket, and not before', async () => {
  const { session, ws, drawn } = await withAsha()
  vi.useFakeTimers()
  try {
    ws.onclose?.({ code: 1006 }) // a tunnel: the socket is gone, a reconnect is on its way
    await vi.advanceTimersByTimeAsync(2900)
    expect(drawn()).toBeDefined()
    await vi.advanceTimersByTimeAsync(100)
    expect(drawn()).toBeUndefined()
    // back up: the welcome brings everyone back
    const again = sockets().at(-1)!
    expect(again).not.toBe(ws)
    again.onopen?.()
    again.say({ t: 'welcome', you: { id: null, visible: false }, people: [asha] })
    expect(drawn()).toBeDefined()
  } finally {
    vi.useRealTimers()
    session.dispose()
  }
})

it('a quick reconnect keeps the street as it is', async () => {
  const { session, ws, drawn } = await withAsha()
  vi.useFakeTimers()
  try {
    ws.onclose?.({ code: 1006 })
    await vi.advanceTimersByTimeAsync(1000)
    sockets().at(-1)!.onopen?.()
    await vi.advanceTimersByTimeAsync(5000)
    expect(drawn()).toBeDefined()
  } finally {
    vi.useRealTimers()
    session.dispose()
  }
})

describe('reactions', () => {
  /** A resident on a live street, with Asha 3 m away and Ravi 20 m away. */
  async function greeting() {
    const reactions = { got: vi.fn(), sent: vi.fn(), refused: vi.fn() }
    const live = openLive(async () => 'tok', { reactions })
    loads[0]!.resolve(fakeDistrict(walledCity))
    await settle()
    const ws = sockets()[0]!
    const { x, z } = live.session.player()!.position()
    // not open yet: nothing can go
    expect(live.session.react('dev:asha', 'wave')).toBe('offline')
    ws.onopen?.()
    ws.say({
      t: 'welcome',
      you: { id: 'dev:me', visible: true },
      people: [
        { ...asha, x: x + 3, z },
        { ...asha, id: 'dev:ravi', name: 'Ravi', x: x - 20, z },
      ],
    })
    live.tick(1 / 30)
    const emotes = () =>
      [...document.querySelectorAll<HTMLElement>('.emote')]
        .filter((el) => !el.hidden)
        .map((el) => el.textContent)
    return { ...live, ws, reactions, emotes }
  }

  it('a greeting goes out only to someone drawn within 8 m; anyone else is refused here, unsent', async () => {
    const { session, ws } = await greeting()
    const reacts = () => ws.sent.filter((s) => s.includes('"react"'))
    expect(session.react('dev:asha', 'namaste')).toBeNull()
    expect(reacts().map((s) => JSON.parse(s))).toEqual([{ t: 'react', to: 'dev:asha', kind: 'namaste' }])
    expect(session.react('dev:ravi', 'wave')).toBe('far')
    expect(session.react('dev:nobody', 'wave')).toBe('gone')
    expect(reacts()).toHaveLength(1)
    session.dispose()
    expect(session.react('dev:asha', 'wave')).toBe('offline')
  })

  it("the server's word draws the emote over both and tells the page who greeted whom", async () => {
    const { session, ws, reactions, emotes, tick } = await greeting()
    // Asha greets the player: a toast with her name, and a namaste over each of them
    ws.say({ t: 'react', from: 'dev:asha', to: 'dev:me', kind: 'namaste' })
    tick(1 / 30)
    expect(reactions.got).toHaveBeenCalledWith({ id: 'dev:asha', name: 'Asha' }, 'namaste')
    expect(emotes()).toEqual(['🙏', '🙏'])
    // the player's own greeting reached Ravi; then one was refused
    ws.say({ t: 'react', from: 'dev:me', to: 'dev:ravi', kind: 'wave' })
    expect(reactions.sent).toHaveBeenCalledWith('dev:ravi', 'wave')
    ws.say({ t: 'react-no', to: 'dev:asha', why: 'wait' })
    expect(reactions.refused).toHaveBeenCalledWith('dev:asha', 'wait')
    // between two others: drawn, nothing to tell
    ws.say({ t: 'react', from: 'dev:asha', to: 'dev:ravi', kind: 'wave' })
    expect(reactions.got).toHaveBeenCalledTimes(1)
    expect(reactions.sent).toHaveBeenCalledTimes(1)
    // from someone the street does not show: no toast, nothing drawn
    tick(5)
    expect(emotes()).toEqual([])
    ws.say({ t: 'react', from: 'dev:stranger', to: 'dev:me', kind: 'wave' })
    tick(1 / 30)
    expect(reactions.got).toHaveBeenCalledTimes(1)
    expect(emotes()).toEqual([])
    session.dispose()
    expect(document.querySelectorAll('.emote')).toHaveLength(0)
  })
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
  // and a muted sitter's line is the server's `muted`
  ws.say({ t: 'error', code: 'muted' })
  expect(bench.refused).toHaveBeenLastCalledWith('muted')
  // and a line the word filter refused is the server's `words`
  ws.say({ t: 'error', code: 'words' })
  expect(bench.refused).toHaveBeenLastCalledWith('words')
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

it('the walls: fetched on each welcome as this person, kept current by the socket, and E by one opens the composer', async () => {
  const up: PosterView = {
    id: 'p1',
    wall: 0,
    slot: 2,
    text: 'Chess at the Chaupar, 5pm',
    when: null,
    name: 'Ravi',
  }
  const fetchMock = vi.fn(async () => new Response(JSON.stringify([up]), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const ctx = { fillRect() {}, fillText() {}, measureText: (t: string) => ({ width: t.length * 8 }) }
  // Only the posters' sheets (640 px wide) draw on the stand-in; the sky's canvas is left as it was.
  const real = HTMLCanvasElement.prototype.getContext
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    ...args: Parameters<typeof real>
  ) {
    return this.width === 640 ? (ctx as never) : real.apply(this, args)
  })
  const posters = {
    near: vi.fn(),
    tap: vi.fn(),
    compose: vi.fn(),
    isOpen: vi.fn(() => false),
    left: vi.fn(),
    gone: vi.fn(),
  }
  const { session, stage, tick, hooks: h } = openLive(async () => 'dev.asha.1', { posters })
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  const ws = sockets()[0]!
  ws.onopen?.()
  ws.say({ t: 'welcome', you: { id: 'dev:asha', visible: true }, people: [] })
  await settle()
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toMatch(/\/api\/districts\/walled-city\/posters$/)
  expect(init.headers).toEqual({ Authorization: 'Bearer dev.asha.1' })
  const wall = () => stage.scene.getObjectByName('posters-0')!
  expect(wall().visible).toBe(true)
  // A tap where slot 2 hangs (top right, as the wall faces you: its face is to +x) opens that poster.
  const canvas = document.querySelector('canvas')!
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
  stage.camera.position.set(-1, 2, 46.8)
  stage.camera.lookAt(-5.775, 2, 46.8)
  stage.camera.updateMatrixWorld(true)
  const at = { clientX: 50, clientY: 50 }
  canvas.dispatchEvent(Object.assign(new Event('pointerdown'), at))
  canvas.dispatchEvent(Object.assign(new Event('pointerup'), at))
  expect(posters.tap).toHaveBeenCalledWith(up)
  ws.say({ t: 'poster', op: 'remove', id: 'p1' })
  expect(wall().visible).toBe(false)
  // A block changed what this person may see: the walls are fetched again.
  ws.say({ t: 'posters' })
  await settle()
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(wall().visible).toBe(true)

  // 1.5 m from the Johari Bazaar wall (it stands turned, its face along z): in reach, so E opens the composer.
  session.player()!.teleport(-4.5, 48)
  tick(1 / 30)
  expect(posters.near).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0 }), false)
  const person = vi.spyOn(h.personCard, 'step')
  const pressed = vi.spyOn(controls, 'interact').mockReturnValue(true)
  tick(1 / 30)
  expect(posters.compose).toHaveBeenCalledTimes(1)
  expect(person.mock.calls.at(-1)![2]).toBe(false) // the wall took the key
  posters.isOpen.mockReturnValue(true) // the composer is up: E leaves the wall alone
  tick(1 / 30)
  expect(posters.compose).toHaveBeenCalledTimes(1)
  pressed.mockRestore()

  session.dispose()
  expect(stage.scene.getObjectByName('posters-0')).toBeUndefined()
  expect(posters.left).toHaveBeenCalled()
  getContext.mockRestore()
  vi.unstubAllGlobals()
})

it('at the wheel a tap opens no card, E gets out, and nothing else handles E', async () => {
  const drive = { near: vi.fn(), driving: vi.fn(), blocked: vi.fn(), rescued: vi.fn() }
  const track = vi.fn<SessionHooks['track']>(() => null)
  const trackStation = vi.fn<SessionHooks['trackStation']>(() => false)
  const live = openLive(async () => null, { drive, track, trackStation })
  loads[0]!.resolve({
    ...fakeDistrict(walledCity),
    autos: { nearest: () => 0, pose: () => ({ x: 0, z: 0, ry: 0 }), take: vi.fn(), leave: vi.fn() },
  })
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
  const tap = vi.spyOn(live.hooks.personCard, 'tap')
  const personStep = vi.spyOn(live.hooks.personCard, 'step')
  const npcStep = vi.spyOn(live.hooks.npcCard, 'step')
  const interact = vi.spyOn(controls, 'interact')

  // E beside a parked auto mounts it, and Space is the horn's alone until they get out
  interact.mockReturnValueOnce(true)
  live.tick(0.016)
  expect(drive.driving).toHaveBeenLastCalledWith(true)
  expect(live.session.player()!.driving()).toBe(true)
  expect(controls.holdSpace).toHaveBeenLastCalledWith(true)

  // at the wheel, a tap on a person opens nothing
  tapCentre()
  expect(tap).not.toHaveBeenCalled()

  // E gets out, and no other system hears that press
  interact.mockReturnValueOnce(true)
  live.tick(0.016)
  expect(drive.driving).toHaveBeenLastCalledWith(false)
  expect(live.session.player()!.driving()).toBe(false)
  expect(controls.holdSpace).toHaveBeenLastCalledWith(false)
  for (const spy of [personStep, npcStep]) expect(spy.mock.calls.at(-1)![2]).toBe(false)
  expect(track.mock.calls.at(-1)![2]).toBe(false)
  expect(trackStation.mock.calls.at(-1)![2]).toBe(false)

  // on foot again, the same tap works
  tapCentre()
  expect(tap).toHaveBeenCalledOnce()
  interact.mockRestore()
  live.session.dispose()
})

it('travel while seated unseats first', async () => {
  const { session, ws, sent, bench } = await byTapri()
  session.sit()
  ws.say({ t: 'seated', bench: 'walled-city:4', seat: 2, with: [] })
  expect(bench.seated).toHaveBeenLastCalledWith(expect.objectContaining({ seat: 2 }))
  const trip = session.travelTo('mi-road')
  // the stand-up goes out before the next district has even loaded
  expect(sent().at(-1)).toEqual({ t: 'sit', bench: null })
  expect(bench.seated).toHaveBeenLastCalledWith(null)
  loads[1]!.resolve(fakeDistrict(miRoad))
  await trip
  session.dispose()
})

it('travel while driving dismounts first', async () => {
  const drive = { near: vi.fn(), driving: vi.fn(), blocked: vi.fn(), rescued: vi.fn() }
  const live = openLive(async () => null, { drive })
  const leave = vi.fn()
  loads[0]!.resolve({
    ...fakeDistrict(walledCity),
    autos: { nearest: () => 0, pose: () => ({ x: 0, z: 0, ry: 0 }), take: vi.fn(), leave },
  })
  await settle()
  const interact = vi.spyOn(controls, 'interact')
  interact.mockReturnValueOnce(true)
  live.tick(0.016)
  const player = live.session.player()!
  expect(player.driving()).toBe(true)
  const trip = live.session.travelTo('mi-road')
  expect(player.driving()).toBe(false) // out of the auto before the ride starts
  expect(leave).toHaveBeenCalled()
  expect(drive.driving).toHaveBeenLastCalledWith(false)
  loads[1]!.resolve(fakeDistrict(miRoad))
  await trip
  interact.mockRestore()
  live.session.dispose()
})

it('travel from an auto boxed in on every side gets out silently: no "blocked" toast, no "rescued" one', async () => {
  const drive = { near: vi.fn(), driving: vi.fn(), blocked: vi.fn(), rescued: vi.fn() }
  const live = openLive(async () => null, { drive })
  loads[0]!.resolve({
    ...fakeDistrict(walledCity),
    autos: { nearest: () => 0, pose: () => ({ x: 0, z: 0, ry: 0 }), take: vi.fn(), leave: vi.fn() },
  })
  await settle()
  const interact = vi.spyOn(controls, 'interact')
  interact.mockReturnValueOnce(true)
  live.tick(0.016)
  const player = live.session.player()!
  expect(player.driving()).toBe(true)
  vi.spyOn(player, 'exitPoint').mockReturnValue(null) // nowhere clear to stand
  const trip = live.session.travelTo('mi-road')
  expect(player.driving()).toBe(false)
  expect(drive.blocked).not.toHaveBeenCalled()
  expect(drive.rescued).not.toHaveBeenCalled()
  loads[1]!.resolve(fakeDistrict(miRoad))
  await trip
  interact.mockRestore()
  live.session.dispose()
})

it("a poster's card or composer keeps E and taps to itself, as any other card does", async () => {
  const posters = {
    near: vi.fn(),
    tap: vi.fn(),
    compose: vi.fn(),
    isOpen: vi.fn(() => true),
    left: vi.fn(),
    gone: vi.fn(),
  }
  const drive = { near: vi.fn(), driving: vi.fn(), blocked: vi.fn(), rescued: vi.fn() }
  const track = vi.fn<SessionHooks['track']>(() => null)
  const trackStation = vi.fn<SessionHooks['trackStation']>(() => false)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200 })),
  )
  const live = openLive(async () => null, { posters, drive, track, trackStation })
  loads[0]!.resolve({
    ...fakeDistrict(walledCity),
    autos: { nearest: () => 0, pose: () => ({ x: 0, z: 0, ry: 0 }), take: vi.fn(), leave: vi.fn() },
  })
  await settle()
  const ws = sockets()[0]!
  ws.onopen?.()
  const look = { skin: 2, outfit: 'sandstone', head: 'none' } as const
  ws.say({
    t: 'welcome',
    you: { id: null, visible: false },
    people: [{ id: 'p1', name: 'Asha', look, status: '', x: 0, z: -5, ry: 0 }],
  })
  const personStep = vi.spyOn(live.hooks.personCard, 'step')
  const npcStep = vi.spyOn(live.hooks.npcCard, 'step')
  const personTap = vi.spyOn(live.hooks.personCard, 'tap')
  // E, with an auto in reach: nothing under the card hears it
  const interact = vi.spyOn(controls, 'interact').mockReturnValueOnce(true)
  live.tick(0.016)
  expect(drive.driving).not.toHaveBeenCalled()
  expect(live.session.player()!.driving()).toBe(false)
  expect(track.mock.calls.at(-1)![2]).toBe(false)
  expect(trackStation.mock.calls.at(-1)![2]).toBe(false)
  for (const spy of [personStep, npcStep]) expect(spy.mock.calls.at(-1)![2]).toBe(false)
  // a tap on a person is told a card has the screen
  const canvas = document.querySelector('canvas')!
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
  live.stage.camera.position.set(0, 1, 0)
  live.stage.camera.lookAt(0, 1, -5)
  live.stage.camera.updateMatrixWorld(true)
  const at = { clientX: 50, clientY: 50 }
  canvas.dispatchEvent(Object.assign(new Event('pointerdown'), at))
  canvas.dispatchEvent(Object.assign(new Event('pointerup'), at))
  expect(personTap).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), true)
  // the card closes: E mounts the auto again
  posters.isOpen.mockReturnValue(false)
  interact.mockReturnValueOnce(true)
  live.tick(0.016)
  expect(drive.driving).toHaveBeenLastCalledWith(true)
  interact.mockRestore()
  live.session.dispose()
  vi.unstubAllGlobals()
})

it('a cancelled trip disposes the district that arrives late and keeps the old one', async () => {
  const { session } = open()
  const first = fakeDistrict(walledCity)
  loads[0]!.resolve(first)
  await settle()
  const stop = new AbortController()
  const trip = session.travelTo('mi-road', stop.signal)
  stop.abort()
  const late = fakeDistrict(miRoad)
  loads[1]!.resolve(late)
  await expect(trip).rejects.toThrow(/cancelled/)
  expect(late.dispose).toHaveBeenCalled()
  expect(session.district()).toBe(first)
  expect(first.dispose).not.toHaveBeenCalled()
  session.dispose()
})

it('a follower waits at the station through a metro ride and rejoins on the way back', async () => {
  const animals = { near: vi.fn(), following: vi.fn(), notice: vi.fn() }
  const { session } = open('walled-city', { animals })
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  session.player()!.teleport(2, 38.5) // beside the dog at (2, 38)
  session.callAnimal()
  expect(animals.following).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'dog' }))
  const dog = animals.following.mock.lastCall![0] as { id: string; name: string }

  const out = session.travelTo('mi-road')
  loads[1]!.resolve(fakeDistrict(miRoad))
  await out
  expect(animals.notice).toHaveBeenCalledWith({ kind: 'waiting', name: dog.name })
  expect(animals.following).toHaveBeenLastCalledWith(null) // Mi Road has its own animals

  const back = session.travelTo('walled-city')
  loads[2]!.resolve(fakeDistrict(walledCity))
  await back
  expect(animals.following).toHaveBeenLastCalledWith(expect.objectContaining({ id: dog.id }))
  session.dispose()
})

it('a failed trip leaves the follower where it is', async () => {
  const animals = { near: vi.fn(), following: vi.fn(), notice: vi.fn() }
  const { session } = open('walled-city', { animals })
  loads[0]!.resolve(fakeDistrict(walledCity))
  await settle()
  session.player()!.teleport(2, 38.5)
  session.callAnimal()
  const trip = session.travelTo('mi-road')
  loads[1]!.reject(new Error('chunk failed'))
  await expect(trip).rejects.toThrow()
  expect(animals.notice).not.toHaveBeenCalled()
  expect(animals.following).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'dog' }))
  session.dispose()
})

it('only a plain tap counts: a right click, a second finger on the canvas or a cancelled touch is not one', async () => {
  const { hooks: h, stage } = await withPersonAhead()
  const canvas = document.querySelector('canvas')!
  stage.camera.position.set(0, 1, 0)
  stage.camera.lookAt(0, 1, -5)
  stage.camera.updateMatrixWorld(true)
  const tap = vi.spyOn(h.personCard, 'tap')
  const fire = (type: string, extra: object = {}) =>
    canvas.dispatchEvent(Object.assign(new Event(type), { clientX: 50, clientY: 50, pointerId: 1 }, extra))
  const press = (down: object = {}, up: object = {}) => {
    fire('pointerdown', down)
    fire('pointerup', up)
  }
  press({ button: 2 })
  // a pinch: the second finger lands on the canvas, so neither lift is a tap
  fire('pointerdown', { pointerId: 1, button: 0 })
  fire('pointerdown', { pointerId: 2, button: 0 })
  fire('pointerup', { pointerId: 1 })
  fire('pointerup', { pointerId: 2 })
  fire('pointerdown', { button: 0 })
  fire('pointercancel')
  fire('pointerup')
  expect(tap).not.toHaveBeenCalled()
  press({ button: 0 }) // and a plain tap still works, the pinch's pointers having gone
  expect(tap).toHaveBeenCalledTimes(1)
})

it('a tap on the canvas counts while another thumb holds the joystick (a pointer that never touched the canvas)', async () => {
  const { hooks: h, stage } = await withPersonAhead()
  const canvas = document.querySelector('canvas')!
  stage.camera.position.set(0, 1, 0)
  stage.camera.lookAt(0, 1, -5)
  stage.camera.updateMatrixWorld(true)
  const tap = vi.spyOn(h.personCard, 'tap')
  // the joystick's primary touch (id 1) is down on its own element: the canvas never hears it
  const fire = (type: string, extra: object = {}) =>
    canvas.dispatchEvent(
      Object.assign(
        new Event(type),
        { clientX: 50, clientY: 50, isPrimary: false, pointerId: 2, button: 0 },
        extra,
      ),
    )
  fire('pointerdown')
  fire('pointerup')
  expect(tap).toHaveBeenCalledTimes(1)
})

it('a touch id that got stuck (no up or cancel ever came) stops blocking taps after the page loses focus or capture', async () => {
  const { hooks: h, stage, session } = await withPersonAhead()
  const canvas = document.querySelector('canvas')!
  stage.camera.position.set(0, 1, 0)
  stage.camera.lookAt(0, 1, -5)
  stage.camera.updateMatrixWorld(true)
  const tap = vi.spyOn(h.personCard, 'tap')
  const fire = (type: string, extra: object = {}) =>
    canvas.dispatchEvent(
      Object.assign(new Event(type), { clientX: 50, clientY: 50, pointerId: 1, button: 0 }, extra),
    )
  const tapOnce = () => {
    fire('pointerdown')
    fire('pointerup')
  }
  const stick = () => fire('pointerdown', { pointerId: 9 }) // its up never arrives
  const recoveries: [string, () => void][] = [
    ['blur', () => window.dispatchEvent(new Event('blur'))],
    ['lostpointercapture', () => fire('lostpointercapture', { pointerId: 9 })],
    [
      'visibilitychange to hidden',
      () => {
        const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
        document.dispatchEvent(new Event('visibilitychange'))
        hidden.mockRestore()
      },
    ],
  ]
  for (const [, recover] of recoveries) {
    stick()
    tapOnce()
    expect(tap).not.toHaveBeenCalled() // stuck: two pointers look down
    recover()
    tapOnce()
    expect(tap).toHaveBeenCalledTimes(1)
    tap.mockClear()
  }
  const offWindow = vi.spyOn(window, 'removeEventListener')
  const offDocument = vi.spyOn(document, 'removeEventListener')
  const offCanvas = vi.spyOn(canvas, 'removeEventListener')
  session.dispose()
  expect(offWindow).toHaveBeenCalledWith('blur', expect.any(Function))
  expect(offDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  expect(offCanvas).toHaveBeenCalledWith('lostpointercapture', expect.any(Function))
})

describe('drag to look', () => {
  /** A person dead ahead, and a way to fire pointer events on the canvas (100 px square). */
  async function lookable() {
    const live = await withPersonAhead()
    const canvas = document.querySelector('canvas')!
    live.stage.camera.position.set(0, 1, 0)
    live.stage.camera.lookAt(0, 1, -5)
    live.stage.camera.updateMatrixWorld(true)
    const tap = vi.spyOn(live.hooks.personCard, 'tap')
    vi.mocked(controls.addLook).mockClear()
    vi.mocked(controls.holdLook).mockClear()
    const fire = (type: string, x: number, y = 50, extra: object = {}) =>
      canvas.dispatchEvent(
        Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: 1, button: 0 }, extra),
      )
    return { ...live, canvas, tap, fire }
  }
  const turned = () =>
    vi
      .mocked(controls.addLook)
      .mock.calls.reduce((sum, [yaw, pitch]) => [sum[0]! + yaw, sum[1]! + pitch], [0, 0])

  it('a drag across the canvas turns the view (right turns it right) and is not a tap', async () => {
    const { fire, tap, canvas } = await lookable()
    fire('pointerdown', 50)
    fire('pointermove', 54) // inside the tap slop: nothing yet
    expect(controls.addLook).not.toHaveBeenCalled()
    fire('pointermove', 70)
    expect(canvas.hasAttribute('data-looking')).toBe(true) // the grabbing cursor
    fire('pointermove', 100, 40)
    fire('pointerup', 50) // even back where it began, a drag is never a tap
    expect(tap).not.toHaveBeenCalled()
    expect(canvas.hasAttribute('data-looking')).toBe(false)
    const [yaw, pitch] = turned()
    // half the canvas's width past the slop: right is a negative yaw, between 180° and 270° a full width
    expect(-yaw / 0.5).toBeGreaterThan(Math.PI * 0.9)
    expect(-yaw / 0.5).toBeLessThan(Math.PI * 1.5)
    expect(pitch).toBeGreaterThan(0) // the finger went up: the view tilts up
    fire('pointermove', 10) // let go: moving again (a hovering mouse) turns nothing
    expect(turned()[0]).toBe(yaw)
  })

  it('a small wobble is still a tap, and turns nothing', async () => {
    const { fire, tap } = await lookable()
    fire('pointerdown', 50)
    fire('pointermove', 55, 53)
    fire('pointerup', 55, 53)
    expect(tap).toHaveBeenCalledTimes(1)
    expect(controls.addLook).not.toHaveBeenCalled()
  })

  it('looks with one thumb on the canvas while the other holds the joystick (a pointer the canvas never hears)', async () => {
    const { fire, tap } = await lookable()
    // the joystick's touch (id 1) is on its own element; the look thumb is id 2, not primary
    const second = { pointerId: 2, isPrimary: false }
    fire('pointerdown', 50, 50, second)
    fire('pointermove', 80, 50, second)
    expect(turned()[0]).toBeLessThan(0)
    fire('pointerup', 80, 50, second)
    expect(tap).not.toHaveBeenCalled()
    // and the next tap with that thumb is a tap
    fire('pointerdown', 50, 50, second)
    fire('pointerup', 50, 50, second)
    expect(tap).toHaveBeenCalledTimes(1)
  })

  it('a second finger on the canvas does not take over the look, and a right-button drag does not look', async () => {
    const { fire } = await lookable()
    fire('pointerdown', 50)
    fire('pointerdown', 50, 50, { pointerId: 2 })
    fire('pointermove', 90, 50, { pointerId: 2 })
    expect(controls.addLook).not.toHaveBeenCalled()
    fire('pointerup', 90, 50, { pointerId: 2 })
    fire('pointerup', 50)
    fire('pointerdown', 50, 50, { button: 2 })
    fire('pointermove', 90)
    fire('pointerup', 90)
    expect(controls.addLook).not.toHaveBeenCalled()
  })

  it('a lost pointer or a blur ends the drag; dispose takes the move listener off the canvas', async () => {
    const { fire, canvas, session } = await lookable()
    fire('pointerdown', 50)
    fire('pointermove', 80)
    window.dispatchEvent(new Event('blur'))
    expect(canvas.hasAttribute('data-looking')).toBe(false)
    vi.mocked(controls.addLook).mockClear()
    fire('pointermove', 20)
    expect(controls.addLook).not.toHaveBeenCalled()
    const off = vi.spyOn(canvas, 'removeEventListener')
    session.dispose()
    expect(off).toHaveBeenCalledWith('pointermove', expect.any(Function))
  })
  it('a mouse let go of off the canvas (over a chip or a card) stops looking at its next hover, and the next click is a tap', async () => {
    const { fire, tap, canvas } = await lookable()
    const mouse = { pointerType: 'mouse' }
    fire('pointerdown', 50, 50, { ...mouse, buttons: 1 })
    // released over the HUD: the canvas never hears the up; the next it hears is a hover with no button held
    fire('pointermove', 90, 50, { ...mouse, buttons: 0 })
    fire('pointermove', 20, 30, { ...mouse, buttons: 0 })
    expect(controls.addLook).not.toHaveBeenCalled()
    expect(canvas.hasAttribute('data-looking')).toBe(false)
    fire('pointerdown', 50, 50, { ...mouse, buttons: 1 })
    fire('pointerup', 50, 50, { ...mouse, buttons: 0 })
    expect(tap).toHaveBeenCalledTimes(1)
    // and a real mouse drag (main button held) still looks
    fire('pointerdown', 50, 50, { ...mouse, buttons: 1 })
    fire('pointermove', 80, 50, { ...mouse, buttons: 1 })
    expect(turned()[0]).toBeLessThan(0)
    fire('pointerup', 80, 50, mouse)
  })

  it('says a look is held from the moment a drag begins until it lets go, however still the finger is', async () => {
    const { fire } = await lookable()
    fire('pointerdown', 50)
    fire('pointermove', 54)
    expect(controls.holdLook).not.toHaveBeenCalled() // inside the slop it may still be a tap
    fire('pointermove', 70)
    expect(controls.holdLook).toHaveBeenLastCalledWith(true)
    fire('pointerup', 70)
    expect(controls.holdLook).toHaveBeenLastCalledWith(false)
    fire('pointerdown', 50)
    fire('pointermove', 70)
    window.dispatchEvent(new Event('blur')) // a lost drag lets go too
    expect(controls.holdLook).toHaveBeenLastCalledWith(false)
  })

  it('a second finger landing mid-drag makes it a pinch: the view stops turning and the street zooms instead', async () => {
    const { fire, canvas, tap } = await lookable()
    vi.mocked(controls.addZoom).mockClear()
    fire('pointerdown', 45)
    fire('pointermove', 30) // past the slop: looking
    expect(canvas.hasAttribute('data-looking')).toBe(true)
    fire('pointerdown', 60, 50, { pointerId: 2 })
    expect(canvas.hasAttribute('data-looking')).toBe(false)
    expect(controls.holdLook).toHaveBeenLastCalledWith(false)
    const [yaw] = turned()
    fire('pointermove', 10) // fingers spread: 30 px apart to 50
    fire('pointermove', 80, 50, { pointerId: 2 })
    expect(turned()[0]).toBe(yaw) // no more turn
    expect(controls.addZoom).toHaveBeenCalled()
    const k = vi.mocked(controls.addZoom).mock.calls.reduce((m, [f]) => m * f, 1)
    expect(k).toBeCloseTo(30 / 70)
    fire('pointerup', 80, 50, { pointerId: 2 })
    fire('pointerup', 10)
    expect(tap).not.toHaveBeenCalled()
  })

  it('the mouse wheel over the street zooms', async () => {
    const { canvas } = await lookable()
    vi.mocked(controls.addZoom).mockClear()
    canvas.dispatchEvent(
      Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 100, deltaMode: 0 }),
    )
    expect(vi.mocked(controls.addZoom).mock.calls[0]![0]).toBeGreaterThan(1)
  })
})

describe('the auto-taxi', () => {
  /** Johari Bazaar's auto, at its stand, and the player beside it; the socket welcomed, as a ghost. */
  async function byStand({
    open = true,
    extra = {},
  }: { open?: boolean; extra?: Partial<SessionHooks> } = {}) {
    const taxi = { near: vi.fn(), riding: vi.fn(), dark: vi.fn(), refused: vi.fn() }
    const live = openLive(async () => null, { taxi, ...extra })
    const home = { x: -2.6, z: 30, ry: -Math.PI }
    let taken = false
    loads[0]!.resolve({
      ...fakeDistrict(walledCity),
      autos: {
        nearest: (p: { x: number; z: number }, r: number) =>
          !taken && Math.hypot(p.x - home.x, p.z - home.z) <= r ? 0 : -1,
        pose: () => home,
        take: () => void (taken = true),
        leave: () => void (taken = false),
      },
    })
    await settle()
    live.session.player()!.teleport(-0.6, 30)
    const ws = sockets()[0]!
    if (open) {
      ws.onopen?.()
      ws.say({ t: 'welcome', you: { id: null, visible: false }, people: [] })
    }
    live.tick(1 / 30)
    const sent = () => ws.sent.map((m) => JSON.parse(m) as { t: string })
    return { ...live, ws, taxi, sent }
  }

  it('the ride goes out on the socket from where the player stood, and no move goes out until it ends', async () => {
    const { session, tick, taxi, sent } = await byStand()
    expect(taxi.near).toHaveBeenLastCalledWith(true)
    let t = Date.now()
    const now = vi.spyOn(Date, 'now').mockImplementation(() => t)
    try {
      const before = sent().length
      expect(session.taxi('hawa-mahal')).toBe(true)
      expect(sent().slice(before)).toEqual([{ t: 'ride', to: 'hawa-mahal', x: -0.6, z: 30 }])
      expect(taxi.riding).toHaveBeenLastCalledWith(true)
      // "Auto chalao" cannot take the wheel from the taxi
      session.mount()
      for (let i = 0; i < 10; i++) {
        t += 1000 // past any throttle: the player is in the auto, but says nothing of it
        tick(1 / 30)
      }
      expect(sent().slice(before + 1)).toEqual([])
      session.skipTaxi()
      expect(taxi.riding).toHaveBeenLastCalledWith(false)
      t += 1000
      tick(1 / 30)
      // on foot by Hawa Mahal: that is where the next move says the player is
      expect(sent().at(-1)).toMatchObject({ t: 'move' })
      const p = session.player()!.position()
      expect(Math.hypot(p.x - 35, p.z + 12.5)).toBeLessThanOrEqual(6)
    } finally {
      now.mockRestore()
      session.dispose()
    }
  })

  it('while the district socket is not open there is no ride: the driver says no, and nothing is sent', async () => {
    const { session, taxi, sent } = await byStand({ open: false })
    expect(session.taxi('hawa-mahal')).toBe(false)
    expect(taxi.refused).toHaveBeenCalled()
    expect(taxi.riding).not.toHaveBeenCalledWith(true)
    expect(session.player()!.driving()).toBe(false)
    expect(sent()).toEqual([])
    session.dispose()
  })

  it('mid-ride E mounts no other auto ("Auto chalao" has no reach from the taxi)', async () => {
    const drive = { near: vi.fn(), driving: vi.fn(), blocked: vi.fn(), rescued: vi.fn() }
    const { session, tick } = await byStand({ extra: { drive } })
    const interact = vi.spyOn(controls, 'interact')
    try {
      expect(session.taxi('hawa-mahal')).toBe(true)
      // the stand's auto is taken; another in reach (a second auto parked behind it) is what E would mount
      session.district()!.autos.nearest = () => 0
      tick(1 / 30)
      expect(drive.near).not.toHaveBeenLastCalledWith(true)
      interact.mockReturnValueOnce(true)
      tick(1 / 30)
      expect(drive.driving).not.toHaveBeenCalledWith(true)
    } finally {
      interact.mockRestore()
      session.dispose()
    }
  })

  it("the server's no-ride ends the ride by the stand, and is no bench's business", async () => {
    const { session, ws, taxi, hooks: h } = await byStand()
    session.taxi('hawa-mahal')
    ws.say({ t: 'error', code: 'no-ride' })
    expect(taxi.refused).toHaveBeenCalled()
    expect(taxi.riding).toHaveBeenLastCalledWith(false)
    expect(h.bench!.refused).not.toHaveBeenCalled()
    const p = session.player()!.position()
    expect(Math.hypot(p.x + 2.6, p.z - 30)).toBeLessThanOrEqual(6)
    session.dispose()
  })
})

describe('the rooftop viewpoint', () => {
  afterEach(() => vi.useRealTimers())

  it('up on the roof there is no "Le chalo" for an auto at its stand below', async () => {
    const taxi = { near: vi.fn(), riding: vi.fn(), dark: vi.fn(), refused: vi.fn() }
    const live = open('walled-city', { roof: { near: vi.fn(), up: vi.fn(), fade: vi.fn() }, taxi })
    loads[0]!.resolve({
      ...fakeDistrict(walledCity),
      // an auto at Johari Bazaar's stand, and (as far as the street can tell) in reach
      autos: { nearest: () => 0, pose: () => ({ x: -2.6, z: 30, ry: -Math.PI }), take() {}, leave() {} },
    })
    await settle()
    vi.useFakeTimers()
    const roof = walledCity.roof!
    live.session.player()!.teleport(roof.stair.x, roof.stair.z)
    live.tick(1 / 30)
    expect(taxi.near).toHaveBeenLastCalledWith(true)
    live.session.climb()
    vi.advanceTimersByTime(ROOF_FADE_MS * 2)
    live.tick(1 / 30)
    expect(live.session.player()!.elevation()).toBe(roof.y)
    expect(taxi.near).toHaveBeenLastCalledWith(false)
    expect(live.session.taxi('hawa-mahal')).toBe(false)
    live.session.dispose()
  })

  /** The Walled City offline, the player at its stair's foot, with the rooftop's hooks spied on. */
  async function atStair(extra: Partial<SessionHooks> = {}, nearestAuto = -1) {
    const roofHooks = { near: vi.fn(), up: vi.fn(), fade: vi.fn() }
    const live = open('walled-city', { roof: roofHooks, ...extra })
    loads[0]!.resolve({
      ...fakeDistrict(walledCity),
      autos: {
        nearest: () => nearestAuto,
        pose: () => ({ x: 0, z: 0, ry: 0 }),
        take: vi.fn(),
        leave: vi.fn(),
      },
    })
    await settle()
    vi.useFakeTimers()
    const roof = walledCity.roof!
    live.session.player()!.teleport(roof.stair.x, roof.stair.z)
    live.tick(1 / 30)
    return { ...live, roof, roofHooks }
  }
  const press = (tick: (dt: number) => void) => {
    const interact = vi.spyOn(controls, 'interact').mockReturnValueOnce(true)
    tick(1 / 30)
    interact.mockRestore()
  }
  const fadeThrough = (tick: (dt: number) => void) => {
    vi.advanceTimersByTime(ROOF_FADE_MS * 2)
    tick(1 / 30)
  }

  it('E at the stair climbs, the view turns out over the street, and E on the roof comes down to the stair', async () => {
    const { session, tick, roof, roofHooks, hooks: h } = await atStair()
    expect(roofHooks.near).toHaveBeenLastCalledWith(true)
    const npc = vi.spyOn(h.npcCard, 'step')
    vi.mocked(controls.addLook).mockClear()
    press(tick)
    // the stair had the key: nothing after it in line heard that press
    expect(npc.mock.calls.at(-1)![2]).toBe(false)
    fadeThrough(tick)
    expect(roofHooks.up).toHaveBeenLastCalledWith(true)
    expect(session.player()!.position()).toEqual(roof.landing)
    expect(session.player()!.elevation()).toBe(roof.y)
    expect(controls.addLook).toHaveBeenCalled()
    // up there E comes down, and nothing else hears it
    press(tick)
    expect(npc.mock.calls.at(-1)![2]).toBe(false)
    fadeThrough(tick)
    expect(roofHooks.up).toHaveBeenLastCalledWith(false)
    expect(session.player()!.position()).toEqual(roof.stair)
    expect(session.player()!.elevation()).toBe(0)
    session.dispose()
  })

  it('the button climbs too; not with a card up (E closes the card), and not at the wheel', async () => {
    const { session, tick, roofHooks, hooks: h } = await atStair()
    const open = vi.spyOn(h.npcCard, 'isOpen').mockReturnValue(true)
    press(tick)
    fadeThrough(tick)
    expect(roofHooks.up).not.toHaveBeenCalled()
    open.mockReturnValue(false)
    // at the wheel the button does nothing
    const wheel = vi.spyOn(session.player()!, 'driving').mockReturnValue(true)
    session.climb()
    fadeThrough(tick)
    expect(roofHooks.up).not.toHaveBeenCalled()
    wheel.mockRestore()
    session.climb()
    fadeThrough(tick)
    expect(roofHooks.up).toHaveBeenLastCalledWith(true)
    session.dispose()
    expect(roofHooks.up).toHaveBeenLastCalledWith(false)
  })

  it('an auto in reach of the stair outranks it: E drives', async () => {
    const drive = { near: vi.fn(), driving: vi.fn(), blocked: vi.fn(), rescued: vi.fn() }
    const { session, tick, roofHooks } = await atStair({ drive }, 0)
    press(tick)
    fadeThrough(tick)
    expect(drive.driving).toHaveBeenLastCalledWith(true)
    expect(roofHooks.up).not.toHaveBeenCalled()
    session.dispose()
  })

  it('up on the roof no auto is in reach: "Auto chalao" goes, and mounting is refused', async () => {
    const drive = { near: vi.fn(), driving: vi.fn(), blocked: vi.fn(), rescued: vi.fn() }
    const { session, tick, roofHooks } = await atStair({ drive }, 0)
    expect(drive.near).toHaveBeenLastCalledWith(true)
    session.climb()
    fadeThrough(tick)
    expect(roofHooks.up).toHaveBeenLastCalledWith(true)
    expect(drive.near).toHaveBeenLastCalledWith(false)
    session.mount()
    tick(1 / 30)
    expect(drive.driving).not.toHaveBeenCalled()
    expect(session.player()!.driving()).toBe(false)
    session.dispose()
  })

  it('other people on the roof are drawn up there; on the street, on the street', async () => {
    const live = openLive()
    loads[0]!.resolve(fakeDistrict(walledCity))
    await settle()
    const ws = sockets()[0]!
    ws.onopen?.()
    const roof = walledCity.roof!
    ws.say({
      t: 'welcome',
      you: { id: null, visible: false },
      people: [
        { ...asha, x: roof.landing.x, z: roof.landing.z },
        { ...asha, id: 'dev:ravi', x: roof.stair.x, z: roof.stair.z },
      ],
    })
    live.session.player()!.teleport(roof.stair.x, roof.stair.z)
    live.tick(1 / 30)
    expect(live.stage.scene.getObjectByName('person-dev:asha')!.position.y).toBe(roof.y)
    expect(live.stage.scene.getObjectByName('person-dev:ravi')!.position.y).toBe(0)
    live.session.dispose()
  })
})
