import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import type { Me, TodayRecord } from '../src/protocol'
import { istDay } from '../src/festivals'
import { TODAY_LIMIT } from '../src/limits'
import { putToday } from '../src/today'
import { api, devId, login, resident, settle } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const db = testEnv.DB

beforeAll(async () => {
  await applyD1Migrations(db, testEnv.TEST_MIGRATIONS)
})
afterEach(() => settle())

const put = (token: string, body: unknown) =>
  api('/api/me/today', token, { method: 'PUT', body: JSON.stringify(body) })
const today = () => istDay(new Date())
/** Noon IST on `day` (YYYY-MM-DD), in ms. */
const noon = (day: string) => Date.parse(`${day}T12:00:00+05:30`)
const mark = async (id: string, day: string, at = noon(day)) =>
  (await (await putToday(testEnv, id, { day }, at)).json()) as TodayRecord & { error?: string }

describe('Aaj ka Darshan on the server', () => {
  it("marks today's IST day done for a resident, and /api/me carries the record", async () => {
    const t = await resident('Today Tara')
    const before = (await (await api('/api/me', t)).json()) as Me
    expect(before.today).toBeUndefined()
    const res = await put(t, { day: today() })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ last: today(), streak: 1, best: 1 })
    // a second time the same day changes nothing
    expect(await (await put(t, { day: today() })).json()).toEqual({ last: today(), streak: 1, best: 1 })
    const me = (await (await api('/api/me', t)).json()) as Me
    expect(me.today).toEqual({ last: today(), streak: 1, best: 1 })
  })

  it('refuses any day but today in IST, numbers, and garbage', async () => {
    const t = await resident('Today Tarun')
    const y = istDay(new Date(Date.now() - 24 * 3600_000))
    const tomorrow = istDay(new Date(Date.now() + 24 * 3600_000))
    for (const body of [
      { day: y },
      { day: tomorrow },
      { day: '2026-13-45' },
      { day: today(), streak: 99 }, // extra fields are not a way to set the streak
      { day: 20261124 },
      {},
      null,
    ]) {
      const res = await put(t, body)
      if ('streak' in (body ?? {})) {
        // the field is ignored, never trusted
        expect(await res.json()).toEqual({ last: today(), streak: 1, best: 1 })
        continue
      }
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid' })
    }
  })

  it('counts a run of consecutive IST days; a missed day starts again at 1 and keeps the best', async () => {
    await resident('Today Streak')
    const id = devId('Today Streak')
    expect(await mark(id, '2026-11-20')).toEqual({ last: '2026-11-20', streak: 1, best: 1 })
    expect(await mark(id, '2026-11-21')).toEqual({ last: '2026-11-21', streak: 2, best: 2 })
    // the same day again, late at night IST (still the 21st there, already the 21st UTC too)
    expect(await mark(id, '2026-11-21', Date.parse('2026-11-21T23:59:00+05:30'))).toEqual({
      last: '2026-11-21',
      streak: 2,
      best: 2,
    })
    // just after midnight IST is the next day, though it is still the 21st in UTC
    expect(await mark(id, '2026-11-22', Date.parse('2026-11-22T00:10:00+05:30'))).toEqual({
      last: '2026-11-22',
      streak: 3,
      best: 3,
    })
    // the 23rd missed
    expect(await mark(id, '2026-11-24')).toEqual({ last: '2026-11-24', streak: 1, best: 3 })
    // a month boundary is still consecutive
    await mark(id, '2026-11-30')
    expect(await mark(id, '2026-12-01')).toEqual({ last: '2026-12-01', streak: 2, best: 3 })
  })

  it('a day that is not "now" in IST is refused even through the function', async () => {
    await resident('Today Clock')
    const res = await putToday(testEnv, devId('Today Clock'), { day: '2026-11-20' }, noon('2026-11-21'))
    expect(res.status).toBe(400)
  })

  it('is for residents only: a ghost is 403 ghost, a banned one 403 banned, and nothing is stored', async () => {
    const half = await login('Today Half')
    let res = await put(half, { day: today() })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'ghost' })
    const banned = await resident('Today Banned')
    await db.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(devId('Today Banned')).run()
    res = await put(banned, { day: today() })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'banned' })
    const stored = await db
      .prepare('SELECT COUNT(*) AS n FROM user_today WHERE user_id IN (?, ?)')
      .bind(devId('Today Half'), devId('Today Banned'))
      .first<{ n: number }>()
    expect(stored?.n).toBe(0)
  })

  it(`allows ${TODAY_LIMIT.perWindow} marks an hour, then 429 rate`, async () => {
    const t = await resident('Today Spammer')
    for (let i = 0; i < TODAY_LIMIT.perWindow; i++) expect((await put(t, { day: today() })).status).toBe(200)
    const res = await put(t, { day: today() })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate' })
  })

  it('deleting the account deletes the record', async () => {
    const t = await resident('Today Leaver')
    await put(t, { day: today() })
    expect((await api('/api/me', t, { method: 'DELETE' })).status).toBeLessThan(300)
    const left = await db
      .prepare('SELECT COUNT(*) AS n FROM user_today WHERE user_id = ?')
      .bind(devId('Today Leaver'))
      .first<{ n: number }>()
    expect(left?.n).toBe(0)
  })
})
