// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { fallbackSnapshot } from '../net/api'
import type { CitySnapshot } from '../net/protocol'
import { useLiveCity, type LiveCity } from './useLiveCity'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const liveSnap = (tempC: number): CitySnapshot => ({
  ...fallbackSnapshot(new Date()),
  stale: false,
  tempC,
})

/** Mounts the hook against a fetch that answers with each of `replies` in turn (then keeps the last). */
async function mount(replies: (CitySnapshot | 'fail')[]) {
  vi.useFakeTimers()
  let i = 0
  vi.stubGlobal('fetch', () => {
    const r = replies[Math.min(i++, replies.length - 1)]
    return r === 'fail' ? Promise.reject(new TypeError('offline')) : Promise.resolve(Response.json(r))
  })
  const out: { city: LiveCity | null } = { city: null }
  function Probe() {
    out.city = useLiveCity()
    return null
  }
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root.render(<Probe />))
  const refresh = () => act(() => vi.advanceTimersByTimeAsync(10 * 60 * 1000))
  return { out, refresh, unmount: () => act(async () => root.unmount()) }
}

it('keeps the last live snapshot when a refresh comes back stale', async () => {
  const { out, refresh, unmount } = await mount([liveSnap(31), 'fail'])
  expect(out.city!.snapshot).toMatchObject({ stale: false, tempC: 31 })
  await refresh()
  expect(out.city!.snapshot).toMatchObject({ stale: false, tempC: 31 })
  expect(out.city!.current()).toMatchObject({ stale: false, tempC: 31 })
  await unmount()
})

it('takes a live snapshot once it arrives after a stale first one', async () => {
  const { out, refresh, unmount } = await mount(['fail', liveSnap(28)])
  expect(out.city!.snapshot!.stale).toBe(true)
  await refresh()
  expect(out.city!.snapshot).toMatchObject({ stale: false, tempC: 28 })
  await unmount()
})

it('a live snapshot older than 3 h yields to a stale refresh', async () => {
  const old = { ...liveSnap(31), fetchedAt: new Date(Date.now() - 3 * 3600_000 - 60_000).toISOString() }
  const { out, refresh, unmount } = await mount([old, 'fail'])
  expect(out.city!.snapshot).toMatchObject({ stale: false, tempC: 31 })
  await refresh() // the refresh advances the fake clock 10 min too
  expect(out.city!.snapshot!.stale).toBe(true)
  await unmount()
})

it('a live snapshot just under 3 h old still wins over a stale refresh', async () => {
  const recent = { ...liveSnap(31), fetchedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }
  const { out, refresh, unmount } = await mount([recent, 'fail'])
  await refresh()
  expect(out.city!.snapshot).toMatchObject({ stale: false, tempC: 31 })
  await unmount()
})
