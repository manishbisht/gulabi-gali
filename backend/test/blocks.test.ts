import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BLOCKS_PER_HOUR } from '../src/blocks'
import { BENCH_POSITIONS } from '../src/district'
import type { Env } from '../src/env'
import type { DistrictId, MatchView, RequestLists } from '../src/protocol'
import { accept } from '../src/requests'
import { api, closeAll, devId, inbox, live, login, pair, resident, type LiveClient } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})
afterEach(() => closeAll())

const block = (token: string, id: string) =>
  api('/api/blocks', token, { method: 'POST', body: JSON.stringify({ id }) })
/** Unblocks by the list's handle (or, to show it does nothing, by anything else). */
const unblock = (token: string, handle: string) =>
  api(`/api/blocks/${encodeURIComponent(handle)}`, token, { method: 'DELETE' })
/** The handle the block list gives `a`'s block of `b`, read straight from D1 (the list never says whose it is). */
const handleOf = async (a: string, b: string) =>
  (await testEnv.DB.prepare('SELECT handle FROM blocks WHERE a = ? AND b = ?')
    .bind(a, b)
    .first<{ handle: string }>())!.handle
type Listed = { handle: string; name: string | null }

async function walker(name: string, district: DistrictId, x: number): Promise<LiveClient> {
  const c = await live(district, { token: await resident(name) })
  c.send({ t: 'move', x, z: 0, ry: 0 })
  await c.sync()
  return c
}

