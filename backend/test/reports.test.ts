import { applyD1Migrations, env, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BENCH_POSITIONS, TRANSCRIPT_MS } from '../src/district'
import type { Env } from '../src/env'
import { EVIDENCE_MESSAGES } from '../src/evidence'
import type { BenchLine, DistrictId } from '../src/protocol'
import {
  EVIDENCE_MAX_BYTES,
  fitEvidence,
  purgeReportEvidence,
  REPORT_KEEP_MS,
  REPORTS_PER_DAY,
} from '../src/reports'
import { api, closeAll, devId, live, pair, resident, type LiveClient } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const stub = (id: DistrictId) => testEnv.DISTRICT.get(testEnv.DISTRICT.idFromName(id))

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})
afterEach(() => closeAll())

const report = (token: string, body: Record<string, unknown>) =>
  api('/api/reports', token, { method: 'POST', body: JSON.stringify({ reason: 'harassment', ...body }) })

interface Row {
  reporter: string
  target_kind: string
  target_id: string
  reason: string
  note: string
  evidence: string | null
  state: string
}
const rowsAbout = async (target: string) =>
  (
    await testEnv.DB.prepare('SELECT * FROM reports WHERE target_id = ? ORDER BY created_at, rowid')
      .bind(target)
      .all<Row>()
  ).results
const lastAbout = async (target: string) => (await rowsAbout(target)).at(-1)!
const evidenceOf = (row: Row) => JSON.parse(row.evidence!) as Record<string, unknown>

/** A resident at `bench`, seated. */
async function sitter(name: string, district: DistrictId, bench: number): Promise<LiveClient> {
  const at = BENCH_POSITIONS[district][bench]!
  const c = await live(district, { token: await resident(name) })
  c.send({ t: 'move', x: at.x + 1, z: at.z, ry: 0 })
  c.send({ t: 'sit', bench: `${district}:${bench}` })
  await c.next('seated', (m) => m.bench === `${district}:${bench}`)
  return c
}

