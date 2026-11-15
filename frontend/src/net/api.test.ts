import { afterEach, expect, it, vi } from 'vitest'
import { blockPosterOwner, fetchCity, getPosters, putProfile, sendMessage } from './api'

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

const answer = (body: unknown, status: number) =>
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status }))

it('a profile the word filter refused names the field and says it was the words', async () => {
  answer({ error: 'words', field: 'about' }, 400)
  expect(await putProfile('tok', {} as never)).toEqual({ ok: false, fields: ['about'], words: true })
  answer({ error: 'invalid', fields: ['name'] }, 400)
  expect(await putProfile('tok', {} as never)).toEqual({ ok: false, fields: ['name'] })
})

it('a chat message the word filter refused is typed as words', async () => {
  answer({ error: 'words', field: 'body' }, 400)
  expect(await sendMessage('tok', 'm1', 'hi')).toEqual({ ok: false, error: 'words' })
})

it('blocking from a poster nobody remembers any more is gone, not something to try again', async () => {
  answer({ error: 'gone' }, 404)
  expect(await blockPosterOwner('tok', 'p1')).toBe('gone')
  vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }))
  expect(await blockPosterOwner('tok', 'p1')).toBe(true)
  answer({ error: 'rate' }, 429)
  expect(await blockPosterOwner('tok', 'p1')).toBe(false)
})

it('a walls fetch whose token is refused rejects (the walls keep what they show), never reads as empty', async () => {
  answer({ error: 'unauthorized' }, 401)
  await expect(getPosters('university', 'stale-token')).rejects.toThrow(/401/)
})
