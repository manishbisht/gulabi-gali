// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { storage } from '../storage'
import { FirstHint, HINTED_KEY } from './FirstHint'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
let coarse = false

beforeEach(() => {
  coarse = false
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' && coarse, media: q }))
  document.body.innerHTML = '<canvas class="stage"></canvas><div id="app"></div>'
  host = document.getElementById('app')!
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  storage.clear()
  vi.unstubAllGlobals()
})

const mount = (lang: 'hi' | 'en' = 'en') => act(() => root.render(<FirstHint lang={lang} />))
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')

it('on a first visit: a non-modal dialog with three steps, the keys for a keyboard, and focus on its button', () => {
  mount()
  const d = dialog()!
  expect(d.getAttribute('aria-modal')).toBe('false')
  expect(d.getAttribute('aria-labelledby')).toBe(d.querySelector('h2')!.id)
  const steps = [...d.querySelectorAll('li')].map((li) => li.textContent)
  expect(steps).toHaveLength(3)
  expect(steps[0]).toMatch(/W A S D/)
  expect(steps[1]).toMatch(/\bE\b/)
  expect(steps[2]).toMatch(/Say hello/)
  expect(document.activeElement).toBe(d.querySelector('button'))
})

it('on a touch screen it says joystick and tap instead', () => {
  coarse = true
  mount('hi')
  const steps = [...dialog()!.querySelectorAll('li')].map((li) => li.textContent)
  expect(steps[0]).toMatch(/joystick/)
  expect(steps[0]).not.toMatch(/W A S D/)
  expect(steps[1]).toMatch(/Baitho/)
})

it('its button closes it for good: gg-hinted is kept and focus goes back to the street', () => {
  mount()
  act(() => dialog()!.querySelector('button')!.click())
  expect(dialog()).toBeNull()
  expect(HINTED_KEY).toBe('gg-hinted')
  expect(storage.get('gg-hinted')).toBe('1')
  expect(document.activeElement).toBe(document.querySelector('canvas'))
  act(() => root.render(<></>))
  mount()
  expect(dialog()).toBeNull()
})

it('Escape closes it too', () => {
  mount()
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(dialog()).toBeNull()
  expect(storage.get('gg-hinted')).toBe('1')
})

it('is never shown once seen', () => {
  storage.set('gg-hinted', '1')
  mount()
  expect(dialog()).toBeNull()
})
