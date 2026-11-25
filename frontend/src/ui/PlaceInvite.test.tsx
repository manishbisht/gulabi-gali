// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PlaceInvite } from './PlaceInvite'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const HAWA = { id: 'hawa-mahal', kind: 'landmark', name: { hi: 'Hawa Mahal', en: 'Hawa Mahal' } } as const
const TAPRI = {
  id: 'walled-city:0',
  kind: 'tapri',
  name: { hi: 'Chai ki tapri 1', en: 'Chai stall 1' },
} as const

const mount = (place: Parameters<typeof PlaceInvite>[0]['place'] = HAWA, lang: 'hi' | 'en' = 'hi') =>
  act(async () => root.render(<PlaceInvite district="walled-city" place={place} lang={lang} />))
const button = () => host.querySelector('button')!
const note = () => host.querySelector('[role="status"]')
/** The status line is always there (a live region must exist before it speaks), empty while it has nothing. */
const quiet = () => {
  expect(note()).not.toBeNull()
  expect(note()!.textContent).toBe('')
}

it('"Bulao" opens the share sheet with a short line and the link to the place: nothing about the sharer', async () => {
  const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {})
  vi.stubGlobal('navigator', { share })
  await mount()
  expect(button().textContent).toBe('Bulao')
  // the accessible name starts with what it shows, and says where
  expect(button().getAttribute('aria-label')).toBe('Bulao: Hawa Mahal ka link bhejo')
  await act(async () => button().click())
  expect(share).toHaveBeenCalledWith({
    text: 'Gulabi Gali mein Hawa Mahal pe aao — yahin milte hain!',
    url: 'https://gulabi-gali.manishbisht.me/p/walled-city/hawa-mahal/',
  })
  quiet()
})

it('a bench or tapri links by its kind and number', async () => {
  const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {})
  vi.stubGlobal('navigator', { share })
  await mount(TAPRI, 'en')
  await act(async () => button().click())
  expect(share).toHaveBeenCalledWith({
    text: "Come to Chai stall 1 in Gulabi Gali — let's meet there!",
    url: 'https://gulabi-gali.manishbisht.me/p/walled-city/tapri-0/',
  })
})

it('with no share sheet (or a failed one) it copies the line and link, and says so for a moment', async () => {
  vi.useFakeTimers()
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  await mount()
  await act(async () => button().click())
  expect(writeText).toHaveBeenCalledWith(
    'Gulabi Gali mein Hawa Mahal pe aao — yahin milte hain! https://gulabi-gali.manishbisht.me/p/walled-city/hawa-mahal/',
  )
  expect(note()!.textContent).toBe('Link copy ho gaya')
  await act(async () => vi.advanceTimersByTime(4000))
  quiet()
})

it('closing the share sheet is no failure; neither sheet nor clipboard working says so', async () => {
  vi.stubGlobal('navigator', {
    share: vi.fn(async () => Promise.reject(Object.assign(new Error('closed'), { name: 'AbortError' }))),
    clipboard: { writeText: vi.fn() },
  })
  await mount()
  quiet()
  await act(async () => button().click())
  quiet()
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('no'))) } })
  await act(async () => button().click())
  expect(note()!.textContent).toBe('Link bhej nahi paye. Phir se try karo.')
})

it('`compact`: an icon with the same accessible name (for the cards, where a word would crowd the row)', async () => {
  const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {})
  vi.stubGlobal('navigator', { share })
  await act(async () => root.render(<PlaceInvite district="walled-city" place={HAWA} lang="en" compact />))
  expect(button().textContent).toBe('')
  expect(button().getAttribute('aria-label')).toBe('Invite: send a link to Hawa Mahal')
  expect(button().getAttribute('title')).toBe('Invite: send a link to Hawa Mahal')
  expect(button().querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  expect(button().classList.contains('place-invite-icon')).toBe(true)
  await act(async () => button().click())
  expect(share).toHaveBeenCalledOnce()
})
