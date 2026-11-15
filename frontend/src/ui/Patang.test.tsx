// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as THREE from 'three'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import type { Controls } from '../player/controls'
import { loadBest } from '../games/patang'
import { storage } from '../storage'
import { Patang } from './Patang'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let frames: ((dt: number) => void)[]
let scene: THREE.Scene
let stage: Stage
let controls: Controls
const at = { x: 3, z: 4 }

beforeEach(() => {
  frames = []
  scene = new THREE.Scene()
  stage = {
    scene,
    camera: new THREE.PerspectiveCamera(60, 0.5),
    quality: 2,
    onFrame: (cb: (dt: number) => void) => {
      frames.push(cb)
      return () => void (frames = frames.filter((f) => f !== cb))
    },
  } as unknown as Stage
  controls = { freeze: vi.fn() } as unknown as Controls
  document.body.innerHTML = '<div id="app"></div>'
  root = createRoot(document.getElementById('app')!)
})
afterEach(() => {
  act(() => root.unmount())
  storage.clear()
  vi.unstubAllEnvs()
  delete (window as { __gg?: unknown }).__gg
})

const mount = (onExit = () => {}) =>
  act(() => root.render(<Patang lang="en" stage={stage} controls={controls} at={at} onExit={onExit} />))
const key = (code: string, type = 'keydown') => {
  const e = new KeyboardEvent(type, { code, key: code, cancelable: true, bubbles: true })
  act(() => void document.body.dispatchEvent(e))
  return e
}

it('keeps the keys to itself, leaves on Escape, and cleans up the sky it drew', () => {
  const onExit = vi.fn()
  const seen = vi.fn()
  window.addEventListener('keydown', seen)
  mount(onExit)
  expect(scene.getObjectByName('patang')).toBeDefined()
  expect(frames).toHaveLength(1)
  key('KeyW')
  expect(seen).not.toHaveBeenCalled() // the city does not hear it
  key('Escape')
  expect(onExit).toHaveBeenCalledTimes(1)
  window.removeEventListener('keydown', seen)
  act(() => root.render(<></>))
  expect(scene.getObjectByName('patang')).toBeUndefined()
  expect(frames).toHaveLength(0)
  expect(controls.freeze).toHaveBeenLastCalledWith(false)
})

it('holds the player still and inerts its siblings, and hands both back', () => {
  document.body.innerHTML = '<div id="app"></div>'
  const app = document.getElementById('app')!
  const r = createRoot(app)
  const page = (open: boolean) => (
    <>
      <canvas />
      <aside id="hud" />
      {open && <Patang lang="en" stage={stage} controls={controls} at={at} onExit={() => {}} />}
    </>
  )
  act(() => r.render(page(false)))
  act(() => r.render(page(true)))
  expect(app.querySelector('canvas')!.hasAttribute('inert')).toBe(true)
  expect(app.querySelector('#hud')!.hasAttribute('inert')).toBe(true)
  expect(app.querySelector('.patang')!.hasAttribute('inert')).toBe(false)
  expect(controls.freeze).toHaveBeenLastCalledWith(true)
  act(() => r.render(page(false)))
  expect(controls.freeze).toHaveBeenLastCalledWith(false)
  expect(app.querySelector('canvas')!.hasAttribute('inert')).toBe(false)
  expect(app.querySelector('#hud')!.hasAttribute('inert')).toBe(false)
  act(() => r.unmount())
})

it('makes a sibling that arrives while the game is up inert too, and gives it back', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  const app = document.getElementById('app')!
  const r = createRoot(app)
  const page = (open: boolean) => (
    <>
      <canvas />
      {open && <Patang lang="en" stage={stage} controls={controls} at={at} onExit={() => {}} />}
    </>
  )
  act(() => r.render(page(true)))
  const late = app.appendChild(document.createElement('div')) // a toast, a card: not there when the game opened
  await act(async () => {})
  expect(late.hasAttribute('inert')).toBe(true)
  act(() => r.render(page(false)))
  expect(late.hasAttribute('inert')).toBe(false)
  act(() => r.unmount())
})

it('shows the score when the round is over, with Again and Stop', () => {
  mount()
  act(() => {
    for (let i = 0; i < 300; i++) frames.forEach((f) => f(0.25))
  })
  expect(document.querySelector('.patang-score')).not.toBeNull()
  const labels = [...document.querySelectorAll('.patang-score button')].map((b) => b.textContent)
  expect(labels).toEqual(['Again', 'Stop'])
  expect(document.querySelector('.patang-score')!.textContent).toMatch(/Cuts: \d+/)
  expect(document.querySelector('.patang-score')!.textContent).toMatch(/Best: \d+/)
})

