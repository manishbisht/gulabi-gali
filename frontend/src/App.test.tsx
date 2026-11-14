// @vitest-environment happy-dom
import { act } from 'react'
import * as THREE from 'three'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

const webgl = vi.hoisted(() => ({ available: true }))
vi.mock('./engine/webgl', () => ({ hasWebGL: () => webgl.available }))
vi.mock('./engine/stage', () => ({
  createStage: () => ({
    quality: 2,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    onFrame: () => () => {},
    onQuality: () => () => {},
    framesSinceRestore: () => 0,
    dispose: () => {},
  }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  webgl.available = true
  vi.unstubAllGlobals()
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
