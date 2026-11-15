// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTaxi, type TaxiActions } from '../world/useTaxi'
import { TaxiRide } from './TaxiRide'
import { TaxiSheet } from './TaxiSheet'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  host = document.getElementById('app')!
  root = createRoot(host)
})
afterEach(() => act(() => root.unmount()))

const render = (node: ReactNode) => act(() => root.render(node))
const HAWA = { id: 'hawa-mahal', name: { hi: 'Hawa Mahal', en: 'Hawa Mahal' } }
const JANTAR = { id: 'jantar-mantar', name: { hi: 'Jantar Mantar', en: 'Jantar Mantar' } }

it('"Le chalo" lists the landmarks, each a button, and a way to close it', () => {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(<TaxiSheet stops={[HAWA, JANTAR]} lang="hi" onPick={onPick} onClose={onClose} />)
  const sheet = host.querySelector('section')!
  expect(sheet.getAttribute('aria-label')).toBe('Le chalo · kahan jaana hai?')
  expect([...sheet.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
    'Hawa Mahal',
    'Jantar Mantar',
    'Rehne do',
  ])
  act(() => sheet.querySelectorAll('button')[1]!.click())
  expect(onPick).toHaveBeenCalledWith(JANTAR)
  act(() => sheet.querySelectorAll('button')[2]!.click())
  expect(onClose).toHaveBeenCalled()
})

it('the ride: the place it heads for, a tap or Escape skips, keys go no further, and focus comes back', () => {
  const onSkip = vi.fn()
  render(
    <>
      <canvas />
      <button id="before">before</button>
    </>,
  )
  host.querySelector<HTMLButtonElement>('#before')!.focus()
  render(
    <>
      <canvas />
      <button id="before">before</button>
      <TaxiRide place="Hawa Mahal" lang="en" onSkip={onSkip} />
    </>,
  )
  const button = host.querySelector<HTMLButtonElement>('button.taxi-ride')!
  expect(button.getAttribute('aria-label')).toBe('In the auto — tap to skip')
  expect(document.activeElement).toBe(button)
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Off to Hawa Mahal')
  expect(host.querySelector('#before')!.hasAttribute('inert')).toBe(true)
  const heard = vi.fn()
  window.addEventListener('keydown', heard)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }))
  expect(heard).not.toHaveBeenCalled()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(onSkip).toHaveBeenCalledTimes(1)
  act(() => button.click())
  expect(onSkip).toHaveBeenCalledTimes(2)
  window.removeEventListener('keydown', heard)
  render(
    <>
      <canvas />
      <button id="before">before</button>
    </>,
  )
  expect(host.querySelector('#before')!.hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(host.querySelector('#before'))
})

it('useTaxi: the list opens with the district’s landmarks, a pick rides there, walking off closes it', () => {
  let taxi!: ReturnType<typeof useTaxi>
  function Probe() {
    taxi = useTaxi()
    return null
  }
  render(<Probe />)
  const actions: TaxiActions = {
    taxi: vi.fn(() => true),
    skipTaxi: vi.fn(),
    district: () => ({ def: { landmarks: [HAWA, JANTAR] } }) as never,
  }
  act(() => taxi.bind(actions))
  act(() => taxi.hooks.near(true))
  expect(taxi.near).toBe(true)
  act(() => taxi.open())
  expect(taxi.sheetOpen).toBe(true)
  expect(taxi.stops.map((s) => s.id)).toEqual(['hawa-mahal', 'jantar-mantar'])
  act(() => taxi.go(HAWA))
  expect(actions.taxi).toHaveBeenCalledWith('hawa-mahal')
  expect(taxi.sheetOpen).toBe(false)
  expect(taxi.place).toEqual(HAWA.name)
  act(() => taxi.hooks.riding(true))
  expect(taxi.riding).toBe(true)
  act(() => taxi.skip())
  expect(actions.skipTaxi).toHaveBeenCalled()
  act(() => taxi.hooks.riding(false))
  expect(taxi.riding).toBe(false)
  // walking away from the auto shuts the list
  act(() => taxi.open())
  act(() => taxi.hooks.near(false))
  expect(taxi.sheetOpen).toBe(false)
  // the driver's no: a passing line
  act(() => taxi.hooks.refused())
  expect(taxi.refused).toBe(true)
})
