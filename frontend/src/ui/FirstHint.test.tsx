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
  expect(steps[0]).toMatch(/Look around: drag the street with the mouse, or Q and R/) // the turn keys
  expect(steps[1]).toMatch(/\bE\b/)
  expect(steps[2]).toMatch(/Say hello/)
  expect(document.activeElement).toBe(d.querySelector('button'))
})

it('under the steps, one line points at things to do, in either language', () => {
  mount('hi')
  let more = dialog()!.querySelector('.first-hint-more')!
  expect(more.textContent).toBe('Gali mein aur bhi bahut kuch hai: chai chakho, ghanti bajao, cricket khelo.')
  // a line, not a fourth step: the title still says three
  expect(dialog()!.querySelectorAll('li')).toHaveLength(3)
  expect(more.compareDocumentPosition(dialog()!.querySelector('button')!)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  )
  act(() => root.render(<></>))
  mount('en')
  more = dialog()!.querySelector('.first-hint-more')!
  expect(more.textContent).toBe(
    'There is plenty more in the gali: taste the chai, ring a bell, play cricket.',
  )
})

it('the keyboard line says Shift jogs, in either language', () => {
  mount('en')
  expect(dialog()!.querySelector('li')!.textContent).toMatch(/Hold Shift to jog/)
  act(() => root.render(<></>))
  mount('hi')
  expect(dialog()!.querySelector('li')!.textContent).toMatch(/Shift dabaye rakho/)
})

it('on a touch screen it says joystick and tap instead', () => {
  coarse = true
  mount('hi')
  const steps = [...dialog()!.querySelectorAll('li')].map((li) => li.textContent)
  expect(steps[0]).toMatch(/joystick/)
  expect(steps[0]).not.toMatch(/W A S D/)
  expect(steps[0]).toMatch(/Aas-paas dekhna: gali pe kahin bhi ungli ghumao/) // drag the street to look
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

it("an Escape that is for a sheet over the street leaves the hint open; a bare street's closes it", () => {
  mount()
  const sheet = document.body.appendChild(document.createElement('section'))
  sheet.setAttribute('aria-modal', 'true')
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(dialog()).not.toBeNull()
  expect(storage.get('gg-hinted')).toBeNull()
  sheet.remove()
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(dialog()).toBeNull()
})

it('is never shown once seen', () => {
  storage.set('gg-hinted', '1')
  mount()
  expect(dialog()).toBeNull()
})

it('Escape in the same task the dialog appears in already closes it: the key is heard from the commit, not after paint', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  try {
    let heard = false
    const seen = new Promise<void>((resolve) => {
      const mo = new MutationObserver(() => {
        if (!dialog()) return
        mo.disconnect()
        // the first microtask after the commit: the point a fast key press could land between commit and effects
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
        heard = storage.get(HINTED_KEY) === '1'
        resolve()
      })
      mo.observe(host, { childList: true, subtree: true })
    })
    root.render(<FirstHint lang="en" />)
    await seen
    expect(heard).toBe(true)
  } finally {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  }
})
