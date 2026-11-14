import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('answers /health', async () => {
  const res = await SELF.fetch('https://api.test/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

it('allows the production site and local dev origins only', async () => {
  for (const origin of ['https://jaipur.manishbisht.me', 'http://127.0.0.1:5173', 'http://localhost:5173']) {
    const res = await SELF.fetch('https://api.test/health', { headers: { Origin: origin } })
    expect(res.headers.get('access-control-allow-origin')).toBe(origin)
  }
  const evil = await SELF.fetch('https://api.test/health', { headers: { Origin: 'https://evil.example' } })
  expect(evil.headers.get('access-control-allow-origin')).toBeNull()
})

it('404s unknown paths as JSON', async () => {
  const res = await SELF.fetch('https://api.test/nope')
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ error: 'not found' })
})