it('keeps the cuts made so far when the player leaves mid-round', () => {
  vi.stubEnv('VITE_TEST_HOOKS', '1')
  history.replaceState(null, '', '/?gg-test=1')
  mount()
  act(() => window.__gg.patang().forceCross())
  key('Space') // hold pull
  act(() => {
    for (let i = 0; i < 90; i++) frames.forEach((f) => f(1 / 60))
  })
  expect(window.__gg.patang().score()).toBeGreaterThanOrEqual(1)
  expect(loadBest()).toBe(0) // the round is not over
  act(() => root.render(<></>)) // Stop, Escape or the festival ending all unmount it
  expect(loadBest()).toBeGreaterThanOrEqual(1)
  history.replaceState(null, '', '/')
})

it('the step and pause hooks: only a test moves the round on, by a fixed stretch with what is held', () => {
  vi.stubEnv('VITE_TEST_HOOKS', '1')
  history.replaceState(null, '', '/?gg-test=1')
  mount()
  act(() => window.__gg.patang().forceCross())
  act(() => window.__gg.patang().step(0.3))
  expect(window.__gg.patang().score()).toBe(0) // nobody pulling: no contest
  key('Space') // hold pull, the rival still tied across
  act(() => window.__gg.patang().pause(true))
  act(() => {
    for (let i = 0; i < 60; i++) frames.forEach((f) => f(1 / 30))
  })
  expect(window.__gg.patang().score()).toBe(0) // paused: two seconds of frames move nothing on
  act(() => window.__gg.patang().step(0.7)) // past the 0.6 s contest, and not one frame drawn
  expect(window.__gg.patang().score()).toBeGreaterThanOrEqual(1) // any other string it crosses goes too
  history.replaceState(null, '', '/')
})

it('Enter on the focused Pull button holds the pull, like Space', () => {
  mount()
  const pull = document.querySelector<HTMLElement>('.patang-pull')!
  const down = new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', cancelable: true, bubbles: true })
  act(() => void pull.dispatchEvent(down))
  expect(down.defaultPrevented).toBe(true) // taken as a hold, not a click
  const stop = document.querySelector<HTMLElement>('.patang-stop')!
  const other = new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', cancelable: true, bubbles: true })
  act(() => void stop.dispatchEvent(other))
  expect(other.defaultPrevented).toBe(false) // Stop still clicks
})

it('Again hands focus to the dialog (the button that had it is gone), and the next round runs', () => {
  mount()
  act(() => {
    for (let i = 0; i < 300; i++) frames.forEach((f) => f(0.25))
  })
  const again = document.querySelector<HTMLButtonElement>('.patang-score button')!
  expect(document.activeElement).toBe(again)
  act(() => again.click())
  expect(document.querySelector('.patang-score')).toBeNull()
  expect(document.activeElement).toBe(document.querySelector('.patang'))
  expect(frames).toHaveLength(1) // the first round's frame callback was let go
})

it('a click with no press before it (assistive tech) pulls for a moment, then lets go', () => {
  vi.useFakeTimers()
  try {
    vi.stubEnv('VITE_TEST_HOOKS', '1')
    history.replaceState(null, '', '/?gg-test=1')
    mount()
    act(() => window.__gg.patang().forceCross())
    const pull = document.querySelector<HTMLButtonElement>('.patang-pull')!
    // detail 0: what a screen reader's activate sends
    act(() => void pull.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
    act(() => window.__gg.patang().step(0.7))
    expect(window.__gg.patang().score()).toBeGreaterThanOrEqual(1) // it pulled through the contest
    act(() => void vi.advanceTimersByTime(900)) // past the pull's end
    act(() => window.__gg.patang().forceCross())
    const before = window.__gg.patang().score()
    act(() => window.__gg.patang().step(0.7))
    expect(window.__gg.patang().score()).toBe(before) // let go: nobody pulling, no contest
  } finally {
    vi.useRealTimers()
    history.replaceState(null, '', '/')
  }
})

it('on the way out, focus goes back to the element that had it, else to the stage canvas', () => {
  document.body.innerHTML = '<div id="app"></div><canvas></canvas>'
  const r = createRoot(document.getElementById('app')!)
  act(() => r.render(<Patang lang="en" stage={stage} controls={controls} at={at} onExit={() => {}} />))
  act(() => r.render(<></>))
  const canvas = document.querySelector('canvas')!
  expect(canvas.tabIndex).toBe(-1)
  expect(document.activeElement).toBe(canvas)
  act(() => r.unmount())
})
