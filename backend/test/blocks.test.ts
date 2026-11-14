import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BENCH_POSITIONS } from '../src/district'
import type { Env } from '../src/env'
import type { DistrictId, MatchView, PublicPerson, RequestLists } from '../src/protocol'
import { api, closeAll, devId, inbox, live, pair, resident, type LiveClient } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})
afterEach(() => closeAll())

const block = (token: string, id: string) =>
  api('/api/blocks', token, { method: 'POST', body: JSON.stringify({ id }) })
const unblock = (token: string, id: string) =>
  api(`/api/blocks/${encodeURIComponent(id)}`, token, { method: 'DELETE' })

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
    const list = (await (await api('/api/blocks', a)).json()) as PublicPerson[]
    expect(list.map((p) => p.id)).toEqual([bId])
    expect(list[0]!.name).toBe('Prof')
    expect(await (await api('/api/blocks', b)).json()).toEqual([])
    expect((await unblock(a, bId)).status).toBe(204)
    expect((await api(`/api/profiles/${encodeURIComponent(bId)}`, a)).status).toBe(200)
    expect(((await (await api('/api/matches', a)).json()) as MatchView[]).length).toBe(0)
    expect(await (await api('/api/blocks', a)).json()).toEqual([])
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
    expect(((await (await api('/api/blocks', a)).json()) as PublicPerson[]).length).toBe(1)
    expect((await unblock(a, devId('Idem Bina'))).status).toBe(204)
    expect((await unblock(a, devId('Idem Bina'))).status).toBe(204)
    expect((await unblock(a, 'dev:nobody-at-all')).status).toBe(204)
    expect((await api('/api/blocks', a, { method: 'POST', body: '{}' })).status).toBe(400)
  })
})
