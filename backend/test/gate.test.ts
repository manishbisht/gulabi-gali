import {
  applyD1Migrations,
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/env'
import { GATE_NAME, HOLD_MS, joinWaitlist, QUEUE_DROP_MS, STALE_MS, type GateDO } from '../src/gate'
import worker from '../src/index'
import type { AdminStats, DistrictId } from '../src/protocol'
import { refreshUser } from '../src/refresh'
import { api, devId, live, login, resident, settle, WAIT, type LiveClient } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const API = 'https://api.test'
const gate = () => testEnv.GATE.get(testEnv.GATE.idFromName(GATE_NAME))
const district = (id: DistrictId) => testEnv.DISTRICT.get(testEnv.DISTRICT.idFromName(id))

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

afterEach(async () => {
  // Every release lands before the gate is emptied for the next test.
  await settle()
  await gate().configure({ maxLive: null, clear: true })
})

/** A clean gate that admits at most `n` residents. */
const cap = (n: number) => gate().configure({ maxLive: n, clear: true })

/** A resident who has stepped into `where` (so others hear them arrive), as `token` or as a new person. */
async function walker(name: string, where: DistrictId, token?: string): Promise<LiveClient> {
  const c = await live(where, { token: token ?? (await resident(name)) })
  c.send({ t: 'move', x: 1, z: 1, ry: 0 })
  await c.sync()
  return c
}

/** The gate's rows for `userId`: the districts holding a slot for them ('' is the hold after the last left). */
const slotsOf = (userId: string) =>
  runInDurableObject(gate(), (_instance, state) =>
    state.storage.sql
      .exec<{ district: string }>('SELECT district FROM slots WHERE user_id = ? ORDER BY district', userId)
      .toArray()
      .map((r) => r.district),
  )

/** Whether `userId` waits in line with a live socket (false: in line but away, null: not in line). */
const inLine = (userId: string) =>
  runInDurableObject(gate(), (_instance, state) => {
    const row = state.storage.sql
      .exec<{ district: string | null }>('SELECT district FROM queue WHERE user_id = ?', userId)
      .toArray()[0]
    return row ? row.district !== null : null
  })

/**
 * Runs the gate's alarm as if `ms` had passed, then puts its clock back. The `beating` districts' alarms run
 * first, at that time: their heartbeats vouch for whoever they hold.
 */
async function after(ms: number, ...beating: DistrictId[]) {
  await runInDurableObject(gate(), (instance: GateDO) => {
    instance.clock = () => Date.now() + ms
  })
  try {
    for (const id of beating) expect(await runDurableObjectAlarm(district(id))).toBe(true)
    await runInDurableObject(gate(), (instance: GateDO) => instance.alarm())
  } finally {
    await runInDurableObject(gate(), (instance: GateDO) => {
      instance.clock = Date.now
    })
  }
}

const joined = (c: LiveClient, from = 0) => c.all('join', from).map((m) => m.p.id)

describe('the gate', () => {
  it('admits up to MAX_LIVE then queues', async () => {
    expect(testEnv.MAX_LIVE).toBe('300')
    await cap(2)
    const watcher = await live('walled-city')
    await walker('Gate Asha', 'walled-city')
    await walker('Gate Bina', 'walled-city')
    const c = await live('walled-city', { token: await resident('Gate Chetan') })
    // Still in, as a ghost: exploring, unseen, told where they stand.
    expect((await c.next('welcome')).you).toEqual({ id: devId('Gate Chetan'), visible: false, queued: 1 })
    const from = c.mark()
    c.send({ t: 'move', x: 2, z: 2, ry: 0 })
    c.send({ t: 'say', text: 'koi hai?' })
    await c.sync()
    await watcher.sync()
    expect(joined(watcher)).toEqual([devId('Gate Asha'), devId('Gate Bina')])
    expect(c.all('error', from)).toContainEqual({ t: 'error', code: 'ghost' })
    const d = await live('walled-city', { token: await resident('Gate Diya') })
    expect((await d.next('welcome')).you).toMatchObject({ visible: false, queued: 2 })
    expect(await gate().count()).toBe(2)
    expect(await gate().stats()).toEqual({ live: 2, queue: 2 })
    // A ghost is never counted or queued.
    await (await live('walled-city')).sync()
    expect(await gate().stats()).toEqual({ live: 2, queue: 2 })
  })

  it('a release lets the first in line through, and the line moves up', async () => {
    await cap(1)
    const watcher = await live('mi-road')
    watcher.send({ t: 'move', x: 0, z: 0, ry: 0 })
    const a = await walker('Line Arjun', 'mi-road')
    const b = await walker('Line Bela', 'mi-road')
    const c = await walker('Line Chand', 'mi-road')
    expect((await b.next('welcome')).you.queued).toBe(1)
    expect((await c.next('welcome')).you.queued).toBe(2)
    const seen = watcher.mark()
    const bFrom = b.mark()
    a.close()
    await watcher.next('leave', (m) => m.id === devId('Line Arjun'), seen)
    await vi.waitFor(async () => expect(await slotsOf(devId('Line Arjun'))).toEqual(['']), WAIT)
    // Held a moment for a reload or a district move: nobody is let in yet.
    await after(HOLD_MS - 1000)
    await b.sync()
    expect(b.all('welcome', bFrom)).toEqual([])
    // Then the slot is free: Bela's open socket is a resident, and the street sees her where she stands.
    await after(HOLD_MS + 1)
    expect((await b.next('welcome', undefined, bFrom)).you).toEqual({ id: devId('Line Bela'), visible: true })
    expect((await watcher.next('join', (m) => m.p.id === devId('Line Bela'), seen)).p).toMatchObject({
      x: 1,
      z: 1,
    })
    expect(await c.next('queued')).toEqual({ t: 'queued', position: 1 })
    expect(await gate().stats()).toEqual({ live: 1, queue: 1 })
    // She can do what residents do.
    const said = b.mark()
    b.send({ t: 'status', text: 'aa gayi' })
    await b.sync()
    expect(b.all('error', said)).toEqual([])
  })

  it('reload keeps the position', async () => {
    await cap(1)
    await walker('Reload Ravi', 'university')
    const token = await resident('Reload Rekha')
    const first = await walker('', 'university', token)
    const c = await walker('Reload Charu', 'university')
    expect((await first.next('welcome')).you.queued).toBe(1)
    expect((await c.next('welcome')).you.queued).toBe(2)
    first.close()
    await vi.waitFor(async () => expect(await inLine(devId('Reload Rekha'))).toBe(false), WAIT)
    // Gone a while, but under ten minutes: the place is kept.
    await after(QUEUE_DROP_MS - 60_000, 'university')
    const again = await live('university', { token })
    expect((await again.next('welcome')).you).toMatchObject({ visible: false, queued: 1 })
    expect(c.all('queued')).toEqual([])
    expect(await inLine(devId('Reload Rekha'))).toBe(true)
  })

  it('someone in line with no socket for ten minutes is dropped, and those behind move up', async () => {
    await cap(1)
    await walker('Drop Dev', 'malviya-nagar')
    const gone = await walker('Drop Gita', 'malviya-nagar')
    const c = await walker('Drop Hari', 'malviya-nagar')
    expect((await c.next('welcome')).you.queued).toBe(2)
    gone.close()
    await vi.waitFor(async () => expect(await inLine(devId('Drop Gita'))).toBe(false), WAIT)
    // Hari's district keeps vouching for him; Gita has no socket anywhere.
    await after(QUEUE_DROP_MS + 1000, 'malviya-nagar')
    expect(await inLine(devId('Drop Gita'))).toBeNull()
    expect(await c.next('queued')).toEqual({ t: 'queued', position: 1 })
  })

  it('recent invite skips, up to MAX_LIVE + 10%', async () => {
    await cap(10)
    for (let i = 0; i < 10; i++) expect(await gate().admit(`fake:${i}`, 'walled-city')).toEqual({ ok: true })
    const redeemed = async (name: string, ago: number) => {
      const token = await resident(name, {}, { verified: false })
      await testEnv.DB.prepare(
        'INSERT INTO invites (code, owner, used_by, used_at, created_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(
          `C${name.replace(/\W/g, '').slice(0, 7).toUpperCase()}`,
          'dev:inviter',
          devId(name),
          Date.now() - ago,
          0,
        )
        .run()
      return token
    }
    const sita = await live('walled-city', { token: await redeemed('Skip Sita', 3600_000) })
    expect((await sita.next('welcome')).you).toEqual({ id: devId('Skip Sita'), visible: true })
    expect(await gate().count()).toBe(11)
    // Past the ceiling (10 + 10%), even an invite waits.
    const tara = await live('walled-city', { token: await redeemed('Skip Tara', 60_000) })
    expect((await tara.next('welcome')).you).toMatchObject({ visible: false, queued: 1 })
    // An invite redeemed more than 24 hours ago does not skip.
    await gate().release('fake:0', 'walled-city')
    await after(HOLD_MS + 1)
    expect(await gate().count()).toBe(10)
    const old = await live('walled-city', { token: await redeemed('Skip Purana', 25 * 3600_000) })
    expect((await old.next('welcome')).you).toMatchObject({ visible: false, queued: 2 })
  })

  it('the stale sweep frees slots no district has confirmed in two minutes', async () => {
    await cap(5)
    expect(await gate().admit('fake:crashed', 'university')).toEqual({ ok: true })
    await walker('Stale Sunil', 'university')
    expect(await gate().count()).toBe(2)
    // Two minutes on: the university's alarm vouches for Sunil; nobody has vouched for the other since.
    await after(STALE_MS + 1000, 'university')
    expect(await gate().count()).toBe(1)
    expect(await slotsOf(devId('Stale Sunil'))).toEqual(['university'])
    expect(await slotsOf('fake:crashed')).toEqual([])
  })

  it('a district move does not double-count, or lose the slot', async () => {
    await cap(1)
    const token = await resident('Move Mohan')
    const a1 = await walker('', 'walled-city', token)
    const b = await walker('Move Bela', 'mi-road')
    expect((await b.next('welcome')).you.queued).toBe(1)
    // The next district opens before the last one has closed.
    const a2 = await live('university', { token })
    expect((await a2.next('welcome')).you).toEqual({ id: devId('Move Mohan'), visible: true })
    expect(await gate().count()).toBe(1)
    a1.close()
    await vi.waitFor(async () => expect(await slotsOf(devId('Move Mohan'))).toEqual(['university']), WAIT)
    // Or the last one closes first, and the next opens within the hold.
    a2.close()
    await vi.waitFor(async () => expect(await slotsOf(devId('Move Mohan'))).toEqual(['']), WAIT)
    const a3 = await live('malviya-nagar', { token })
    expect((await a3.next('welcome')).you).toEqual({ id: devId('Move Mohan'), visible: true })
    expect(await slotsOf(devId('Move Mohan'))).toEqual(['malviya-nagar'])
    await after(HOLD_MS + 1)
    expect(await gate().stats()).toEqual({ live: 1, queue: 1 })
    expect(b.all('welcome')).toHaveLength(1)
  })

  it('one person waiting in two districts gets in at both, on one slot', async () => {
    await cap(1)
    const a = await walker('Two Tabs Anu', 'university')
    const token = await resident('Two Tabs Bina')
    const first = await walker('', 'mi-road', token)
    const second = await walker('', 'walled-city', token)
    expect((await first.next('welcome')).you.queued).toBe(1)
    expect((await second.next('welcome')).you.queued).toBe(1)
    const [f, s] = [first.mark(), second.mark()]
    a.close()
    await vi.waitFor(async () => expect(await slotsOf(devId('Two Tabs Anu'))).toEqual(['']), WAIT)
    await after(HOLD_MS + 1)
    // The gate lets them in where they last asked from; the other district hears it on its next heartbeat.
    expect((await second.next('welcome', undefined, s)).you.visible).toBe(true)
    expect(first.all('welcome', f)).toEqual([])
    expect(await runDurableObjectAlarm(district('mi-road'))).toBe(true)
    expect((await first.next('welcome', undefined, f)).you.visible).toBe(true)
    expect(await gate().stats()).toEqual({ live: 1, queue: 0 })
    expect(await slotsOf(devId('Two Tabs Bina'))).toEqual(['mi-road', 'walled-city'])
  })

  it('slots, the line and a waiting socket survive both objects hibernating', async () => {
    await cap(1)
    const watcher = await live('malviya-nagar')
    const a = await walker('Sleep Anil', 'malviya-nagar')
    const b = await walker('Sleep Bindu', 'malviya-nagar')
    expect((await b.next('welcome')).you.queued).toBe(1)
    await evictDurableObject(gate())
    await evictDurableObject(district('malviya-nagar'))
    expect(await gate().stats()).toEqual({ live: 1, queue: 1 })
    const seen = watcher.mark()
    const bFrom = b.mark()
    a.close()
    await vi.waitFor(async () => expect(await slotsOf(devId('Sleep Anil'))).toEqual(['']), WAIT)
    await after(HOLD_MS + 1)
    expect((await b.next('welcome', undefined, bFrom)).you.visible).toBe(true)
    await watcher.next('join', (m) => m.p.id === devId('Sleep Bindu'), seen)
  })

  it('becoming visible again (an unhide) waits in line like anyone else', async () => {
    await cap(1)
    await walker('Unhide Uma', 'walled-city')
    const token = await resident('Unhide Hina')
    await testEnv.DB.prepare('UPDATE users SET hidden = 1 WHERE id = ?').bind(devId('Unhide Hina')).run()
    const h = await walker('', 'walled-city', token)
    expect((await h.next('welcome')).you).toEqual({ id: devId('Unhide Hina'), visible: false })
    expect(await gate().stats()).toEqual({ live: 1, queue: 0 })
    await testEnv.DB.prepare('UPDATE users SET hidden = 0 WHERE id = ?').bind(devId('Unhide Hina')).run()
    const from = h.mark()
    await refreshUser(testEnv, devId('Unhide Hina'), 'hide')
    expect((await h.next('welcome', undefined, from)).you).toEqual({
      id: devId('Unhide Hina'),
      visible: false,
      queued: 1,
    })
    // Hidden again while waiting: out of the line at once, and told so.
    await testEnv.DB.prepare('UPDATE users SET hidden = 1 WHERE id = ?').bind(devId('Unhide Hina')).run()
    const again = h.mark()
    await refreshUser(testEnv, devId('Unhide Hina'), 'hide')
    expect((await h.next('welcome', undefined, again)).you).toEqual({
      id: devId('Unhide Hina'),
      visible: false,
    })
    await vi.waitFor(async () => expect(await inLine(devId('Unhide Hina'))).toBeNull(), WAIT)
  })

  it('admin stats show who is live and how many wait', async () => {
    await cap(1)
    await walker('Stats Sonal', 'mi-road')
    await walker('Stats Tanu', 'mi-road')
    const res = await api('/api/admin/stats', await login('Owner'))
    const stats = (await res.json()) as AdminStats
    expect(stats.live).toBe(1)
    expect(stats.queue).toBe(1)
  })
})

describe('a ban or a hide frees the slot and leaves the line at once', () => {
  const sql = (q: string, id: string) => testEnv.DB.prepare(q).bind(id).run()

  for (const [why, set] of [
    ['ban', 'UPDATE users SET banned = 1 WHERE id = ?'],
    ['hide', 'UPDATE users SET hidden = 1 WHERE id = ?'],
  ] as const) {
    it(`${why}: the resident's slot is free with no hold, and the first in line gets in`, async () => {
      await cap(1)
      const name = `Out ${why} Omkar`
      const a = await walker(name, 'walled-city')
      const b = await walker(`Out ${why} Bela`, 'walled-city')
      const c = await walker(`Out ${why} Chand`, 'walled-city')
      expect((await b.next('welcome')).you.queued).toBe(1)
      expect((await c.next('welcome')).you.queued).toBe(2)
      const bFrom = b.mark()
      await sql(set, devId(name))
      await refreshUser(testEnv, devId(name), why)
      if (why === 'ban') await vi.waitFor(() => expect(a.closes).toEqual([4004]), WAIT)
      else expect((await a.next('welcome', (m) => !m.you.visible)).you.visible).toBe(false)
      // No hold: the slot is gone at once, and the gate lets the next one in without waiting it out. (Its
      // alarm is set for now, so on a busy run it may already have let them in: no count of 0 is asserted.)
      await vi.waitFor(async () => expect(await slotsOf(devId(name))).toEqual([]), WAIT)
      expect(await gate().count()).toBeLessThanOrEqual(1)
      await after(1)
      expect((await b.next('welcome', undefined, bFrom)).you.visible).toBe(true)
      expect(await c.next('queued')).toEqual({ t: 'queued', position: 1 })
      expect(await gate().stats()).toEqual({ live: 1, queue: 1 })
    })
  }

  it('hiding or banning someone waiting takes them out of the line, and those behind move up', async () => {
    await cap(1)
    await walker('Line Out Anu', 'mi-road')
    const b = await walker('Line Out Bina', 'mi-road')
    const c = await walker('Line Out Chetan', 'mi-road')
    const d = await walker('Line Out Diya', 'mi-road')
    expect((await d.next('welcome')).you.queued).toBe(3)
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', devId('Line Out Bina'))
    await refreshUser(testEnv, devId('Line Out Bina'), 'hide')
    expect((await b.next('welcome', (m) => m.you.queued === undefined)).you).toEqual({
      id: devId('Line Out Bina'),
      visible: false,
    })
    // At once, not ten minutes on.
    await vi.waitFor(async () => expect(await inLine(devId('Line Out Bina'))).toBeNull(), WAIT)
    expect(await c.next('queued')).toEqual({ t: 'queued', position: 1 })
    expect(await d.next('queued')).toEqual({ t: 'queued', position: 2 })
    const dFrom = d.mark()
    await sql('UPDATE users SET banned = 1 WHERE id = ?', devId('Line Out Chetan'))
    await refreshUser(testEnv, devId('Line Out Chetan'), 'ban')
    await vi.waitFor(() => expect(c.closes).toEqual([4004]), WAIT)
    await vi.waitFor(async () => expect(await inLine(devId('Line Out Chetan'))).toBeNull(), WAIT)
    expect(await d.next('queued', undefined, dFrom)).toEqual({ t: 'queued', position: 1 })
    expect(await gate().stats()).toEqual({ live: 1, queue: 1 })
  })
})

describe('the dev routes outside dev', () => {
  for (const DEV_AUTH of [undefined, '0', 'true']) {
    it(`DEV_AUTH=${String(DEV_AUTH)}: /api/dev/* is a 404 and changes nothing`, async () => {
      await cap(1)
      await walker(`Dev Off ${String(DEV_AUTH)} Anu`, 'university')
      await walker(`Dev Off ${String(DEV_AUTH)} Bina`, 'university')
      const before = await gate().stats()
      expect(before).toEqual({ live: 1, queue: 1 })
      const off = { ...testEnv, DEV_AUTH } as unknown as Env
      const post = (path: string, body: unknown) =>
        worker.fetch(
          new Request(`${API}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
          off,
        )
      const id = `dev:off-${String(DEV_AUTH)}`
      for (const [path, body] of [
        ['/api/dev/gate', { maxLive: 50, clear: true }],
        ['/api/dev/login', { name: 'Off Login' }],
        ['/api/dev/verify', { userId: id }],
      ] as const) {
        const res = await post(path, body)
        expect(res.status, path).toBe(404)
        expect(await res.json()).toEqual({ error: 'not found' })
      }
      // The cap (1) and the line are as they were: a third resident still waits.
      expect(await gate().stats()).toEqual(before)
      const third = await live('university', { token: await resident(`Dev Off ${String(DEV_AUTH)} Chand`) })
      expect((await third.next('welcome')).you).toMatchObject({ visible: false, queued: 2 })
      // Nobody made or verified.
      expect(await testEnv.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(id).first()).toBeNull()
      expect(
        await testEnv.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind('dev:off-login').first(),
      ).toBeNull()
    })
  }
})

describe('POST /api/waitlist', () => {
  const join = (body: unknown, headers: Record<string, string> = {}) =>
    SELF.fetch(`${API}/api/waitlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })

  it('waitlist email validated and stored once', async () => {
    for (const email of [
      '',
      'nope',
      'a@b',
      'a b@c.in',
      '@x.in',
      'x@.in',
      `${'a'.repeat(250)}@x.in`,
      42,
      null,
    ])
      expect((await join({ email })).status, String(email)).toBe(400)
    expect((await join('meera@example.in')).status).toBe(400)
    const first = await join({ email: '  Meera.Jain+gg@Example.IN ' })
    const again = await join({ email: 'meera.jain+gg@example.in' })
    // Already listed or not, the answer is the same: it never says who is on the list.
    for (const res of [first, again]) {
      expect(res.status).toBe(204)
      expect(await res.text()).toBe('')
    }
    const rows = await testEnv.DB.prepare(
      "SELECT email, created_at FROM waitlist WHERE email LIKE 'meera%'",
    ).all<{
      email: string
      created_at: number
    }>()
    expect(rows.results.map((r) => r.email)).toEqual(['meera.jain+gg@example.in'])
    expect(rows.results[0]!.created_at).toBeGreaterThan(Date.now() - 60_000)
  })

  it('a database failure is 503 unavailable, not a 500', async () => {
    const down = {
      ...testEnv,
      DB: {
        prepare: () => ({
          bind: () => ({ run: () => Promise.reject(new Error('D1 is down')) }),
        }),
      },
    } as unknown as Env
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await joinWaitlist(down, new Request(`${API}/api/waitlist`), { email: 'down@example.in' })
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'unavailable' })
      expect(spy).toHaveBeenCalledWith('waitlist: insert failed', expect.any(Error))
    } finally {
      spy.mockRestore()
    }
  })

  it('no sign-in needed, and five an hour per address', async () => {
    const ip = { 'CF-Connecting-IP': '198.51.100.23' }
    for (let i = 0; i < 5; i++) expect((await join({ email: `wait${i}@example.in` }, ip)).status).toBe(204)
    const slow = await join({ email: 'wait5@example.in' }, ip)
    expect(slow.status).toBe(429)
    expect(slow.headers.get('Retry-After')).toMatch(/^\d+$/)
    // Another address is its own count.
    expect((await join({ email: 'wait6@example.in' }, { 'CF-Connecting-IP': '198.51.100.24' })).status).toBe(
      204,
    )
  })
})
