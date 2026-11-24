import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import type { FullProfile, Me } from '../src/protocol'
import STAMPS from '../src/stamps.json'
import { STAMP_LIMIT } from '../src/limits'
import { api, devId, login, resident, settle } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const db = testEnv.DB

beforeAll(async () => {
  await applyD1Migrations(db, testEnv.TEST_MIGRATIONS)
})
afterEach(() => settle())

const put = (token: string, body: unknown) =>
  api('/api/me/stamps', token, { method: 'PUT', body: JSON.stringify(body) })
const stampsOf = async (res: Response) => ((await res.json()) as { stamps: string[] }).stamps
const profileOf = async (viewer: string, id: string) => api(`/api/profiles/${encodeURIComponent(id)}`, viewer)

describe('Jaipur Darshan stamps on the server', () => {
  it('the mirrored list holds the eleven landmarks, each with a Hinglish and an English name', () => {
    expect(STAMPS.map((s) => s.id)).toEqual([
      'hawa-mahal',
      'jantar-mantar',
      'tripolia-gate',
      'badi-chaupar',
      'albert-hall',
      'ram-niwas-gate',
      'university-gate',
      'jkk',
      'wtp',
      'amer-fort',
      'nahargarh-fort',
    ])
    for (const s of STAMPS) expect(s.hi && s.en).toBeTruthy()
  })

  it('union-merges: a PUT adds, never removes, and answers the whole set in list order', async () => {
    const t = await resident('Stamp Sita')
    let res = await put(t, { stamps: ['jkk', 'hawa-mahal'] })
    expect(res.status).toBe(200)
    expect(await stampsOf(res)).toEqual(['hawa-mahal', 'jkk'])
    // a second device knows only one, and one the server has not seen
    res = await put(t, { stamps: ['wtp', 'jkk', 'jkk'] })
    expect(await stampsOf(res)).toEqual(['hawa-mahal', 'jkk', 'wtp'])
    // an empty push is a pull
    res = await put(t, { stamps: [] })
    expect(await stampsOf(res)).toEqual(['hawa-mahal', 'jkk', 'wtp'])
    const me = (await (await api('/api/me', t)).json()) as Me
    expect(me.profile?.stamps).toEqual(['hawa-mahal', 'jkk', 'wtp'])
  })

  it('refuses unknown ids, a non-list, more ids than there are stamps, and garbage', async () => {
    const t = await resident('Stamp Suresh')
    const bad: unknown[] = [
      { stamps: ['hawa-mahal', 'taj-mahal'] },
      { stamps: 'hawa-mahal' },
      { stamps: [1] },
      { stamps: [...STAMPS.map((s) => s.id), 'jkk'] },
      {},
      null,
    ]
    for (const body of bad) {
      const res = await put(t, body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid' })
    }
    expect(await stampsOf(await put(t, { stamps: [] }))).toEqual([])
  })

  it('is for residents only: a token without a finished profile is a ghost (403 ghost), a banned one 403 banned', async () => {
    const half = await login('Stamp Half')
    let res = await put(half, { stamps: ['jkk'] })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'ghost' })
    const banned = await resident('Stamp Banned')
    await db.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(devId('Stamp Banned')).run()
    res = await put(banned, { stamps: ['jkk'] })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'banned' }) // as every other write says it, not "ghost"
    const stored = await db
      .prepare('SELECT COUNT(*) AS n FROM user_stamps WHERE user_id IN (?, ?)')
      .bind(devId('Stamp Half'), devId('Stamp Banned'))
      .first<{ n: number }>()
    expect(stored?.n).toBe(0)
  })

  it(`allows ${STAMP_LIMIT.perWindow} pushes an hour, then 429 rate`, async () => {
    const t = await resident('Stamp Spammer')
    for (let i = 0; i < STAMP_LIMIT.perWindow; i++)
      expect((await put(t, { stamps: ['jkk'] })).status).toBe(200)
    const res = await put(t, { stamps: ['wtp'] })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate' })
    // the refused one stored nothing
    const { results } = await db
      .prepare('SELECT stamp FROM user_stamps WHERE user_id = ?')
      .bind(devId('Stamp Spammer'))
      .all<{ stamp: string }>()
    expect(results.map((r) => r.stamp)).toEqual(['jkk'])
  })

  it('a profile carries its stamps to a resident viewer, under the same rules as the rest of it', async () => {
    const viewer = await resident('Stamp Viewer')
    const t = await resident('Stamp Shown')
    const id = devId('Stamp Shown')
    let res = await profileOf(viewer, id)
    expect(((await res.json()) as FullProfile).stamps).toEqual([])
    await put(t, { stamps: ['albert-hall', 'hawa-mahal'] })
    res = await profileOf(viewer, id)
    expect(res.status).toBe(200)
    expect(((await res.json()) as FullProfile).stamps).toEqual(['hawa-mahal', 'albert-hall'])

    // hidden, banned or blocked either way: 404, as for any profile
    await db.prepare('UPDATE users SET hidden = 1 WHERE id = ?').bind(id).run()
    expect((await profileOf(viewer, id)).status).toBe(404)
    await db.prepare('UPDATE users SET hidden = 0, banned = 1 WHERE id = ?').bind(id).run()
    expect((await profileOf(viewer, id)).status).toBe(404)
    await db.prepare('UPDATE users SET banned = 0 WHERE id = ?').bind(id).run()
    expect((await profileOf(viewer, id)).status).toBe(200)
    await api('/api/blocks', t, { method: 'POST', body: JSON.stringify({ id: devId('Stamp Viewer') }) })
    const blocked = await profileOf(viewer, id)
    expect(blocked.status).toBe(404)
    expect(await blocked.text()).not.toContain('hawa-mahal')
  })

  it('a block the other way (the viewer blocked the stamp holder) hides the profile and its stamps too', async () => {
    const viewer = await resident('Stamp Blocker')
    const t = await resident('Stamp Blocked Holder')
    await put(t, { stamps: ['hawa-mahal'] })
    const id = devId('Stamp Blocked Holder')
    expect((await profileOf(viewer, id)).status).toBe(200)
    await api('/api/blocks', viewer, { method: 'POST', body: JSON.stringify({ id }) })
    const res = await profileOf(viewer, id)
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('hawa-mahal')
  })

  it('a ghost viewer gets no profile, stamps or not', async () => {
    const t = await resident('Stamp Seen By Ghost')
    await put(t, { stamps: ['jkk'] })
    const ghost = await login('Stamp Ghost Viewer')
    expect((await profileOf(ghost, devId('Stamp Seen By Ghost'))).status).toBe(403)
  })

  it('deleting the account deletes its stamps', async () => {
    const t = await resident('Stamp Leaver')
    await put(t, { stamps: ['jkk', 'wtp'] })
    expect((await api('/api/me', t, { method: 'DELETE' })).status).toBe(204)
    const left = await db
      .prepare('SELECT COUNT(*) AS n FROM user_stamps WHERE user_id = ?')
      .bind(devId('Stamp Leaver'))
      .first<{ n: number }>()
    expect(left?.n).toBe(0)
  })
})
