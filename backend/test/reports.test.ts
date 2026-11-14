import { applyD1Migrations, env, evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BENCH_POSITIONS, TRANSCRIPT_MS } from '../src/district'
import type { Env } from '../src/env'
import { EVIDENCE_MESSAGES } from '../src/evidence'
import type { BenchLine, DistrictId } from '../src/protocol'
import {
  EVIDENCE_MAX_BYTES,
  fileReport,
  fitEvidence,
  PURGE_STATEMENTS,
  purgeReportEvidence,
  REPORT_KEEP_MS,
  REPORTS_PER_DAY,
} from '../src/reports'
import { api, closeAll, devId, live, matchedWith, pair, resident, type LiveClient } from './helpers'

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
  unconfirmed: number
}
const rowsAbout = async (target: string) =>
  (
    await testEnv.DB.prepare('SELECT * FROM reports WHERE target_id = ? ORDER BY created_at, rowid')
      .bind(target)
      .all<Row>()
  ).results
const lastAbout = async (target: string) => (await rowsAbout(target)).at(-1)!
const evidenceOf = (row: Row) => JSON.parse(row.evidence!) as Record<string, unknown>

/** Lets the district vouch for the whole last 10 minutes, as one that has been awake that long does. */
const remembering = (district: DistrictId, since = Date.now()) =>
  runInDurableObject(stub(district), (i) => {
    i.bornAt = since - TRANSCRIPT_MS - 60_000
  })

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
    await remembering(district, start)
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

      // Never there: told so, and nothing is filed.
      const stranger = await resident('Bench Stranger Suraj')
      const away = await report(stranger, { kind: 'bench', targetId: lakhan, bench })
      expect(away.status).toBe(404)
      expect(await away.json()).toEqual({ error: 'not-there' })
      // There, but the person named never was (and the district remembers the whole 10 minutes).
      await resident('Bench Elsewhere Ela')
      const nobody = await report(rani, { kind: 'bench', targetId: devId('Bench Elsewhere Ela'), bench })
      expect(nobody.status).toBe(404)
      expect(await nobody.json()).toEqual({ error: 'not-found' })
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
      expect((await rowsAbout(lakhan)).map((r) => r.unconfirmed)).toEqual([0, 0])
    } finally {
      await runInDurableObject(uni, (i) => {
        i.clock = Date.now
      })
    }
    expect((await rowsAbout(lakhan)).length).toBe(2)
  })

  it('a district that slept: a seated reporter still files, honestly, and it never counts toward auto-hide', async () => {
    const district: DistrictId = 'malviya-nagar'
    const bench = `${district}:1`
    const gone = await sitter('Sleep Target Tara', district, 1)
    const target = devId('Sleep Target Tara')
    const seated = [
      await sitter('Sleep Reporter One', district, 1),
      await sitter('Sleep Reporter Two', district, 1),
      await sitter('Sleep Reporter Three', district, 1),
    ]
    gone.send({ t: 'say', text: 'kuch bura' })
    await seated[0]!.next('bench', (m) => m.text === 'kuch bura')
    // Tara gets up, and one sitter gets up too; then the district is evicted: its memory is gone, its seats are not.
    gone.send({ t: 'sit', bench: null })
    await gone.next('seated', (m) => m.bench === null)
    const left = await sitter('Sleep Left Lalit', district, 1)
    left.send({ t: 'sit', bench: null })
    await left.next('seated', (m) => m.bench === null)
    // The keep-awake timer would hold the object in memory (an eviction waits on it), so stop it first: as
    // after a deploy, or the runtime evicting it anyway.
    await runInDurableObject(stub(district), (i) => {
      const o = i as unknown as { awake: ReturnType<typeof setTimeout> | null }
      if (o.awake !== null) clearTimeout(o.awake)
      o.awake = null
    })
    await evictDurableObject(stub(district))

    // Someone who got up before it slept can no longer be vouched for: told they were not there.
    const lalit = await resident('Sleep Left Lalit')
    const away = await report(lalit, { kind: 'bench', targetId: target, bench })
    expect(await away.json()).toEqual({ error: 'not-there' })

    // Three verified sitters report Tara: each is filed on their word, says the record is missing, and
    // none of them counts toward auto-hide.
    for (const name of ['Sleep Reporter One', 'Sleep Reporter Two', 'Sleep Reporter Three']) {
      const res = await report(await resident(name), { kind: 'bench', targetId: target, bench })
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({ autoHidden: false, evidence: 'missing' })
    }
    const rows = await rowsAbout(target)
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.unconfirmed).toBe(1)
      expect(evidenceOf(row)).toEqual({ bench, lines: [], note: 'transcript-unavailable' })
    }
    const hidden = await testEnv.DB.prepare('SELECT hidden FROM users WHERE id = ?')
      .bind(target)
      .first<{ hidden: number }>()
    expect(hidden?.hidden).toBe(0)

    // Someone still seated after the wake is vouched for by their seat: a report about them counts.
    const two = await resident('Sleep Reporter Two')
    const res = await report(two, { kind: 'bench', targetId: devId('Sleep Reporter One'), bench })
    expect(await res.json()).toEqual({ autoHidden: false, evidence: 'missing' })
    expect((await lastAbout(devId('Sleep Reporter One'))).unconfirmed).toBe(0)
  })

  it('a district that cannot be reached: the report is filed without a transcript, never a 500', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await resident('Unreachable Reporter')
    await resident('Unreachable Target')
    const reporter = devId('Unreachable Reporter')
    const target = devId('Unreachable Target')
    const broken = {
      ...testEnv,
      DISTRICT: {
        idFromName: (name: string) => name,
        get: () => ({
          benchWitness: async () => {
            throw new Error('unreachable')
          },
        }),
      },
    } as unknown as Env
    const res = await fileReport(broken, reporter, {
      kind: 'bench',
      targetId: target,
      bench: 'walled-city:3',
      reason: 'hate',
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ autoHidden: false, evidence: 'missing' })
    const row = await lastAbout(target)
    expect(row.unconfirmed).toBe(1)
    expect(evidenceOf(row)).toEqual({ bench: 'walled-city:3', lines: [], note: 'transcript-unavailable' })
    expect(logged).toHaveBeenCalledWith(
      'report: bench district unreachable',
      'walled-city:3',
      expect.any(Error),
    )
    logged.mockRestore()
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

  it('auto-hide counts only chat and bench reports, from distinct verified reporters', async () => {
    const watcherToken = await resident('Hide Watcher')
    const targetToken = await resident('Hide Target')
    const target = devId('Hide Target')
    const hidden = async () =>
      (await testEnv.DB.prepare('SELECT hidden FROM users WHERE id = ?')
        .bind(target)
        .first<{ hidden: number }>())!.hidden
    const chat = { kind: 'chat', targetId: target }

    // Profile reports need no meeting at all, so a creep or a ring of accounts could file them about anyone:
    // queued, never counted, from however many verified reporters.
    for (const n of ['One', 'Two', 'Three']) {
      const res = await report(await resident(`Hide Profile ${n}`), { kind: 'person', targetId: target })
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({ autoHidden: false })
    }
    expect(await hidden()).toBe(0)
    // A fresh, unverified account that did chat with them (the target asked them): queued, never counted.
    const fresh = await resident('Hide Fresh', {}, { verified: false })
    const asked = await api('/api/requests', targetToken, {
      method: 'POST',
      body: JSON.stringify({ to: devId('Hide Fresh'), reason: 'Mujhe bhi pencil sketching pasand hai' }),
    })
    const { id: freshRequest } = (await asked.json()) as { id: string }
    expect((await api(`/api/requests/${freshRequest}/accept`, fresh, { method: 'POST' })).status).toBe(200)
    expect(await (await report(fresh, chat)).json()).toEqual({ autoHidden: false })

    // Two verified people they chatted with...
    const chatters: string[] = []
    for (const n of ['One', 'Two']) {
      chatters.push(await matchedWith(`Hide Chat ${n}`, targetToken, target))
      expect(await (await report(chatters.at(-1)!, chat)).json()).toEqual({ autoHidden: false })
    }
    expect(await hidden()).toBe(0)
    expect((await api(`/api/profiles/${encodeURIComponent(target)}`, watcherToken)).status).toBe(200)

    // ...and one who sat at a bench with them: three confirmed meetings hide them.
    const district: DistrictId = 'mi-road'
    await sitter('Hide Target', district, 2)
    await sitter('Hide Bench Three', district, 2)
    await remembering(district)
    const res = await report(await resident('Hide Bench Three'), {
      kind: 'bench',
      targetId: target,
      bench: `${district}:2`,
    })
    expect(res.status).toBe(201)
    // (Nothing was said there, so it carries no lines; the district still saw them both sit.)
    expect(await res.json()).toEqual({ autoHidden: true, evidence: 'missing' })
    expect(await hidden()).toBe(1)
    expect((await api(`/api/profiles/${encodeURIComponent(target)}`, watcherToken)).status).toBe(404)
    expect(await rowsAbout(target)).toHaveLength(7)
    // Only the report that hid them says so.
    expect(await (await report(chatters[0]!, { ...chat, reason: 'hate' })).json()).toEqual({
      autoHidden: false,
    })
    expect(await hidden()).toBe(1)
  })

  it('reports older than 7 days do not count', async () => {
    const oldToken = await resident('Hide Old Target')
    const old = devId('Hide Old Target')
    const tokens = await Promise.all(
      ['One', 'Two', 'Three'].map((n) => matchedWith(`Hide Old ${n}`, oldToken, old)),
    )
    for (const t of tokens.slice(0, 2)) await report(t, { kind: 'chat', targetId: old })
    await testEnv.DB.prepare('UPDATE reports SET created_at = created_at - ? WHERE target_id = ?')
      .bind(8 * 24 * 3600 * 1000, old)
      .run()
    expect(await (await report(tokens[2]!, { kind: 'chat', targetId: old })).json()).toEqual({
      autoHidden: false,
    })
  })

  it('a report from someone the target blocked never counts toward hiding them', async () => {
    const targetToken = await resident('Blocker Target')
    const target = devId('Blocker Target')
    const tokens: string[] = []
    for (const n of ['One', 'Two', 'Three', 'Four'])
      tokens.push(await matchedWith(`Blocked Reporter ${n}`, targetToken, target))
    // The target blocked reporter Three (which ends their chat; it is held, so it can still be reported).
    expect(
      (
        await api('/api/blocks', targetToken, {
          method: 'POST',
          body: JSON.stringify({ id: devId('Blocked Reporter Three') }),
        })
      ).status,
    ).toBe(204)
    for (const t of tokens.slice(0, 3)) {
      const res = await report(t, { kind: 'chat', targetId: target })
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({ autoHidden: false })
    }
    // Filed and queued all the same: the moderator still sees it.
    expect((await rowsAbout(target)).map((r) => r.state)).toEqual(['open', 'open', 'open'])
    // A third reporter they never blocked: that one hides them.
    expect(await (await report(tokens[3]!, { kind: 'chat', targetId: target })).json()).toEqual({
      autoHidden: true,
    })
  })

  it('one open report per reporter, person and kind: a repeat updates the note and adds no row', async () => {
    const reporter = await resident('Repeat Reporter')
    await resident('Repeat Target')
    const target = devId('Repeat Target')
    const person = { kind: 'person', targetId: target }
    expect((await report(reporter, { ...person, note: 'pehli baar' })).status).toBe(201)
    for (const note of ['doosri baar', '']) {
      const again = await report(reporter, { ...person, note })
      expect(again.status).toBe(201)
      expect(await again.json()).toEqual({ autoHidden: false })
    }
    // One row; the note is the latest one written (an empty repeat keeps it).
    expect((await rowsAbout(target)).map((r) => [r.target_kind, r.note])).toEqual([['person', 'doosri baar']])
    // Another kind about them is its own report; so is one from someone else.
    const { a } = await pair('Repeat Chat Asha', 'Repeat Chat Bilal')
    expect((await report(a, { kind: 'chat', targetId: devId('Repeat Chat Bilal') })).status).toBe(201)
    expect((await report(a, { kind: 'person', targetId: devId('Repeat Chat Bilal') })).status).toBe(201)
    expect(await rowsAbout(devId('Repeat Chat Bilal'))).toHaveLength(2)
    // Once it is closed, a new report is a new row.
    await testEnv.DB.prepare("UPDATE reports SET state = 'dismissed' WHERE target_id = ?").bind(target).run()
    expect((await report(reporter, person)).status).toBe(201)
    expect((await rowsAbout(target)).map((r) => r.state)).toEqual(['dismissed', 'open'])
  })

  it('a reporter files at most 20 a day', async () => {
    const reporter = await resident('Limit Reporter')
    await resident('Limit Target')
    const body = { kind: 'person', targetId: devId('Limit Target'), reason: 'spam' }
    // Reports that could not be filed use none of the day's allowance.
    for (let i = 0; i < 5; i++)
      expect((await report(reporter, { ...body, targetId: 'dev:limit-nobody' })).status).toBe(404)
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

  it('the purge finds its rows by index, never by scanning every report', async () => {
    const indexes = ['reports_closed_evidence', 'reports_evidence_age']
    expect(PURGE_STATEMENTS).toHaveLength(2)
    for (const [i, sql] of PURGE_STATEMENTS.entries()) {
      const { results } = await testEnv.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...(sql.includes('?') ? [0] : []))
        .all<{ detail: string }>()
      const plan = results.map((r) => r.detail).join(' | ')
      expect(plan, sql).toMatch(new RegExp(`SEARCH reports USING (COVERING )?INDEX ${indexes[i]}`))
      expect(plan, sql).not.toMatch(/SCAN/)
    }
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
