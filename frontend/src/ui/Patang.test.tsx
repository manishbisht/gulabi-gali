// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as THREE from 'three'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import type { Controls } from '../player/controls'
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
afterEach(() => act(() => root.unmount()))

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
