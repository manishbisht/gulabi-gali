import { afterEach, expect, it, vi } from 'vitest'
import { fetchCity } from './api'

afterEach(() => vi.unstubAllGlobals())

it('fetchCity falls back on network error', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const s = await fetchCity()
  expect(s.stale).toBe(true)
  expect(s.condition).toBe('clear')
})

it('fetchCity falls back on a non-OK response', async () => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('boom', { status: 500 })))
  expect((await fetchCity()).stale).toBe(true)
})

it('fetchCity falls back on an unparseable body', async () => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>', { status: 200 })))
  expect((await fetchCity()).stale).toBe(true)
})

it('fetchCity returns the live snapshot when the API answers', async () => {
  const live = { ...(await fetchCity()), stale: false, tempC: 31, condition: 'dust' }
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json(live)))
  expect(await fetchCity()).toEqual(live)
})
