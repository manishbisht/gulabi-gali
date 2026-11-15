// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { COUNT_POLL_MS } from '../live/useCityCount'
import { API_BASE } from '../net/api'
import { Intro } from './Intro'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
let answer: () => Promise<Response>
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => answer())

beforeEach(() => {
  vi.useFakeTimers()
  answer = async () => Response.json({ people: 0 })
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function mount(lang: 'hi' | 'en' = 'hi') {
  await act(async () =>
    root.render(<Intro lang={lang} onLang={() => {}} onEnter={() => {}} onPrivacy={() => {}} />),
  )
  // the count's fetch and its JSON
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}
const line = () => host.querySelector('.intro-count')

it('says how many people are in the lanes, from /api/count', async () => {
  answer = async () => Response.json({ people: 7 })
  await mount()
  expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/api/count`, expect.anything())
  expect(line()!.textContent).toBe('7 log abhi gali mein')
  await act(async () =>
    root.render(<Intro lang="en" onLang={() => {}} onEnter={() => {}} onPrivacy={() => {}} />),
  )
  expect(line()!.textContent).toBe('7 people in the lanes right now')
})

it('a rounded number (ten and up) reads as "n+"', async () => {
  answer = async () => Response.json({ people: 25 })
  await mount()
  expect(line()!.textContent).toBe('25+ log abhi gali mein')
})

it('0 (fewer than three, never told apart) says it is quiet: come in first', async () => {
  await mount()
  expect(line()!.textContent).toBe('Abhi shaant hai — pehle aao')
  await act(async () =>
    root.render(<Intro lang="en" onLang={() => {}} onEnter={() => {}} onPrivacy={() => {}} />),
  )
  expect(line()!.textContent).toBe("It's quiet right now — be the first in")
})

it('says nothing at all when the count cannot be had (offline, a 429, junk)', async () => {
  for (const bad of [
    async () => {
      throw new TypeError('offline')
    },
    async () => Response.json({ error: 'rate' }, { status: 429 }),
    async () => Response.json({ people: 'lots' }),
    async () => Response.json({ people: -1 }),
  ]) {
    answer = bad
    await mount()
    expect(line()!.textContent).toBe('')
    act(() => root.unmount())
    root = createRoot(host)
  }
})

it('is polite live text, and is asked again every 30 s while the page shows (not while hidden)', async () => {
  answer = async () => Response.json({ people: 3 })
  await mount()
  expect(line()!.getAttribute('aria-live')).toBe('polite')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  answer = async () => Response.json({ people: 4 })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(COUNT_POLL_MS)
  })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(line()!.textContent).toBe('4 log abhi gali mein')
  // a failed read keeps the last number rather than blanking it
  answer = async () => Response.json({}, { status: 503 })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(COUNT_POLL_MS)
  })
  expect(line()!.textContent).toBe('4 log abhi gali mein')
  const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(COUNT_POLL_MS)
  })
  expect(fetchMock).toHaveBeenCalledTimes(3)
  hidden.mockRestore()
  // gone with the screen: no more asking
  act(() => root.unmount())
  await vi.advanceTimersByTimeAsync(COUNT_POLL_MS * 3)
  expect(fetchMock).toHaveBeenCalledTimes(3)
  root = createRoot(host)
})
