import { applyD1Migrations, env, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanMessage, postMessage } from '../src/chat'
import type { Env } from '../src/env'
import type { ChatMessage, MatchView, MessagePage } from '../src/protocol'
import { closeAll, inbox, resident } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

afterEach(() => closeAll())

const REASON = 'Mujhe bhi pencil sketching pasand hai'
const id = (name: string) => `dev:${name.toLowerCase()}`
const api = (path: string, token: string, init: RequestInit = {}) =>
  SELF.fetch(`https://api.test${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
const say = (token: string, matchId: string, body: unknown) =>
  api(`/api/matches/${matchId}/messages`, token, { method: 'POST', body: JSON.stringify({ body }) })
const page = async (token: string, matchId: string, before?: string) => {
  const res = await api(
    `/api/matches/${matchId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`,
    token,
  )
  expect(res.status).toBe(200)
  return (await res.json()) as MessagePage
}
const count = async (sql: string, ...args: unknown[]) =>
  (await testEnv.DB.prepare(sql)
    .bind(...args)
    .first<{ n: number }>())!.n

/** Two residents, matched: their tokens and the match id. */
async function pair(x: string, y: string, over: Record<string, unknown> = {}) {
  const a = await resident(x)
  const b = await resident(y, over)
  const { id: rid } = (await (
    await api('/api/requests', a, { method: 'POST', body: JSON.stringify({ to: id(y), reason: REASON }) })
  ).json()) as { id: string }
  const res = await api(`/api/requests/${rid}/accept`, b, { method: 'POST' })
  expect(res.status).toBe(200)
  const { matchId } = (await res.json()) as { matchId: string }
  return { a, b, matchId }
}

/** Messages straight into D1, all at `at` (ties on purpose), oldest first by id. */
async function seed(matchId: string, sender: string, n: number, at: number) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `m-${String(i).padStart(4, '0')}`,
    body: `line ${i}`,
  }))
  await testEnv.DB.batch(
    rows.map((r) =>
      testEnv.DB.prepare(
        'INSERT INTO messages (id, match_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(`${matchId}:${r.id}`, matchId, sender, r.body, at),
    ),
  )
}

describe('chat', () => {
  it('only members can read and write', async () => {
    const { a, b, matchId } = await pair('chata1', 'chatb1')
    const stranger = await resident('chatc1')
    expect((await say(a, matchId, 'Kal chai?')).status).toBe(201)
    expect((await page(b, matchId)).messages.map((m) => m.body)).toEqual(['Kal chai?'])

    const notFound = async (res: Response) => {
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not-found' })
    }
    await notFound(await api(`/api/matches/${matchId}/messages`, stranger))
    await notFound(await say(stranger, matchId, 'hello'))
    await notFound(await api(`/api/matches/${matchId}`, stranger, { method: 'DELETE' }))
    // An id that is no match at all reads exactly the same.
    await notFound(await api('/api/matches/no-such-match/messages', a))
    await notFound(await say(a, 'no-such-match', 'hello'))
    expect(await count('SELECT COUNT(*) n FROM messages WHERE match_id = ?', matchId)).toBe(1)

    // A member who is no longer a resident can neither read nor write.
    await testEnv.DB.prepare('UPDATE profiles SET pledge = 0 WHERE user_id = ?').bind(id('chatb1')).run()
    await notFound(await api(`/api/matches/${matchId}/messages`, b))
    await notFound(await say(b, matchId, 'still here?'))
    await testEnv.DB.prepare('UPDATE profiles SET pledge = 1 WHERE user_id = ?').bind(id('chatb1')).run()
    await testEnv.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(id('chatb1')).run()
    await notFound(await api(`/api/matches/${matchId}/messages`, b))
    await notFound(await say(b, matchId, 'still here?'))
    await notFound(await api(`/api/matches/${matchId}`, b, { method: 'DELETE' }))
    // Nor does the other member write to someone who was banned.
    await notFound(await say(a, matchId, 'hello?'))
    expect(await count('SELECT COUNT(*) n FROM matches WHERE id = ?', matchId)).toBe(1)
  })

  it('unmatch deletes messages for both and notifies', async () => {
    const { a, b, matchId } = await pair('chata2', 'chatb2')
    expect((await say(a, matchId, 'Namaste')).status).toBe(201)
    expect((await say(b, matchId, 'Namaste ji')).status).toBe(201)
    const box = await inbox(b)
    const res = await api(`/api/matches/${matchId}`, a, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(await box.next('unmatched')).toEqual({ t: 'unmatched', matchId })
    expect(await count('SELECT COUNT(*) n FROM messages WHERE match_id = ?', matchId)).toBe(0)
    expect(await count('SELECT COUNT(*) n FROM matches WHERE id = ?', matchId)).toBe(0)
    for (const token of [a, b]) {
      expect((await api(`/api/matches/${matchId}/messages`, token)).status).toBe(404)
      expect(await (await api('/api/matches', token)).json()).toEqual([])
    }
    // The accepted request went with it.
    expect(
      await count(
        "SELECT COUNT(*) n FROM requests WHERE from_id = ? AND to_id = ? AND state = 'accepted'",
        id('chata2'),
        id('chatb2'),
      ),
    ).toBe(0)
    // The one who was unmatched cannot ask straight back: that reads as any other refused ask.
    const back = await api('/api/requests', b, {
      method: 'POST',
      body: JSON.stringify({ to: id('chata2'), reason: REASON }),
    })
    expect(back.status).toBe(409)
    expect(await back.json()).toEqual({ error: 'already' })
    // Nor do they see a request of their own they never sent.
    for (const token of [a, b])
      expect(await (await api('/api/requests', token)).json()).toEqual({ incoming: [], sent: [] })
    // The one who unmatched may still ask again later.
    const again = await api('/api/requests', a, {
      method: 'POST',
      body: JSON.stringify({ to: id('chatb2'), reason: REASON }),
    })
    expect(again.status).toBe(201)
    expect((await api(`/api/matches/${matchId}`, a, { method: 'DELETE' })).status).toBe(404)
  })

  it('unmatch leaves an ignored request standing', async () => {
    const { b, matchId } = await pair('chata3', 'chatb3')
    // An old decline the other way round: it still blocks for its 14 days.
    await testEnv.DB.prepare(
      "INSERT INTO requests (id, from_id, to_id, reason, created_at, state) VALUES (?, ?, ?, ?, ?, 'ignored')",
    )
      .bind('chat3-ignored', id('chatb3'), id('chata3'), REASON, Date.now())
      .run()
    expect((await api(`/api/matches/${matchId}`, b, { method: 'DELETE' })).status).toBe(204)
    expect(await count("SELECT COUNT(*) n FROM requests WHERE id = 'chat3-ignored'")).toBe(1)
    const again = await api('/api/requests', b, {
      method: 'POST',
      body: JSON.stringify({ to: id('chata3'), reason: REASON }),
    })
    expect(again.status).toBe(409)
  })

  it('message notifies the other member’s open inbox socket', async () => {
    const { a, b, matchId } = await pair('chata4', 'chatb4')
    const [boxA, boxB] = [await inbox(a), await inbox(b)]
    const res = await say(a, matchId, 'Tapri pe milte hain')
    expect(res.status).toBe(201)
    const sent = (await res.json()) as ChatMessage
    expect(sent).toMatchObject({ body: 'Tapri pe milte hain', mine: true })
    expect(await boxB.next('message')).toEqual({ t: 'message', matchId, id: sent.id })
    // The sender's own inbox stays quiet.
    expect(boxA.messages.filter((m) => m.t === 'message')).toEqual([])
    const seen = await page(b, matchId)
    expect(seen.messages).toEqual([{ ...sent, mine: false }])
  })

  it('501-char message is 400', async () => {
    const { a, matchId } = await pair('chata5', 'chatb5')
    for (const body of ['x'.repeat(501), '', '   \n\t ', '​​', 42, null]) {
      const res = await say(a, matchId, body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid' })
    }
    expect(await count('SELECT COUNT(*) n FROM messages WHERE match_id = ?', matchId)).toBe(0)
    // 500 code points is fine, even when they are astral.
    const ok = await postMessage(testEnv, id('chata5'), matchId, { body: '😀'.repeat(500) })
    expect(ok.status).toBe(201)
  })

  it('cleans a message but keeps its lines, at most ten', () => {
    expect(cleanMessage('  Kal\r\n‮  chai  pe?\t\n\nZaroor  ')).toBe('Kal\nchai pe?\n\nZaroor')
    expect(cleanMessage('\n\n\nhi\n\n')).toBe('hi')
    const many = Array.from({ length: 14 }, (_, i) => `l${i}`).join('\n')
    expect(cleanMessage(many)).toBe(
      [...Array.from({ length: 9 }, (_, i) => `l${i}`), 'l9 l10 l11 l12 l13'].join('\n'),
    )
    expect(cleanMessage('x'.repeat(500))).toBe('x'.repeat(500))
    expect(cleanMessage('x'.repeat(501))).toBeNull()
  })

  it('a sender may send one message a second', async () => {
    const { matchId } = await pair('chata6', 'chatb6')
    const now = Date.now()
    expect((await postMessage(testEnv, id('chata6'), matchId, { body: 'one' }, now)).status).toBe(201)
    const fast = await postMessage(testEnv, id('chata6'), matchId, { body: 'two' }, now + 500)
    expect(fast.status).toBe(429)
    expect(await fast.json()).toEqual({ error: 'rate' })
    // The other member has an allowance of their own.
    expect((await postMessage(testEnv, id('chatb6'), matchId, { body: 'hi' }, now + 500)).status).toBe(201)
    expect((await postMessage(testEnv, id('chata6'), matchId, { body: 'two' }, now + 1001)).status).toBe(201)
  })

  it('two messages at once from one sender: one goes through', async () => {
    const { a, matchId } = await pair('chata9', 'chatb9')
    const both = await Promise.all([say(a, matchId, 'x'), say(a, matchId, 'y')])
    expect(both.map((r) => r.status).sort()).toEqual([201, 429])
    expect(await await both.find((r) => r.status === 429)!.json()).toEqual({ error: 'rate' })
    expect(await count('SELECT COUNT(*) n FROM messages WHERE match_id = ?', matchId)).toBe(1)
  })

  it('pages back through history 50 at a time, newest last, stable on ties', async () => {
    const { a, b, matchId } = await pair('chata7', 'chatb7')
    const at = Date.now() - 60_000
    await seed(matchId, id('chata7'), 120, at)
    const first = await page(b, matchId)
    expect(first.messages).toHaveLength(50)
    expect(first.messages.at(-1)!.body).toBe('line 119')
    expect(first.messages[0].body).toBe('line 70')
    expect(first.messages.every((m) => !m.mine && m.at === at)).toBe(true)
    const second = await page(b, matchId, first.before!)
    expect(second.messages.map((m) => m.body)).toEqual(Array.from({ length: 50 }, (_, i) => `line ${i + 20}`))
    const third = await page(b, matchId, second.before!)
    expect(third.messages.map((m) => m.body)).toEqual(Array.from({ length: 20 }, (_, i) => `line ${i}`))
    expect(third.before).toBeNull()
    expect((await page(a, matchId, first.before!)).messages.every((m) => m.mine)).toBe(true)
    for (const bad of ['garbage', '%%%', 'x'.repeat(300)]) {
      const res = await api(`/api/matches/${matchId}/messages?before=${encodeURIComponent(bad)}`, b)
      expect(res.status).toBe(400)
    }
  })

  it('lists matches with the other person and the last message', async () => {
    const { a, b, matchId } = await pair('chata8', 'chatb8', { name: 'Bela Rathore' })
    // A second match for chata8, with nothing said yet.
    const c = await resident('chatc8')
    const { id: rid } = (await (
      await api('/api/requests', a, {
        method: 'POST',
        body: JSON.stringify({ to: id('chatc8'), reason: REASON }),
      })
    ).json()) as { id: string }
    const { matchId: other } = (await (
      await api(`/api/requests/${rid}/accept`, c, { method: 'POST' })
    ).json()) as {
      matchId: string
    }
    const now = Date.now()
    expect((await postMessage(testEnv, id('chata8'), matchId, { body: 'Pehla' }, now)).status).toBe(201)
    const second = await postMessage(testEnv, id('chatb8'), matchId, { body: 'Doosra' }, now + 1)
    expect(second.status).toBe(201)
    // the last line carries its message id: a page tells unread from read without fetching the chat
    const { id: lastId } = (await second.json()) as { id: string }

    const res = await api('/api/matches', a)
    expect(res.status).toBe(200)
    const list = (await res.json()) as MatchView[]
    expect(list).toEqual([
      {
        id: matchId,
        person: {
          id: id('chatb8'),
          name: 'Bela',
          look: { skin: 1, outfit: 'pink', head: 'none' },
          status: 'chai pe',
        },
        last: { id: lastId, body: 'Doosra', at: now + 1, mine: false },
      },
      { id: other, person: expect.objectContaining({ id: id('chatc8') }) },
    ])
    expect(JSON.stringify(list)).not.toContain('Private')
    const theirs = (await (await api('/api/matches', b)).json()) as MatchView[]
    expect(theirs).toEqual([
      expect.objectContaining({ id: matchId, last: { id: lastId, body: 'Doosra', at: now + 1, mine: true } }),
    ])

    // Someone banned drops out of the list.
    await testEnv.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(id('chatc8')).run()
    expect(((await (await api('/api/matches', a)).json()) as MatchView[]).map((m) => m.id)).toEqual([matchId])
  })
})
