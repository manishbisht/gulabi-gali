import { applyD1Migrations, env, evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BENCH_POSITIONS, TRANSCRIPT_MS } from '../src/district'
import type { Env } from '../src/env'
import { LIVE_CLOSE, type DistrictId, type MatchView } from '../src/protocol'
import { refreshUser } from '../src/refresh'
import { api, closeAll, devId, inbox, live, pair, resident, type LiveClient } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const stub = (id: DistrictId) => testEnv.DISTRICT.get(testEnv.DISTRICT.idFromName(id))

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

afterEach(() => closeAll())

const sql = (q: string, ...args: unknown[]) =>
  testEnv.DB.prepare(q)
    .bind(...args)
    .run()

/** A resident on the street at `x`, listed: everyone else in the district has their join. */
async function walker(name: string, district: DistrictId, x: number, token?: string): Promise<LiveClient> {
  const c = await live(district, { token: token ?? (await resident(name)) })
  c.send({ t: 'move', x, z: 0, ry: 0 })
  await c.sync()
  return c
}

const ids = (c: LiveClient, t: 'join' | 'leave', from = 0) =>
  t === 'join' ? c.all('join', from).map((m) => m.p.id) : c.all('leave', from).map((m) => m.id)
const movers = (c: LiveClient, from = 0) => c.all('moves', from).flatMap((m) => m.m.map(([id]) => id))

