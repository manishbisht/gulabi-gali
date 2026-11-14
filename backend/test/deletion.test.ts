import { applyD1Migrations, env, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import { GATE_NAME } from '../src/gate'
import { LIVE_CLOSE } from '../src/protocol'
import { api, devId, inbox, live, pair, resident, settle, WAIT } from './helpers'
import { vi } from 'vitest'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const db = testEnv.DB

beforeAll(async () => {
  await applyD1Migrations(db, testEnv.TEST_MIGRATIONS)
})
afterEach(() => settle())

const del = (token: string) => api('/api/me', token, { method: 'DELETE' })
const count = async (sql: string, ...args: unknown[]) =>
  (await db
    .prepare(sql)
    .bind(...args)
    .first<{ n: number }>())!.n
const gate = () => testEnv.GATE.get(testEnv.GATE.idFromName(GATE_NAME))
const slotsOf = (userId: string) =>
  runInDurableObject(gate(), (_i, state) =>
    state.storage.sql
      .exec<{ district: string }>('SELECT district FROM slots WHERE user_id = ?', userId)
      .toArray(),
  )

describe('delete my account', () => {
  it('removes profile, requests, matches, messages, invites and blocks made, and keeps what others made', async () => {
    const { a, b, aId, bId, matchId } = await pair('Gone Gita', 'Stay Sunil')
    const chatter = await resident('Gone Chitra')
    // A message in the match, a pending request each way, an invite code, a block made, a block received.
    await db
      .prepare('INSERT INTO messages (id, match_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind('m1', matchId, aId, 'namaste', Date.now())
      .run()
    await api('/api/requests', chatter, {
      method: 'POST',
      body: JSON.stringify({ to: aId, reason: 'Mujhe bhi pencil sketching pasand hai' }),
    })
    await api('/api/invites', a)
    const strangerId = devId('Block Target Tara')
    await resident('Block Target Tara')
    await api('/api/blocks', a, { method: 'POST', body: JSON.stringify({ id: strangerId }) })
    await db
      .prepare('INSERT INTO blocks (a, b, created_at, name) VALUES (?, ?, ?, ?)')
      .bind(strangerId, aId, 1, 'Tara')
      .run()
    await db
      .prepare('INSERT INTO counters (user_id, bucket, window_start, n) VALUES (?, ?, ?, ?)')
      .bind(aId, 'requests', 1, 2)
      .run()

    expect((await del(a)).status).toBe(204)

    expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?', aId)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?', aId)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM requests WHERE from_id = ?1 OR to_id = ?1', aId)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM matches WHERE a = ?1 OR b = ?1', aId)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM messages WHERE match_id = ?', matchId)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM invites WHERE owner = ?', aId)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM blocks WHERE a = ?', aId)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM counters WHERE user_id = ?', aId)).toBe(0)
    // A block someone else made against them stays, so it still protects its owner if they come back.
    expect(await count('SELECT COUNT(*) AS n FROM blocks WHERE a = ? AND b = ?', strangerId, aId)).toBe(1)
    // The other person is untouched and sees no match.
    expect(await count('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?', bId)).toBe(1)
    const lists = await (await api('/api/matches', b)).json()
    expect(lists).toEqual([])
    // Their chat was held for reports (30 days), not kept as a chat.
    expect(await count('SELECT COUNT(*) AS n FROM held_evidence WHERE match_id = ?', matchId)).toBe(1)
    // Signed in again with the same id: a blank profile.
    const again = await (await api('/api/me', a)).json()
    expect(again).toMatchObject({ id: aId, profile: null, complete: false, verified: false })
  })

  it('reports filed by them keep their evidence with reporter=deleted; reports about them stay', async () => {
    const { a, b, aId, bId } = await pair('Rep Rekha', 'Rep Rohan')
    await db
      .prepare(
        'INSERT INTO messages (id, match_id, sender, body, created_at) SELECT ?, id, ?, ?, ? FROM matches',
      )
      .bind('m-rep', bId, 'hello there', Date.now())
      .run()
    const filed = await api('/api/reports', a, {
      method: 'POST',
      body: JSON.stringify({ kind: 'person', targetId: bId, reason: 'harassment' }),
    })
    expect(filed.status).toBe(201)
    const about = await api('/api/reports', b, {
      method: 'POST',
      body: JSON.stringify({ kind: 'person', targetId: aId, reason: 'spam' }),
    })
    expect(about.status).toBe(201)

    expect((await del(a)).status).toBe(204)

    const mine = await db
      .prepare('SELECT reporter, evidence, state FROM reports WHERE target_id = ?')
      .bind(bId)
      .first<{ reporter: string; evidence: string | null; state: string }>()
    expect(mine).toMatchObject({ reporter: 'deleted', state: 'open' })
    expect(mine!.evidence).not.toBeNull()
    expect(await count('SELECT COUNT(*) AS n FROM reports WHERE reporter = ?', aId)).toBe(0)
    const aboutThem = await db
      .prepare('SELECT state, evidence FROM reports WHERE target_id = ?')
      .bind(aId)
      .first<{ state: string; evidence: string | null }>()
    expect(aboutThem).toMatchObject({ state: 'open' })
    expect(aboutThem!.evidence).not.toBeNull()
  })

  it("closes the person's district and inbox sockets with 4006 and frees their gate slot", async () => {
    const token = await resident('Socket Sana')
    const id = devId('Socket Sana')
    const street = await live('mi-road', { token })
    street.send({ t: 'move', x: 1, z: 1, ry: 0 })
    await street.sync()
    const box = await inbox(token)
    expect((await slotsOf(id)).length).toBeGreaterThan(0)

    expect((await del(token)).status).toBe(204)

    await vi.waitFor(() => expect(street.closes).toEqual([LIVE_CLOSE.deleted]), WAIT)
    await vi.waitFor(() => expect(box.closes).toEqual([LIVE_CLOSE.deleted]), WAIT)
    // No hold is kept for them: the slot is free now.
    await vi.waitFor(async () => expect(await slotsOf(id)).toEqual([]), WAIT)
  })

  it('a banned person cannot delete their way out of the ban; a hidden one stays hidden', async () => {
    const banned = await resident('Ban Evader')
    await db.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(devId('Ban Evader')).run()
    expect((await del(banned)).status).toBe(403)
    expect(
      await count('SELECT COUNT(*) AS n FROM users WHERE id = ? AND banned = 1', devId('Ban Evader')),
    ).toBe(1)

    const hidden = await resident('Hide Evader')
    await db.prepare('UPDATE users SET hidden = 1 WHERE id = ?').bind(devId('Hide Evader')).run()
    expect((await del(hidden)).status).toBe(204)
    expect(await count('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?', devId('Hide Evader'))).toBe(0)
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM users WHERE id = ? AND hidden = 1 AND verified = 0',
        devId('Hide Evader'),
      ),
    ).toBe(1)
  })

  it('is idempotent and needs sign-in', async () => {
    const token = await resident('Twice Tina')
    expect((await del(token)).status).toBe(204)
    expect((await del(token)).status).toBe(204)
    const res = await (
      await import('cloudflare:test')
    ).SELF.fetch('https://api.test/api/me', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})
