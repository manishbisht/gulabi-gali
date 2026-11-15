// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MetroRide, STUCK_MS } from './MetroRide'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => {
  metroRemoved = false
  vi.useFakeTimers()
  document.body.innerHTML = '<div id="app"></div>'
  host = document.getElementById('app')!
  root = createRoot(host)
  renderPage(null)
})
afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
})

/** The page as App lays it out: the stage and a metro button, with the ride a sibling of them. */
let metroRemoved = false
function renderPage(ride: ReactNode) {
  act(() =>
    root.render(
      <>
        <canvas />
        {!metroRemoved && <button id="metro">Metro</button>}
        {ride}
      </>,
    ),
  )
}

const show = (over: Partial<Parameters<typeof MetroRide>[0]> = {}) => {
  const props = {
    from: 'walled-city',
    to: 'mi-road',
    lang: 'en',
    waiting: false,
    onSkip: vi.fn(),
    onBack: vi.fn(),
    ...over,
  } as const
  renderPage(<MetroRide {...props} />)
  return props
}

it('has a short label, a status outside the button, a skip click and focus on the button', () => {
  const props = show()
  const button = host.querySelector<HTMLButtonElement>('button.metro-ride')!
  expect(button.getAttribute('aria-label')).toBe('Metro ride — tap to skip')
  expect(document.activeElement).toBe(button)
  const status = host.querySelector('[role="status"]')!
  expect(button.contains(status)).toBe(false)
  expect(status.textContent).toContain('Next station: Sindhi Camp')
  act(() => button.click())
  expect(props.onSkip).toHaveBeenCalledOnce()
})

it('says it is waiting, and offers the way back only after 15 s of it', () => {
  const props = show({ waiting: true })
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Waiting at the next station')
  expect(host.querySelector('.metro-back')).toBeNull()
  act(() => void vi.advanceTimersByTime(STUCK_MS))
  const back = host.querySelector<HTMLButtonElement>('.metro-back')!
  expect(back.textContent).toBe('Go back')
  act(() => back.click())
  expect(props.onBack).toHaveBeenCalledOnce()
})

it('speaks Hinglish when asked', () => {
  show({ lang: 'hi' })
  expect(host.querySelector('button.metro-ride')!.getAttribute('aria-label')).toBe(
    'Metro safar — chhodne ke liye tap karo',
  )
})

it('makes the rest of the page inert, swallows game keys, and gives focus back when it goes', () => {
  const metro = document.getElementById('metro')!
  act(() => metro.focus())
  const canvas = host.querySelector('canvas')!
  show()
  expect(canvas.hasAttribute('inert')).toBe(true)
  const game = vi.fn()
  window.addEventListener('keydown', game)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
  expect(game).not.toHaveBeenCalled()
  window.removeEventListener('keydown', game)
  renderPage(null)
  expect(canvas.hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(metro)
})

it('makes a sibling that arrives meanwhile inert too, and gives it back', async () => {
  show()
  const late = host.appendChild(document.createElement('div'))
  await act(async () => {})
  expect(late.hasAttribute('inert')).toBe(true)
  renderPage(null)
  expect(late.hasAttribute('inert')).toBe(false)
})

it('falls back to the stage when what had focus is gone', () => {
  const metro = document.getElementById('metro')!
  act(() => metro.focus())
  show()
  metroRemoved = true
  renderPage(null)
  expect(document.activeElement).toBe(document.querySelector('canvas'))
})

it('once the wait drags on, focus moves to the way back, so a keyboard or screen reader finds it', () => {
  show({ waiting: true })
  expect(document.activeElement).toBe(host.querySelector('button.metro-ride'))
  act(() => vi.advanceTimersByTime(STUCK_MS))
  const back = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Go back')!
  expect(back).toBeDefined()
  expect(document.activeElement).toBe(back)
})

it('to or from Amer it is a bus, not the metro: its own look and its own words', () => {
  const props = show({ from: 'malviya-nagar', to: 'amer' })
  const button = host.querySelector<HTMLButtonElement>('button.metro-ride')!
  expect(button.getAttribute('data-by')).toBe('bus')
  expect(button.getAttribute('aria-label')).toBe('Bus ride — tap to skip')
  expect(button.querySelector('.bus-road')).not.toBeNull()
  expect(button.querySelector('.metro-tunnel')).toBeNull()
  expect(host.querySelector('[role="status"]')!.textContent).toContain('Next stop: Amer')
  act(() => button.click())
  expect(props.onSkip).toHaveBeenCalledOnce()
  show({ from: 'amer', to: 'walled-city', lang: 'hi' })
  expect(host.querySelector('button.metro-ride')!.getAttribute('aria-label')).toBe(
    'Bus safar — chhodne ke liye tap karo',
  )
  expect(host.querySelector('button.metro-ride')!.getAttribute('data-by')).toBe('bus')
})

it('between two metro stations the coach stays the metro', () => {
  show()
  expect(host.querySelector('button.metro-ride')!.getAttribute('data-by')).toBe('metro')
  expect(host.querySelector('.metro-tunnel')).not.toBeNull()
})
