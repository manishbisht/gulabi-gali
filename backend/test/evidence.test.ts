import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { endMatch } from '../src/chat'
import type { Env } from '../src/env'
import { chatEvidence, EVIDENCE_MESSAGES, HOLD_MS, purgeEvidence } from '../src/evidence'
import { api, closeAll, pair, resident } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

afterEach(() => closeAll())

/** `n` messages straight into D1, alternating senders, a second apart from `at` on. */
async function seed(matchId: string, from: [string, string], n: number, at: number) {
  await testEnv.DB.batch(
    Array.from({ length: n }, (_, i) =>
      testEnv.DB.prepare(
        'INSERT INTO messages (id, match_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(`${matchId}:${i}`, matchId, from[i % 2], `line ${i}`, at + i * 1000),
    ),
  )
}

const count = async (sql: string, ...args: unknown[]) =>
  (await testEnv.DB.prepare(sql)
    .bind(...args)
    .first<{ n: number }>())!.n

describe('held evidence', () => {
  it('unmatch, then report: the report carries the last 30 messages, for either member only', async () => {
    const { a, aId, bId, matchId } = await pair('Held Asha', 'Held Bilal')
    const at = Date.now() - 3_600_000
    await seed(matchId, [aId, bId], 35, at)
    const live = await chatEvidence(testEnv, bId, matchId)
    expect(live?.messages).toHaveLength(EVIDENCE_MESSAGES)

    expect((await api(`/api/matches/${matchId}`, a, { method: 'DELETE' })).status).toBe(204)
    expect(await count('SELECT COUNT(*) AS n FROM messages WHERE match_id = ?', matchId)).toBe(0)

    // Either side may still report it: the one who unmatched and the one who was unmatched.
    for (const reporter of [aId, bId]) {
      const held = await chatEvidence(testEnv, reporter, matchId)
      expect(held?.other).toBe(reporter === aId ? bId : aId)
      expect(held?.messages).toHaveLength(30)
      expect(held?.messages[0]).toEqual({ from: bId, body: 'line 5', at: at + 5000 })
      expect(held?.messages.at(-1)).toEqual({ from: aId, body: 'line 34', at: at + 34_000 })
      expect(held?.messages).toEqual(live?.messages)
    }
    await resident('Held Stranger')
    expect(await chatEvidence(testEnv, 'dev:held-stranger', matchId)).toBeNull()
    // One unmatch holds one copy.
    expect(await count('SELECT COUNT(*) AS n FROM held_evidence WHERE match_id = ?', matchId)).toBe(1)
  })

  it('block, then report: the auto-unmatch holds the messages too, and clears requests both ways', async () => {
    const { aId, bId, matchId } = await pair('Block Bela', 'Block Bhanu')
    await seed(matchId, [bId, aId], 4, Date.now() - 60_000)
    await testEnv.DB.prepare('INSERT INTO blocks (a, b, created_at) VALUES (?, ?, ?)')
      .bind(aId, bId, Date.now())
      .run()
    expect(await endMatch(testEnv, aId, bId, 'block')).toBe(matchId)
    expect(await count('SELECT COUNT(*) AS n FROM matches WHERE id = ?', matchId)).toBe(0)
    // No tombstone and no accepted rows left: the block itself keeps them apart.
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM requests WHERE (from_id = ?1 AND to_id = ?2) OR (from_id = ?2 AND to_id = ?1)',
        aId,
        bId,
      ),
    ).toBe(0)
    const held = await chatEvidence(testEnv, bId, matchId)
    expect(held?.messages.map((m) => m.body)).toEqual(['line 0', 'line 1', 'line 2', 'line 3'])
    // Ending it again finds nothing to end.
    expect(await endMatch(testEnv, aId, bId, 'block')).toBeNull()
  })

  it('is purged 30 days after the match ended', async () => {
    const { a, aId, matchId } = await pair('Purge Pari', 'Purge Prem')
    expect((await api(`/api/matches/${matchId}`, a, { method: 'DELETE' })).status).toBe(204)
    const now = Date.now()
    await purgeEvidence(testEnv, now + HOLD_MS - 60_000)
    expect(await chatEvidence(testEnv, aId, matchId, now + HOLD_MS - 60_000)).not.toBeNull()
    // Past 30 days it is no longer offered, even before the cron comes by...
    expect(await chatEvidence(testEnv, aId, matchId, now + HOLD_MS + 60_000)).toBeNull()
    // ...and the cron deletes it.
    await purgeEvidence(testEnv, now + HOLD_MS + 60_000)
    expect(await count('SELECT COUNT(*) AS n FROM held_evidence WHERE match_id = ?', matchId)).toBe(0)
  })
})