describe('refreshUser', () => {
  it('ban: closes their district and inbox sockets with 4004', async () => {
    const token = await resident('Ban Bobby')
    const watcher = await walker('Ban Watcher', 'mi-road', 3)
    const banned = await walker('Ban Bobby', 'mi-road', 2, token)
    const box = await inbox(token)
    await watcher.next('join', (m) => m.p.id === devId('Ban Bobby'))
    await sql('UPDATE users SET banned = 1 WHERE id = ?', devId('Ban Bobby'))
    await refreshUser(testEnv, devId('Ban Bobby'), 'ban')
    await watcher.next('leave', (m) => m.id === devId('Ban Bobby'))
    await expect.poll(() => banned.closes).toEqual([LIVE_CLOSE.banned])
    await expect.poll(() => box.closes).toEqual([LIVE_CLOSE.banned])
  })

  it('hide: off the map at once, a ghost on their own socket, 404 as a profile, out of match lists', async () => {
    const { a, b, aId, matchId } = await pair('Hide Hema', 'Hide Harsh')
    const watcher = await walker('Hide Watcher', 'walled-city', 3)
    const hidden = await walker('Hide Hema', 'walled-city', 2, a)
    await watcher.next('join', (m) => m.p.id === aId)
    const from = hidden.mark()
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', aId)
    await refreshUser(testEnv, aId, 'hide')
    await watcher.next('leave', (m) => m.id === aId)
    // Told they are a ghost now, with the street as a ghost sees it.
    expect(await hidden.next('welcome', undefined, from)).toMatchObject({ you: { id: aId, visible: false } })
    // Moving no longer lists them.
    const seen = watcher.mark()
    const ghostFrom = hidden.mark()
    hidden.send({ t: 'move', x: 2.5, z: 0, ry: 0 })
    hidden.send({ t: 'status', text: 'yahan hoon' })
    await hidden.sync()
    await watcher.sync()
    expect(ids(watcher, 'join', seen)).not.toContain(aId)
    expect(movers(watcher, seen)).not.toContain(aId)
    expect(hidden.all('error', ghostFrom)).toContainEqual({ t: 'error', code: 'ghost' })
    // A fresh socket (which takes over from the old one) is a ghost from the start.
    const again = await live('walled-city', { token: a })
    expect((await again.next('welcome')).you.visible).toBe(false)
    // Their profile is gone for everyone, and their match drops out of the other side's list.
    expect((await api(`/api/profiles/${encodeURIComponent(aId)}`, b)).status).toBe(404)
    const list = (await (await api('/api/matches', b)).json()) as MatchView[]
    expect(list.map((m) => m.id)).not.toContain(matchId)

    // Unhidden: their socket is a resident again, and the next move lists them.
    await sql('UPDATE users SET hidden = 0 WHERE id = ?', aId)
    const back = again.mark()
    await refreshUser(testEnv, aId, 'hide')
    expect(await again.next('welcome', undefined, back)).toMatchObject({ you: { visible: true } })
    again.send({ t: 'move', x: 2, z: 0, ry: 0 })
    await watcher.next('join', (m) => m.p.id === aId, seen)
  })

  it('mute: say and status are refused with muted until it ends', async () => {
    const district: DistrictId = 'university'
    const bench = BENCH_POSITIONS[district][1]!
    const token = await resident('Mute Mohan')
    const m = await live(district, { token })
    m.send({ t: 'move', x: bench.x + 1, z: bench.z, ry: 0 })
    m.send({ t: 'sit', bench: `${district}:1` })
    await m.next('seated', (s) => s.bench === `${district}:1`)
    await sql('UPDATE users SET muted_until = ? WHERE id = ?', Date.now() + 3_600_000, devId('Mute Mohan'))
    await refreshUser(testEnv, devId('Mute Mohan'), 'mute')
    const from = m.mark()
    m.send({ t: 'say', text: 'sun rahe ho?' })
    m.send({ t: 'status', text: 'chup' })
    await m.sync()
    expect(m.all('error', from)).toEqual([
      { t: 'error', code: 'muted' },
      { t: 'error', code: 'muted' },
    ])
    expect(m.all('bench', from)).toEqual([])
    // A mute that has run out is no mute: no refresh needed for that.
    await sql('UPDATE users SET muted_until = ? WHERE id = ?', Date.now() - 1, devId('Mute Mohan'))
    await refreshUser(testEnv, devId('Mute Mohan'), 'mute')
    // A second on, so the refused line's allowance has come back.
    const later = Date.now() + 2000
    await runInDurableObject(stub(district), (i) => {
      i.clock = () => later
    })
    try {
      m.send({ t: 'say', text: 'ab bol sakta hoon' })
      await m.next('bench', (l) => l.text === 'ab bol sakta hoon')
    } finally {
      await runInDurableObject(stub(district), (i) => {
        i.clock = Date.now
      })
    }
  })

  it('block: two people vanish from each other both ways, and come back when it is lifted', async () => {
    const district: DistrictId = 'malviya-nagar'
    const a = await walker('Blk Anu', district, 0)
    const b = await walker('Blk Bina', district, 2)
    const c = await walker('Blk Chetan', district, 4)
    await a.next('join', (m) => m.p.id === devId('Blk Bina'))
    expect((await b.next('welcome')).people.map((p) => p.id)).toContain(devId('Blk Anu'))
    await sql(
      'INSERT INTO blocks (a, b, created_at) VALUES (?, ?, ?)',
      devId('Blk Anu'),
      devId('Blk Bina'),
      1,
    )
    // Either side's refresh does it: here the blocked one's.
    await refreshUser(testEnv, devId('Blk Bina'), 'block')
    await a.next('leave', (m) => m.id === devId('Blk Bina'))
    await b.next('leave', (m) => m.id === devId('Blk Anu'))
    const [fa, fb, fc] = [a.mark(), b.mark(), c.mark()]
    a.send({ t: 'move', x: 0.5, z: 0, ry: 0 })
    a.send({ t: 'status', text: 'naya status' })
    b.send({ t: 'move', x: 2.5, z: 0, ry: 0 })
    await c.next('moves', (m) => m.m.some(([id]) => id === devId('Blk Anu')), fc)
    await c.next('moves', (m) => m.m.some(([id]) => id === devId('Blk Bina')), fc)
    await c.next('status', (m) => m.id === devId('Blk Anu'), fc)
    await a.sync()
    await b.sync()
    expect(movers(a, fa)).not.toContain(devId('Blk Bina'))
    expect(movers(b, fb)).not.toContain(devId('Blk Anu'))
    expect(b.all('status', fb)).toEqual([])
    // A new socket for B does not list A, and A is not told B came back.
    const b2 = await live(district, { token: await resident('Blk Bina') })
    expect((await b2.next('welcome')).people.map((p) => p.id)).not.toContain(devId('Blk Anu'))
    b2.send({ t: 'move', x: 2, z: 0, ry: 0 })
    await b2.sync()
    await c.next('join', (m) => m.p.id === devId('Blk Bina'), fc)
    await a.sync()
    expect(ids(a, 'join', fa)).not.toContain(devId('Blk Bina'))

    await sql('DELETE FROM blocks WHERE a = ? AND b = ?', devId('Blk Anu'), devId('Blk Bina'))
    await refreshUser(testEnv, devId('Blk Anu'), 'block')
    await a.next('join', (m) => m.p.id === devId('Blk Bina'), fa)
    await b2.next('join', (m) => m.p.id === devId('Blk Anu'))
  })

  it('blocked people stay apart after the object wakes: the sets reload on the first frame', async () => {
    const district: DistrictId = 'mi-road'
    const a = await walker('Wake Asha', district, 10)
    const b = await walker('Wake Bablu', district, 12)
    const c = await walker('Wake Chandu', district, 11)
    await sql(
      'INSERT INTO blocks (a, b, created_at) VALUES (?, ?, ?)',
      devId('Wake Asha'),
      devId('Wake Bablu'),
      1,
    )
    await refreshUser(testEnv, devId('Wake Asha'), 'block')
    await b.next('leave', (m) => m.id === devId('Wake Asha'))
    await evictDurableObject(stub(district))
    const [from, fc] = [b.mark(), c.mark()]
    a.send({ t: 'move', x: 10.5, z: 0, ry: 0 })
    b.send({ t: 'move', x: 12.5, z: 0, ry: 0 })
    // Both moves went out (C hears them), but not to each other.
    await c.next('moves', (m) => m.m.some(([id]) => id === devId('Wake Asha')), fc)
    await c.next('moves', (m) => m.m.some(([id]) => id === devId('Wake Bablu')), fc)
    await b.sync()
    await a.sync()
    expect(movers(b, from)).not.toContain(devId('Wake Asha'))
    expect(movers(a, from)).not.toContain(devId('Wake Bablu'))
  })

  it('a person with 500 blocks still connects, and their blocks still hold', async () => {
    const district: DistrictId = 'walled-city'
    const other = await walker('Many Other', district, 30)
    const neutral = await walker('Many Neutral', district, 32)
    const me = devId('Many Blocker')
    const token = await resident('Many Blocker')
    const rows = Array.from({ length: 499 }, (_, i) => `dev:someone-${i}`).concat(devId('Many Other'))
    for (let i = 0; i < rows.length; i += 50)
      await testEnv.DB.batch(
        rows
          .slice(i, i + 50)
          .map((b) =>
            testEnv.DB.prepare('INSERT INTO blocks (a, b, created_at) VALUES (?, ?, ?)').bind(me, b, 1),
          ),
      )
    const c = await live(district, { token })
    const welcome = await c.next('welcome')
    expect(welcome.you).toEqual({ id: me, visible: true })
    expect(welcome.people.map((p) => p.id)).not.toContain(devId('Many Other'))
    const from = other.mark()
    c.send({ t: 'move', x: 31, z: 0, ry: 0 })
    await neutral.next('join', (m) => m.p.id === me)
    await other.sync()
    expect(ids(other, 'join', from)).not.toContain(me)
  })

  it('profile: the person is sent again as a join, with the new face', async () => {
    const watcher = await walker('Face Watcher', 'university', 40)
    const token = await resident('Face Farah')
    await walker('Face Farah', 'university', 41, token)
    await watcher.next('join', (m) => m.p.id === devId('Face Farah'))
    const from = watcher.mark()
    await sql("UPDATE profiles SET status = 'naya chehra' WHERE user_id = ?", devId('Face Farah'))
    await refreshUser(testEnv, devId('Face Farah'), 'profile')
    const join = await watcher.next('join', (m) => m.p.id === devId('Face Farah'), from)
    expect(join.p.status).toBe('naya chehra')
  })
})