describe('reports', () => {
  it('bench report carries the last 10 minutes and only if you were there', async () => {
    const district: DistrictId = 'university'
    const bench = `${district}:2`
    const uni = stub(district)
    const loud = await sitter('Bench Loud Lakhan', district, 2)
    await sitter('Bench Reporter Rani', district, 2)
    const rani = await resident('Bench Reporter Rani')
    const lakhan = devId('Bench Loud Lakhan')
    const start = Date.now()
    try {
      // A line from eleven minutes ago, then one from now: only the second is still in the transcript.
      await runInDurableObject(uni, (i) => {
        i.clock = () => start - TRANSCRIPT_MS - 60_000
      })
      loud.send({ t: 'say', text: 'purani baat' })
      await loud.next('bench', (m) => m.text === 'purani baat')
      await runInDurableObject(uni, (i) => {
        i.clock = Date.now
      })
      loud.send({ t: 'say', text: 'abhi ki baat' })
      await loud.next('bench', (m) => m.text === 'abhi ki baat')

      const res = await report(rani, { kind: 'bench', targetId: lakhan, bench })
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({ autoHidden: false })
      const row = await lastAbout(lakhan)
      expect(row).toMatchObject({
        reporter: devId('Bench Reporter Rani'),
        target_kind: 'bench',
        state: 'open',
      })
      const evidence = evidenceOf(row) as { bench: string; lines: BenchLine[] }
      expect(evidence.bench).toBe(bench)
      expect(evidence.lines.map((l) => [l.from, l.text])).toEqual([[lakhan, 'abhi ki baat']])

      // Never there: nothing to carry, so no report.
      const stranger = await resident('Bench Stranger Suraj')
      expect((await report(stranger, { kind: 'bench', targetId: lakhan, bench })).status).toBe(404)
      // There, but the person named never was.
      await resident('Bench Elsewhere Ela')
      expect(
        (await report(rani, { kind: 'bench', targetId: devId('Bench Elsewhere Ela'), bench })).status,
      ).toBe(404)
      // A bench that is not a bench, and one left out.
      expect((await report(rani, { kind: 'bench', targetId: lakhan, bench: 'nowhere:2' })).status).toBe(400)
      expect((await report(rani, { kind: 'bench', targetId: lakhan })).status).toBe(400)

      // Someone who sat and got up can report for 10 minutes, and not after.
      const left = await sitter('Bench Left Lata', district, 2)
      left.send({ t: 'sit', bench: null })
      await left.next('seated', (m) => m.bench === null)
      const lata = await resident('Bench Left Lata')
      const at = async (ms: number) => {
        await runInDurableObject(uni, (i) => {
          i.clock = () => start + ms
        })
        return (await report(lata, { kind: 'bench', targetId: lakhan, bench })).status
      }
      expect(await at(TRANSCRIPT_MS - 60_000)).toBe(201)
      expect(await at(TRANSCRIPT_MS + 60_000)).toBe(404)
    } finally {
      await runInDurableObject(uni, (i) => {
        i.clock = Date.now
      })
    }
    expect((await rowsAbout(lakhan)).length).toBe(2)
  })

  it('chat report carries the last 30 messages and only for members', async () => {
    const { a, b, aId, bId, matchId } = await pair('Chat Report Asha', 'Chat Report Bilal')
    const at = Date.now() - 3_600_000
    await testEnv.DB.batch(
      Array.from({ length: 35 }, (_, i) =>
        testEnv.DB.prepare(
          'INSERT INTO messages (id, match_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(`${matchId}:${i}`, matchId, i % 2 ? aId : bId, `line ${i}`, at + i * 1000),
      ),
    )
    const res = await report(a, { kind: 'chat', targetId: bId, reason: 'spam' })
    expect(res.status).toBe(201)
    const row = await lastAbout(bId)
    expect(row).toMatchObject({ reporter: aId, target_kind: 'chat', reason: 'spam' })
    const evidence = evidenceOf(row) as { matchId: string; messages: { from: string; body: string }[] }
    expect(evidence.matchId).toBe(matchId)
    expect(evidence.messages).toHaveLength(EVIDENCE_MESSAGES)
    expect(evidence.messages[0]).toMatchObject({ from: aId, body: 'line 5' })
    expect(evidence.messages.at(-1)).toMatchObject({ from: bId, body: 'line 34' })

    // Not a member: no chat to report.
    const stranger = await resident('Chat Report Stranger')
    expect((await report(stranger, { kind: 'chat', targetId: bId })).status).toBe(404)
    expect((await report(stranger, { kind: 'chat', targetId: aId })).status).toBe(404)

    // Once it has ended, either side still can, from what was held.
    expect((await api(`/api/matches/${matchId}`, a, { method: 'DELETE' })).status).toBe(204)
    expect((await report(b, { kind: 'chat', targetId: aId })).status).toBe(201)
    const held = evidenceOf(await lastAbout(aId)) as { messages: unknown[] }
    expect(held.messages).toHaveLength(EVIDENCE_MESSAGES)
  })

  it('client-sent evidence is ignored', async () => {
    const reporter = await resident('Evidence Reporter')
    await resident('Evidence Target', {
      name: 'Evidence Target Kumar',
      status: 'shaam ko chai',
      about: 'Tells everyone about trains.',
      link: 'https://example.com/me',
    })
    const target = devId('Evidence Target')
    const res = await report(reporter, {
      kind: 'person',
      targetId: target,
      reason: 'other',
      note: '  roz pareshan karta hai  ',
      evidence: { lines: [{ from: target, text: 'made up' }] },
      messages: [{ from: target, body: 'made up' }],
    })
    expect(res.status).toBe(201)
    const row = await lastAbout(target)
    expect(row.note).toBe('roz pareshan karta hai')
    // The server's own snapshot, first name only and never the link.
    expect(evidenceOf(row)).toEqual({
      profile: {
        id: target,
        name: 'Evidence',
        look: { skin: 1, outfit: 'pink', head: 'none' },
        status: 'shaam ko chai',
        homeArea: 'Raja Park',
        about: 'Tells everyone about trains.',
      },
    })
    expect(row.evidence).not.toContain('made up')
    expect(row.evidence).not.toContain('example.com')

    // Bad input: an unknown kind or reason, a long note, yourself, someone with no profile.
    for (const body of [
      { kind: 'poster', targetId: target },
      { kind: 'person', targetId: target, reason: 'boring' },
      { kind: 'person', targetId: target, note: 'x'.repeat(301) },
      { kind: 'person', targetId: devId('Evidence Reporter') },
      { kind: 'person', targetId: 42 },
    ])
      expect((await report(reporter, body)).status, JSON.stringify(body).slice(0, 60)).toBe(400)
    expect((await report(reporter, { kind: 'person', targetId: 'dev:nobody-at-all' })).status).toBe(404)
  })

  it('3 distinct verified reporters auto-hide; 3 residents do not', async () => {
    const watcherToken = await resident('Hide Watcher')
    await resident('Hide Target')
    const target = devId('Hide Target')
    const hidden = async () =>
      (await testEnv.DB.prepare('SELECT hidden FROM users WHERE id = ?')
        .bind(target)
        .first<{ hidden: number }>())!.hidden
    const person = { kind: 'person', targetId: target }

    // Fresh, unverified accounts: queued, never counted.
    for (const name of ['Hide Fresh One', 'Hide Fresh Two', 'Hide Fresh Three']) {
      const res = await report(await resident(name, {}, { verified: false }), person)
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({ autoHidden: false })
    }
    // One verified reporter, three times, is one reporter.
    const v1 = await resident('Hide Verified One')
    for (let i = 0; i < 3; i++) expect(await (await report(v1, person)).json()).toEqual({ autoHidden: false })
    const v2 = await resident('Hide Verified Two')
    expect(await (await report(v2, { kind: 'person', targetId: target, reason: 'hate' })).json()).toEqual({
      autoHidden: false,
    })
    expect(await hidden()).toBe(0)
    expect((await api(`/api/profiles/${encodeURIComponent(target)}`, watcherToken)).status).toBe(200)

    const v3 = await resident('Hide Verified Three')
    const res = await report(v3, person)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ autoHidden: true })
    expect(await hidden()).toBe(1)
    expect((await api(`/api/profiles/${encodeURIComponent(target)}`, watcherToken)).status).toBe(404)
    expect(await rowsAbout(target)).toHaveLength(8)

    // Reports older than 7 days do not count.
    await resident('Hide Old Target')
    const old = devId('Hide Old Target')
    for (const t of [v1, v2]) await report(t, { kind: 'person', targetId: old })
    await testEnv.DB.prepare('UPDATE reports SET created_at = created_at - ? WHERE target_id = ?')
      .bind(8 * 24 * 3600 * 1000, old)
      .run()
    expect(await (await report(v3, { kind: 'person', targetId: old })).json()).toEqual({ autoHidden: false })
  })

  it('a reporter files at most 20 a day', async () => {
    const reporter = await resident('Limit Reporter')
    await resident('Limit Target')
    const body = { kind: 'person', targetId: devId('Limit Target'), reason: 'spam' }
    for (let i = 0; i < REPORTS_PER_DAY; i++) expect((await report(reporter, body)).status).toBe(201)
    const res = await report(reporter, body)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate' })
  })

  it('evidence purged after close or 30 days', async () => {
    const now = Date.now()
    const insert = (id: string, state: string, createdAt: number) =>
      testEnv.DB.prepare(
        `INSERT INTO reports (id, reporter, target_kind, target_id, reason, note, evidence, created_at, state, closed_at)
         VALUES (?, 'dev:purge-reporter', 'person', 'dev:purge-target', 'spam', '', '{"x":1}', ?, ?, ?)`,
      )
        .bind(id, createdAt, state, state === 'open' ? null : now)
        .run()
    await insert('purge-open-new', 'open', now - 60_000)
    await insert('purge-open-old', 'open', now - REPORT_KEEP_MS - 60_000)
    await insert('purge-actioned', 'actioned', now - 60_000)
    await insert('purge-dismissed', 'dismissed', now - 60_000)
    await purgeReportEvidence(testEnv, now)
    const { results } = await testEnv.DB.prepare(
      "SELECT id, evidence FROM reports WHERE id LIKE 'purge-%' ORDER BY id",
    ).all<{ id: string; evidence: string | null }>()
    expect(Object.fromEntries(results.map((r) => [r.id, r.evidence]))).toEqual({
      'purge-actioned': null,
      'purge-dismissed': null,
      'purge-open-new': '{"x":1}',
      'purge-open-old': null,
    })
    // The reports themselves stay: only what they carried goes.
    expect(results).toHaveLength(4)
  })

  it('evidence is kept under 64 KB by dropping the oldest lines', () => {
    const line = (i: number) => ({ from: 'x', name: 'X', text: 'क'.repeat(200), at: i })
    const lines = Array.from({ length: 200 }, (_, i) => line(i))
    const fitted = fitEvidence({ bench: 'b', lines }, 'lines')
    const size = new TextEncoder().encode(fitted).byteLength
    expect(size).toBeLessThanOrEqual(EVIDENCE_MAX_BYTES)
    const kept = (JSON.parse(fitted) as { lines: { at: number }[] }).lines
    expect(kept.length).toBeLessThan(200)
    expect(kept.at(-1)!.at).toBe(199)
    expect(fitEvidence({ bench: 'b', lines: lines.slice(0, 2) }, 'lines')).toBe(
      JSON.stringify({ bench: 'b', lines: lines.slice(0, 2) }),
    )
  })
})
