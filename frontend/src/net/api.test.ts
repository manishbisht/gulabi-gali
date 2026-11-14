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

it('strips trailing slashes from the API base', async () => {
  vi.stubEnv('VITE_API_URL', 'https://api.example.com//')
  vi.resetModules()
  const { fetchCity: fresh } = await import('./api')
  const fetchMock = vi.fn(() => Promise.reject(new TypeError('offline')))
  vi.stubGlobal('fetch', fetchMock)
  await fresh()
  expect(fetchMock.mock.calls[0]).toEqual(['https://api.example.com/api/city', { signal: undefined }])
  vi.unstubAllEnvs()
})