describe('bench memory', () => {
  const district: DistrictId = 'walled-city'
  const at = BENCH_POSITIONS[district][4]!

  it('a talking bench keeps the object awake for at most 10 minutes after its last line', async () => {
    const district4 = stub(district)
    const c = await live(district, { token: await resident('Awake Anjali') })
    c.send({ t: 'move', x: at.x + 1, z: at.z, ry: 0 })
    c.send({ t: 'sit', bench: `${district}:4` })
    await c.next('seated', (m) => m.bench === `${district}:4`)
    type Awake = { awake: unknown; stayAwake(): void; clock: () => number }
    const start = Date.now()
    try {
      c.send({ t: 'say', text: 'koi hai?' })
      await c.next('bench')
      expect(await runInDurableObject(district4, (i) => (i as unknown as Awake).awake !== null)).toBe(true)
      // Nine minutes on, the line is still there: the timer renews itself.
      const renewed = await runInDurableObject(district4, (i) => {
        const o = i as unknown as Awake
        o.clock = () => start + TRANSCRIPT_MS - 60_000
        o.stayAwake()
        return o.awake !== null
      })
      expect(renewed).toBe(true)
      // Past ten minutes the transcript is empty and the timer lets go, so the object may hibernate.
      const after = await runInDurableObject(district4, (i) => {
        const o = i as unknown as Awake
        o.clock = () => start + TRANSCRIPT_MS + 60_000
        o.stayAwake()
        return { awake: o.awake !== null, lines: i.benchTranscript(`${district}:4`) }
      })
      expect(after).toEqual({ awake: false, lines: [] })
    } finally {
      await runInDurableObject(district4, (i) => {
        i.clock = Date.now
      })
    }
  })

  it('remembers who sat at a bench for 10 minutes, so a silent sitter can still report', async () => {
    const district4 = stub(district)
    const token = await resident('Silent Sita')
    const c = await live(district, { token })
    c.send({ t: 'move', x: at.x + 1, z: at.z, ry: 0 })
    c.send({ t: 'sit', bench: `${district}:4` })
    await c.next('seated', (m) => m.bench === `${district}:4`)
    const me = devId('Silent Sita')
    expect(await runInDurableObject(district4, (i) => i.satRecently(`${district}:4`, me))).toBe(true)
    c.send({ t: 'sit', bench: null })
    await c.next('seated', (m) => m.bench === null)
    const start = Date.now()
    try {
      const check = (ms: number) =>
        runInDurableObject(district4, (i) => {
          i.clock = () => start + ms
          return i.satRecently(`${district}:4`, me)
        })
      expect(await check(TRANSCRIPT_MS - 60_000)).toBe(true)
      expect(await check(TRANSCRIPT_MS + 60_000)).toBe(false)
      expect(await runInDurableObject(district4, (i) => i.satRecently(`${district}:3`, me))).toBe(false)
    } finally {
      await runInDurableObject(district4, (i) => {
        i.clock = Date.now
      })
    }
  })
})
