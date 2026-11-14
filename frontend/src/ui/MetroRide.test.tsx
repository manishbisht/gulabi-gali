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

it('falls back to the stage when what had focus is gone', () => {
  const metro = document.getElementById('metro')!
  act(() => metro.focus())
  show()
  metroRemoved = true
  renderPage(null)
  expect(document.activeElement).toBe(document.querySelector('canvas'))
})