describe('block', () => {
  it("blocked people vanish from each other's district view immediately", async () => {
    const district: DistrictId = 'mi-road'
    const a = await walker('Vanish Anu', district, 0)
    const b = await walker('Vanish Bina', district, 2)
    const c = await walker('Vanish Chetan', district, 4)
    await a.next('join', (m) => m.p.id === devId('Vanish Bina'))
    const tokenA = await resident('Vanish Anu') // same dev user: just a token
    expect((await block(tokenA, devId('Vanish Bina'))).status).toBe(204)
    await a.next('leave', (m) => m.id === devId('Vanish Bina'))
    await b.next('leave', (m) => m.id === devId('Vanish Anu'))
    const [fa, fb, fc] = [a.mark(), b.mark(), c.mark()]
    a.send({ t: 'move', x: 0.5, z: 0, ry: 0 })
    b.send({ t: 'move', x: 2.5, z: 0, ry: 0 })
    await c.next('moves', (m) => m.m.some(([id]) => id === devId('Vanish Anu')), fc)
    await a.sync()
    await b.sync()
    expect(a.all('moves', fa).flatMap((m) => m.m.map(([id]) => id))).not.toContain(devId('Vanish Bina'))
    expect(b.all('moves', fb).flatMap((m) => m.m.map(([id]) => id))).not.toContain(devId('Vanish Anu'))
  })

  it('shared bench: the blocked one is unseated, the blocker stays', async () => {
    const district: DistrictId = 'university'
    const at = BENCH_POSITIONS[district][2]!
    const tokenA = await resident('Bench Anu')
    const tokenB = await resident('Bench Bina')
    const a = await live(district, { token: tokenA })
    const b = await live(district, { token: tokenB })
    for (const c of [a, b]) {
      c.send({ t: 'move', x: at.x + 1, z: at.z, ry: 0 })
      c.send({ t: 'sit', bench: `${district}:2` })
    }
    await a.next('seated', (s) => s.bench === `${district}:2`)
    await b.next('seated', (s) => s.bench === `${district}:2`)
    const [fa, fb] = [a.mark(), b.mark()]
    expect((await block(tokenA, devId('Bench Bina'))).status).toBe(204)
    expect(await b.next('seated', (s) => s.bench === null, fb)).toEqual({
      t: 'seated',
      bench: null,
      seat: null,
      with: [],
    })
    await a.sync()
    // The blocker is never stood up, and now sits alone.
    expect(a.all('seated', fa).every((s) => s.bench !== null)).toBe(true)
    expect(a.all('seated', fa).at(-1)?.with).toEqual([])
    // And hears nothing more from the blocked one: B is no longer on the bench.
    b.send({ t: 'say', text: 'hello?' })
    await b.sync()
    expect(a.all('bench', fa)).toEqual([])
  })

  it("a blocked person sitting down after a block still cannot join the blocker's lines", async () => {
    const district: DistrictId = 'university'
    const at = BENCH_POSITIONS[district][3]!
    const tokenA = await resident('Late Anu')
    const tokenB = await resident('Late Bina')
    const a = await live(district, { token: tokenA })
    const b = await live(district, { token: tokenB })
    await block(tokenA, devId('Late Bina'))
    for (const c of [a, b]) {
      c.send({ t: 'move', x: at.x + 1, z: at.z, ry: 0 })
      c.send({ t: 'sit', bench: `${district}:3` })
    }
    await a.sync()
    await b.sync()
    const fa = a.mark()
    b.send({ t: 'say', text: 'sun rahe ho?' })
    await b.sync()
    await a.sync()
    expect(a.all('bench', fa)).toEqual([])
  })

  it('requests and match removed, and the blocker alone hears unmatched', async () => {
    const { a, b, aId, bId, matchId } = await pair('Gone Anu', 'Gone Bina')
    const c = await resident('Gone Chetan')
    const boxA = await inbox(a)
    const boxB = await inbox(b)
    // A pending request from Chetan to Anu, too.
    const sent = await api('/api/requests', c, {
      method: 'POST',
      body: JSON.stringify({ to: aId, reason: 'Mujhe bhi pencil sketching pasand hai' }),
    })
    expect(sent.status).toBe(201)
    expect((await block(a, bId)).status).toBe(204)
    expect(await boxA.next('unmatched')).toEqual({ t: 'unmatched', matchId })
    expect(((await (await api('/api/matches', a)).json()) as MatchView[]).length).toBe(0)
    expect(((await (await api('/api/matches', b)).json()) as MatchView[]).length).toBe(0)
    expect((await api(`/api/matches/${matchId}/messages`, a)).status).toBe(404)
    // A request from the blocker to someone is not shown to the blocked, and the other way round.
    const lists = (await (await api('/api/requests', a)).json()) as RequestLists
    expect(lists.incoming.length).toBe(1)
    const sendBack = await api('/api/requests', b, {
      method: 'POST',
      body: JSON.stringify({ to: aId, reason: 'Mujhe bhi pencil sketching pasand hai' }),
    })
    expect(sendBack.status).toBe(404)
    expect(await sendBack.json()).toEqual({ error: 'no-such-person' })
    // The blocked person was told nothing.
    await new Promise((r) => setTimeout(r, 50))
    expect(boxB.messages).toEqual([])
    // A block between two with only a pending request clears it too.
    expect((await block(c, aId)).status).toBe(204)
    const after = (await (await api('/api/requests', a)).json()) as RequestLists
    expect(after.incoming).toEqual([])
  })

  it('profile 404 both ways, and back after an unblock (which restores nothing)', async () => {
    const { a, b, aId, bId } = await pair('Prof Anu', 'Prof Bina')
    expect((await api(`/api/profiles/${encodeURIComponent(bId)}`, a)).status).toBe(200)
    await block(a, bId)
    expect((await api(`/api/profiles/${encodeURIComponent(bId)}`, a)).status).toBe(404)
    expect((await api(`/api/profiles/${encodeURIComponent(aId)}`, b)).status).toBe(404)
    const list = (await (await api('/api/blocks', a)).json()) as Listed[]
    expect(list).toEqual([{ handle: await handleOf(aId, bId), name: 'Prof' }])
    expect(await (await api('/api/blocks', b)).json()).toEqual([])
    expect((await unblock(a, list[0]!.handle)).status).toBe(204)
    expect((await api(`/api/profiles/${encodeURIComponent(bId)}`, a)).status).toBe(200)
    expect(((await (await api('/api/matches', a)).json()) as MatchView[]).length).toBe(0)
    expect(await (await api('/api/blocks', a)).json()).toEqual([])
  })

  it('the list names each block by a handle of its own, never the person, and unblocking takes only that', async () => {
    const { a, b, aId, bId } = await pair('Handle Anu', 'Handle Bina')
    expect((await block(a, bId)).status).toBe(204)
    const res = await api('/api/blocks', a)
    const raw = await res.text()
    expect(raw).not.toContain(bId)
    const list = JSON.parse(raw) as Record<string, unknown>[]
    expect(list).toHaveLength(1)
    expect(Object.keys(list[0]!).sort()).toEqual(['handle', 'name'])
    const handle = list[0]!.handle as string
    expect(handle).toMatch(/^[0-9a-f-]{32,36}$/)
    // Their id is no way to unblock (it names no row), nor is someone else's handle.
    expect((await unblock(a, bId)).status).toBe(204)
    expect((await unblock(b, handle)).status).toBe(204)
    expect((await api(`/api/profiles/${encodeURIComponent(bId)}`, a)).status).toBe(404)
    // A second block gets a handle of its own.
    const c = await resident('Handle Chetan')
    void c
    await block(a, devId('Handle Chetan'))
    const two = (await (await api('/api/blocks', a)).json()) as Listed[]
    expect(new Set(two.map((p) => p.handle)).size).toBe(2)
    expect((await unblock(a, handle)).status).toBe(204)
    expect((await api(`/api/profiles/${encodeURIComponent(bId)}`, a)).status).toBe(200)
    expect(((await (await api('/api/blocks', a)).json()) as Listed[]).map((p) => p.handle)).toEqual([
      await handleOf(aId, devId('Handle Chetan')),
    ])
  })

  it('idempotent, yourself is 400, an unknown id is 204 and stores nothing', async () => {
    const a = await resident('Idem Anu')
    await resident('Idem Bina')
    expect((await block(a, devId('Idem Bina'))).status).toBe(204)
    expect((await block(a, devId('Idem Bina'))).status).toBe(204)
    const rows = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM blocks WHERE a = ?')
      .bind(devId('Idem Anu'))
      .first<{ n: number }>()
    expect(rows!.n).toBe(1)
    expect((await block(a, devId('Idem Anu'))).status).toBe(400)
    expect((await block(a, 'dev:nobody-at-all')).status).toBe(204)
    expect(((await (await api('/api/blocks', a)).json()) as Listed[]).length).toBe(1)
    const handle = await handleOf(devId('Idem Anu'), devId('Idem Bina'))
    expect((await unblock(a, handle)).status).toBe(204)
    expect((await unblock(a, handle)).status).toBe(204)
    expect((await unblock(a, 'no-such-handle')).status).toBe(204)
    expect((await api('/api/blocks', a, { method: 'POST', body: '{}' })).status).toBe(400)
  })

  it('a block with no handle (an older row) never lists a null one, and unblocking "null" is a 404', async () => {
    const a = await resident('Legacy Anu')
    await resident('Legacy Bina')
    await block(a, devId('Legacy Bina'))
    await testEnv.DB.prepare('UPDATE blocks SET handle = NULL WHERE a = ?').bind(devId('Legacy Anu')).run()
    const list = (await (await api('/api/blocks', a)).json()) as Listed[]
    expect(list.length).toBe(1)
    expect(list[0]!.handle).toMatch(/^[0-9a-f]{32}$/)
    // Listing again gives the same handle: it was written back, not made up per read.
    expect(((await (await api('/api/blocks', a)).json()) as Listed[])[0]!.handle).toBe(list[0]!.handle)
    expect((await unblock(a, 'null')).status).toBe(404)
    expect((await unblock(a, 'undefined')).status).toBe(404)
    expect((await unblock(a, list[0]!.handle)).status).toBe(204)
  })

  it('a decline or an unmatch cooldown survives block and unblock', async () => {
    const a = await resident('Cool Anu')
    const b = await resident('Cool Bina')
    const body = JSON.stringify({ to: devId('Cool Anu'), reason: 'Mujhe bhi pencil sketching pasand hai' })
    const sent = await api('/api/requests', b, { method: 'POST', body })
    const { id } = (await sent.json()) as { id: string }
    expect((await api(`/api/requests/${id}/ignore`, a, { method: 'POST' })).status).toBe(204)
    await block(b, devId('Cool Anu'))
    await unblock(b, await handleOf(devId('Cool Bina'), devId('Cool Anu')))
    const again = await api('/api/requests', b, { method: 'POST', body })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'already' })
  })

  it('the block list shows only the saved first name, even for hidden, banned or profile-less people', async () => {
    const a = await resident('List Anu')
    await resident('List Hidden Hari', { status: 'secret status' })
    await resident('List Banned Bela')
    const ghost = await login('List Ghost')
    await api('/api/me', ghost)
    await testEnv.DB.prepare('UPDATE users SET hidden = 1 WHERE id = ?').bind(devId('List Hidden Hari')).run()
    await testEnv.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(devId('List Banned Bela')).run()
    for (const n of ['List Hidden Hari', 'List Banned Bela', 'List Ghost']) await block(a, devId(n))
    await testEnv.DB.prepare('UPDATE profiles SET name = ? WHERE user_id = ?')
      .bind('Renamed Later', devId('List Hidden Hari'))
      .run()
    const list = (await (await api('/api/blocks', a)).json()) as Listed[]
    const by = Object.fromEntries(list.map((p) => [p.handle, p]))
    const of = async (n: string) => by[await handleOf(devId('List Anu'), devId(n))]
    expect(await of('List Hidden Hari')).toEqual({ handle: expect.any(String), name: 'List' })
    expect(await of('List Banned Bela')).toEqual({ handle: expect.any(String), name: 'List' })
    expect(await of('List Ghost')).toEqual({ handle: expect.any(String), name: null })
    expect((await unblock(a, (await of('List Ghost'))!.handle)).status).toBe(204)
    expect(((await (await api('/api/blocks', a)).json()) as unknown[]).length).toBe(2)
  })

  it('a match that survives a block is listed for neither side, and accepting a blocked pair makes none', async () => {
    const { a, b, aId, bId } = await pair('Surv Anu', 'Surv Bina')
    await testEnv.DB.prepare('INSERT INTO blocks (a, b, created_at, name) VALUES (?, ?, 1, ?)')
      .bind(aId, bId, 'Surv')
      .run()
    expect(await (await api('/api/matches', a)).json()).toEqual([])
    expect(await (await api('/api/matches', b)).json()).toEqual([])
    const c = await resident('Surv Chetan')
    const d = await resident('Surv Dev')
    void c
    void d
    const [x, y] = [devId('Surv Chetan'), devId('Surv Dev')]
    await testEnv.DB.prepare(
      "INSERT INTO requests (id, from_id, to_id, reason, created_at, state) VALUES ('rq1', ?, ?, 'Mujhe bhi pencil sketching', ?, 'pending')",
    )
      .bind(x, y, Date.now())
      .run()
    await testEnv.DB.prepare('INSERT INTO blocks (a, b, created_at, name) VALUES (?, ?, 1, ?)')
      .bind(x, y, 'Surv')
      .run()
    await accept(testEnv, ['rq1'], x, y, Date.now())
    const m = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM matches WHERE a IN (?, ?) AND b IN (?, ?)')
      .bind(x, y, x, y)
      .first<{ n: number }>()
    expect(m!.n).toBe(0)
  })
})

describe('block limits', () => {
  it('blocking and unblocking share 30 an hour per account, then 429 with Retry-After', async () => {
    const token = await resident('Block Hammer')
    // Mixed, and about ids that may not exist: every call counts.
    for (let i = 0; i < BLOCKS_PER_HOUR; i++) {
      const res = i % 2 ? await unblock(token, `dev:hammered-${i}`) : await block(token, `dev:hammered-${i}`)
      expect(res.status, `call ${i + 1}`).toBe(204)
    }
    for (const res of [await block(token, 'dev:hammered-x'), await unblock(token, 'dev:hammered-x')]) {
      expect(res.status).toBe(429)
      expect(await res.json()).toEqual({ error: 'rate' })
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    }
    // Someone else's allowance is their own.
    expect((await block(await resident('Block Calm'), 'dev:hammered-x')).status).toBe(204)
  })
})
