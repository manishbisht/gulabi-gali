import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import { HOLD_MS } from '../src/evidence'
import type { EndedChat } from '../src/protocol'
import { api, login, pair, resident, settle } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})
afterEach(() => settle())

const ended = async (token: string) => {
  const res = await api('/api/ended', token)
  expect(res.status).toBe(200)
  return (await res.json()) as EndedChat[]
}

/** A chat between the victim (`a`) and the harasser (`b`), with a line from each. */
async function chat(victim: string, harasser: string) {
  const p = await pair(victim, harasser)
  for (const [token, body] of [
    [p.b, 'tum kahan rehti ho? batao'],
    [p.a, 'please stop'],
  ] as const) {
    const res = await api(`/api/matches/${p.matchId}/messages`, token, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
    expect(res.status).toBe(201)
  }
  return p
}

/** The victim files a chat report about the harasser; answers the evidence it carries. */
async function reportChat(token: string, target: string) {
  const res = await api('/api/reports', token, {
    method: 'POST',
    body: JSON.stringify({ kind: 'chat', targetId: target, reason: 'harassment' }),
  })
  expect(res.status).toBe(201)
  const row = await testEnv.DB.prepare(
    'SELECT evidence FROM reports WHERE target_id = ? AND target_kind = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(target, 'chat')
    .first<{ evidence: string }>()
  return JSON.parse(row!.evidence) as { matchId: string; messages: { body: string }[] }
}

describe('ended chats', () => {
  const ways: [string, (p: Awaited<ReturnType<typeof chat>>) => Promise<Response>][] = [
    ['blocks', (p) => api('/api/blocks', p.b, { method: 'POST', body: JSON.stringify({ id: p.aId }) })],
    ['unmatches', (p) => api(`/api/matches/${p.matchId}`, p.b, { method: 'DELETE' })],
    ['deletes his account', (p) => api('/api/me', p.b, { method: 'DELETE' })],
  ]
  for (const [how, end] of ways)
    it(`the harasser ${how}: the victim still lists the chat and reports it with the held messages`, async () => {
      const word = how.split(' ')[0]!
      const p = await chat(`Victim ${word}`, `Harasser ${word}`)
      expect(await ended(p.a)).toEqual([])
      expect((await end(p)).status).toBe(204)

      const list = await ended(p.a)
      expect(list).toEqual([
        { matchId: p.matchId, person: { id: p.bId, name: 'Harasser' }, endedAt: expect.any(Number) },
      ])
      const evidence = await reportChat(p.a, p.bId)
      expect(evidence.matchId).toBe(p.matchId)
      expect(evidence.messages.map((m) => m.body)).toEqual(['tum kahan rehti ho? batao', 'please stop'])
    })

  it('lists only your own, from the last 30 days, and only for a resident', async () => {
    const p = await chat('Victim Own', 'Harasser Own')
    expect((await api(`/api/matches/${p.matchId}`, p.a, { method: 'DELETE' })).status).toBe(204)
    // Both sides see it, each with the other's name.
    expect((await ended(p.a)).map((e) => e.person)).toEqual([{ id: p.bId, name: 'Harasser' }])
    expect((await ended(p.b)).map((e) => e.person)).toEqual([{ id: p.aId, name: 'Victim' }])
    expect(await ended(await resident('Bystander Own'))).toEqual([])
    // Past 30 days it is gone from the list, even before the cron comes by.
    await testEnv.DB.prepare('UPDATE held_evidence SET created_at = ? WHERE match_id = ?')
      .bind(Date.now() - HOLD_MS - 1000, p.matchId)
      .run()
    expect(await ended(p.a)).toEqual([])
    // A ghost has nothing to report with.
    expect((await api('/api/ended', await login('Ghost Own'))).status).toBe(403)
  })
})
