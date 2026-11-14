import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import worker from '../src/index'
import { toPublic } from '../src/profiles'
import type { FullProfile, Me } from '../src/protocol'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

const call = (path: string, init: RequestInit = {}, token?: string) =>
  worker.fetch(
    new Request(`https://x.test${path}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    }),
    testEnv,
  )

async function login(name: string): Promise<string> {
  const res = await call('/api/dev/login', { method: 'POST', body: JSON.stringify({ name }) })
  return ((await res.json()) as { token: string }).token
}

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: 'Asha  Sharma',
    look: { skin: 2, outfit: 'teal', head: 'safa' },
    status: 'chai aur kitaabein',
    homeArea: 'Raja Park',
    hereFor: 'friends',
    about: 'Painter, slow walker.',
    link: 'https://example.com/asha',
    adult: true,
    pledge: true,
    pauseRequests: false,
    ...over,
  })

describe('profiles API', () => {
  it('PUT then GET /api/me round-trips and marks complete', async () => {
    const token = await login('roundtrip')
    const before = (await (await call('/api/me', {}, token)).json()) as Me
    expect(before).toEqual({ id: 'dev:roundtrip', profile: null, complete: false })

    const put = await call('/api/me/profile', { method: 'PUT', body: body() }, token)
    expect(put.status).toBe(200)
    const me = (await (await call('/api/me', {}, token)).json()) as Me
    expect(me.complete).toBe(true)
    expect(me.profile).toEqual({
      id: 'dev:roundtrip',
      name: 'Asha Sharma',
      look: { skin: 2, outfit: 'teal', head: 'safa' },
      status: 'chai aur kitaabein',
      homeArea: 'Raja Park',
      hereFor: 'friends',
      about: 'Painter, slow walker.',
      pauseRequests: false,
    })
    expect(JSON.stringify(me)).not.toContain('example.com')
    const stored = await testEnv.DB.prepare('SELECT link FROM profiles WHERE user_id = ?')
      .bind('dev:roundtrip')
      .first<{ link: string }>()
    expect(stored?.link).toBe('https://example.com/asha')
  })

  it('incomplete without adult or pledge', async () => {
    const token = await login('shy')
    for (const over of [{ adult: false }, { pledge: false }]) {
      const res = await call('/api/me/profile', { method: 'PUT', body: body(over) }, token)
      expect(res.status).toBe(200)
      expect(((await res.json()) as Me).complete).toBe(false)
    }
  })

  it('rejects a javascript: link and a 300-char about with field names', async () => {
    const token = await login('badform')
    const res = await call(
      '/api/me/profile',
      {
        method: 'PUT',
        body: body({ link: 'javascript:alert(1)', about: 'a'.repeat(300), homeArea: 'Mars', name: 'x' }),
      },
      token,
    )
    expect(res.status).toBe(400)
    const { error, fields } = (await res.json()) as { error: string; fields: string[] }
    expect(error).toBe('invalid')
    expect(fields).toEqual(expect.arrayContaining(['link', 'about', 'homeArea', 'name']))
    for (const link of [
      'http://example.com',
      'https://u:p@example.com',
      `https://example.com/${'a'.repeat(200)}`,
    ]) {
      const r = await call('/api/me/profile', { method: 'PUT', body: body({ link }) }, token)
      expect(r.status).toBe(400)
    }
  })

  it('accepts an about of exactly 200 characters and rejects 201', async () => {
    const token = await login('aboutedge')
    const ok = await call('/api/me/profile', { method: 'PUT', body: body({ about: 'a'.repeat(200) }) }, token)
    expect(ok.status).toBe(200)
    const bad = await call(
      '/api/me/profile',
      { method: 'PUT', body: body({ about: 'a'.repeat(201) }) },
      token,
    )
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { fields: string[] }).fields).toContain('about')
  })

  it('rejects an unknown outfit or head', async () => {
    const token = await login('badlook')
    const res = await call(
      '/api/me/profile',
      { method: 'PUT', body: body({ look: { skin: 9, outfit: 'neon', head: 'crown' } }) },
      token,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { fields: string[] }).fields).toContain('look')
  })

  it('GET /api/profiles/:id is 401 without a token', async () => {
    const res = await call('/api/profiles/dev:roundtrip')
    expect(res.status).toBe(401)
  })

  it('GET /api/profiles/:id is for residents only: anyone else is 403 ghost', async () => {
    const viewer = await login('halfviewer')
    const seen = await login('seenbyhalf')
    await call('/api/me/profile', { method: 'PUT', body: body() }, seen)
    const ghost = async () => {
      const res = await call('/api/profiles/dev:seenbyhalf', {}, viewer)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'ghost' })
    }
    // Signed in with no profile, then an incomplete one.
    await ghost()
    await call('/api/me/profile', { method: 'PUT', body: body({ pledge: false }) }, viewer)
    await ghost()
    // Complete: a resident, who may look.
    await call('/api/me/profile', { method: 'PUT', body: body() }, viewer)
    expect((await call('/api/profiles/dev:seenbyhalf', {}, viewer)).status).toBe(200)
    // Banned: a ghost again.
    await testEnv.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind('dev:halfviewer').run()
    await ghost()
  })

  it('GET /api/profiles/:id shows a complete profile, hides incomplete and banned ones', async () => {
    const a = await login('viewer')
    await call('/api/me/profile', { method: 'PUT', body: body() }, a)
    const b = await login('seen')
    await call('/api/me/profile', { method: 'PUT', body: body() }, b)
    const ok = await call(`/api/profiles/${encodeURIComponent('dev:seen')}`, {}, a)
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as FullProfile).homeArea).toBe('Raja Park')
    expect((await call('/api/profiles/dev:nobody', {}, a)).status).toBe(404)
    await call('/api/me/profile', { method: 'PUT', body: body({ pledge: false }) }, b)
    expect((await call('/api/profiles/dev:seen', {}, a)).status).toBe(404)
    await call('/api/me/profile', { method: 'PUT', body: body() }, b)
    await testEnv.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind('dev:seen').run()
    expect((await call('/api/profiles/dev:seen', {}, a)).status).toBe(404)
  })

  it('a ghost-safe PublicPerson never includes homeArea/about/link', () => {
    const row = {
      id: 'dev:x',
      name: 'X Y',
      look: { skin: 1, outfit: 'pink', head: 'none' },
      status: 'hi',
      homeArea: 'Amer',
      hereFor: 'art',
      about: 'secret',
      link: 'https://example.com',
      adult: true,
      pledge: true,
      pauseRequests: true,
    }
    const pub = toPublic(row as never)
    expect(pub).toEqual({
      id: 'dev:x',
      name: 'X',
      look: { skin: 1, outfit: 'pink', head: 'none' },
      status: 'hi',
    })
    for (const k of ['homeArea', 'hereFor', 'about', 'link', 'adult', 'pledge', 'pauseRequests'])
      expect(pub).not.toHaveProperty(k)
  })

  it('a ghost-safe PublicPerson carries the first name only, and twice is the same as once', () => {
    const named = (name: string) =>
      toPublic({ id: 'dev:n', name, look: { skin: 0, outfit: 'teal', head: 'cap' }, status: '' })
    expect(named('Asha Sharma').name).toBe('Asha')
    expect(named('Ramakrishnan Venkataraman').name).toBe('Ramakrishnan')
    // No space: the first 12 code points, never half a character.
    expect(named('Abcdefghijklmnopqrstu').name).toBe('Abcdefghijkl')
    expect(named('Abcdefghijk👩‍💻').name).toBe('Abcdefghijk')
    expect(named('Mo').name).toBe('Mo')
    expect(toPublic(named('Asha Sharma')).name).toBe('Asha')
  })

  it('a signed-in viewer still gets the full name from GET /api/profiles/:id', async () => {
    const token = await login('fullname')
    await call('/api/me/profile', { method: 'PUT', body: body({ name: 'Meera Bai Rathore' }) }, token)
    const res = await call('/api/profiles/dev:fullname', {}, token)
    expect(((await res.json()) as FullProfile).name).toBe('Meera Bai Rathore')
  })
})
