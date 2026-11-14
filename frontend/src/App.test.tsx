// @vitest-environment happy-dom
import { act } from 'react'
import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import type { DistrictId } from './net/protocol'
import malviyaNagar from './world/districts/malviyaNagar'
import miRoad from './world/districts/miRoad'
import university from './world/districts/university'
import walledCity from './world/districts/walledCity'
import type { DistrictDef } from './world/types'

const webgl = vi.hoisted(() => ({ available: true }))
vi.mock('./engine/webgl', () => ({ hasWebGL: () => webgl.available }))
/** The fake stage keeps its scene and listeners where the tests can count them. */
const stage = vi.hoisted(() => ({
  fail: false,
  scene: null as unknown as THREE.Scene,
  frames: new Set<(dt: number) => void>(),
  qualities: new Set<(q: number) => void>(),
}))
vi.mock('./engine/stage', () => ({
  createStage: () => {
    if (stage.fail) throw new Error('WebGL 1 is not supported since r163')
    stage.scene = new THREE.Scene()
    stage.frames.clear()
    stage.qualities.clear()
    return {
      quality: 2,
      scene: stage.scene,
      camera: new THREE.PerspectiveCamera(),
      onFrame: (f: (dt: number) => void) => (stage.frames.add(f), () => void stage.frames.delete(f)),
      onQuality: (f: (q: number) => void) => (stage.qualities.add(f), () => void stage.qualities.delete(f)),
      framesSinceRestore: () => 0,
      dispose: () => {},
    }
  },
}))
/** District ids whose chunk "fails to arrive". */
const unreachable = vi.hoisted(() => new Set<string>())
vi.mock('./world/district', async (importOriginal) => {
  const real = await importOriginal<typeof import('./world/district')>()
  return {
    ...real,
    // a chunk takes at least a turn of the event loop to arrive, as it does over the network
    loadDistrict: async (id: DistrictId) => {
      await new Promise((r) => setTimeout(r))
      if (unreachable.has(id)) throw new Error('chunk failed')
      return real.loadDistrict(id)
    },
  }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  webgl.available = true
  stage.fail = false
  unreachable.clear()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  localStorage.clear()
  document.body.innerHTML = ''
})

it('shows the intro, then the HUD over a canvas after Padharo, and persists the language', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))

  const enter = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Padharo!')
  expect(enter).toBeTruthy()
  expect(host.querySelector('canvas')).toBeNull()

  await act(async () => enter!.click())
  expect(host.querySelector('canvas')).not.toBeNull()
  expect(host.textContent).toContain('Ruko zara') // the district is still loading
  await vi.waitFor(() => expect(host.textContent).toContain('Gulabi Shahar'))

  const toggle = host.querySelector<HTMLButtonElement>('.lang-toggle')!
  await act(async () => toggle.click())
  expect(localStorage.getItem('gg-lang')).toBe('en')
  expect(host.textContent).toContain('Pink City')
  await act(async () => root.unmount())
})

it('shows the no-3D screen instead of the intro when WebGL is missing', async () => {
  webgl.available = false
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  expect(host.textContent).toContain("3D doesn't run on this phone/browser")
  expect(host.querySelector('.enter')).toBeNull()
  await act(async () => root.unmount())
})

it('shows the no-3D screen, not a blank page, when the renderer cannot start', async () => {
  stage.fail = true
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  expect(host.textContent).toContain("3D doesn't run on this phone/browser")
  expect(host.querySelector('canvas')).toBeNull()
  await act(async () => root.unmount())
})

it('reopens the city in the district last travelled to', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  localStorage.setItem('gg-district', 'mi-road')
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  await vi.waitFor(() => expect(host.querySelector('.hud-top')?.textContent).toMatch(/MI Road/))
  await act(async () => root.unmount())
})

const DEFS: Record<DistrictId, DistrictDef> = {
  'walled-city': walledCity,
  'mi-road': miRoad,
  university,
  'malviya-nagar': malviyaNagar,
}

/** Opens the city with the test hooks on, in Hinglish, starting in the Walled City. */
async function openCity() {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  vi.stubEnv('VITE_TEST_HOOKS', '1') // the hooks are a build-time opt-in
  history.replaceState(null, '', '/?gg-test=1')
  localStorage.setItem('gg-lang', 'hi')
  localStorage.setItem('gg-district', 'walled-city')
  delete (window as { __gg?: unknown }).__gg // hooks left by an earlier test's city
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))
  await act(async () => host.querySelector<HTMLButtonElement>('.enter')!.click())
  await vi.waitFor(() => expect(window.__gg?.district()).toBe('walled-city'))
  return { host, root }
}

const tick = () => act(() => stage.frames.forEach((f) => f(1 / 30)))

/** Walks to the station, taps Metro and the district's name; resolves once the trip is over. */
async function ride(host: HTMLElement, to: DistrictId) {
  const here = DEFS[window.__gg.district()].station
  act(() => window.__gg.teleport(here.x, here.z))
  await tick()
  await act(async () => host.querySelector<HTMLButtonElement>('.metro-button')!.click())
  const stop = [...host.querySelectorAll<HTMLButtonElement>('.travel-stop')].find(
    (b) => b.textContent === DEFS[to].name.hi,
  )!
  await act(async () => stop.click())
  await vi.waitFor(() => expect(host.querySelector('.fade[data-on]')).toBeNull(), { timeout: 5000 })
}

it('travels round the city and leaves nothing behind', async () => {
  const live = new Set<unknown>()
  const realSet = globalThis.setInterval
  const realClear = globalThis.clearInterval
  vi.stubGlobal('setInterval', (...args: Parameters<typeof setInterval>) => {
    const id = realSet(...args)
    live.add(id)
    return id
  })
  vi.stubGlobal('clearInterval', (id: ReturnType<typeof setInterval>) => {
    live.delete(id)
    realClear(id)
  })
  const { host, root } = await openCity()
  const before = {
    children: stage.scene.children.length,
    frames: stage.frames.size,
    qualities: stage.qualities.size,
    timers: live.size,
    bubbles: host.querySelectorAll('.npc-bubble').length,
  }
  for (const to of ['mi-road', 'university', 'malviya-nagar', 'walled-city'] as DistrictId[]) {
    await ride(host, to)
    expect(window.__gg.district()).toBe(to)
    expect(localStorage.getItem('gg-district')).toBe(to)
    expect(host.querySelector('.hud-top')!.textContent).toContain(DEFS[to].name.hi)
    const cast = DEFS[to].npcs.map((n) => n.id).sort()
    expect(
      window.__gg
        .npcs()
        .map((n) => n.id)
        .sort(),
    ).toEqual(cast)
    // one district, its player, weather and festival groups, and its own characters: nothing left over
    const bodies = stage.scene.children.filter((c) => c.name.startsWith('npc-')).map((c) => c.name)
    expect(bodies.sort()).toEqual(cast.map((id) => `npc-${id}`))
    expect(stage.scene.children.filter((c) => DEFS[c.name as DistrictId]).map((c) => c.name)).toEqual([to])
    expect(stage.frames.size).toBe(before.frames)
    expect(stage.qualities.size).toBe(before.qualities)
    expect(live.size).toBe(before.timers)
    expect(host.querySelectorAll('.npc-bubble').length).toBe(before.bubbles)
    const p = window.__gg.position()
    expect(Math.hypot(p.x - DEFS[to].station.x, p.z - DEFS[to].station.z)).toBeLessThan(0.01)
  }
  expect(stage.scene.children.length).toBe(before.children) // back in the Walled City, as we started
  await act(async () => root.unmount())
}, 20000)

it('keeps the old district running when the new one fails to load, and says so', async () => {
  const { host, root } = await openCity()
  const frames = stage.frames.size
  unreachable.add('university')
  await ride(host, 'university')
  expect(window.__gg.district()).toBe('walled-city')
  expect(host.querySelector('.hud-top')!.textContent).toContain('Gulabi Shahar')
  expect(host.querySelector('[role="status"]')!.textContent).toContain(
    'University–JKK tak nahi pahunch paaye',
  )
  expect(localStorage.getItem('gg-district')).toBe('walled-city')
  expect(stage.frames.size).toBe(frames) // still walking: the frame loop never stopped
  expect(stage.scene.getObjectByName('walled-city')).toBeDefined()
  // and the next try goes through
  unreachable.clear()
  await ride(host, 'university')
  expect(window.__gg.district()).toBe('university')
  await act(async () => root.unmount())
}, 20000)
