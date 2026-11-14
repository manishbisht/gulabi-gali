import { applyD1Migrations, env, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { csvCell, toCsv } from '../src/admin'
import type { Env } from '../src/env'
import {
  LIVE_CLOSE,
  type AdminHidden,
  type AdminReportPage,
  type AdminStats,
  type AdminUser,
} from '../src/protocol'
import { api, closeAll, devId, inbox, live, login, matchedWith, openInbox, pair, resident } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const API = 'https://api.test'

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})
afterEach(() => closeAll())

/** The owner: `dev:owner` is the one id in the test env's `ADMIN_USER_IDS`. */
const owner = () => login('Owner')
const asOwner = async (path: string, init: RequestInit = {}) => api(path, await owner(), init)
const post = (path: string) => asOwner(path, { method: 'POST' })
const userAction = (id: string, action: string) =>
  post(`/api/admin/users/${encodeURIComponent(id)}/${action}`)

const sql = (q: string, ...args: unknown[]) =>
  testEnv.DB.prepare(q)
    .bind(...args)
    .run()
const userRow = (id: string) =>
  testEnv.DB.prepare('SELECT banned, hidden, muted_until, verified, verified_by FROM users WHERE id = ?')
    .bind(id)
    .first<{
      banned: number
      hidden: number
      muted_until: number | null
      verified: number
      verified_by: string | null
    }>()

/** A report row written straight to D1, for queue shapes the API would take many residents to make. */
const insertReport = (
  id: string,
  reporter: string,
  target: string,
  createdAt: number,
  extra: { kind?: string; evidence?: string | null; state?: string; unconfirmed?: number } = {},
) =>
  sql(
    `INSERT INTO reports (id, reporter, target_kind, target_id, reason, note, evidence, created_at, state, unconfirmed)
     VALUES (?, ?, ?, ?, 'harassment', 'note', ?, ?, ?, ?)`,
    id,
    reporter,
    extra.kind ?? 'person',
    target,
    extra.evidence === undefined ? null : extra.evidence,
    createdAt,
    extra.state ?? 'open',
    extra.unconfirmed ?? 0,
  )

/** What each write path answers a banned person. */
const BANNED_WRITE: Record<string, unknown> = {
  'send a request': { error: 'ghost' },
  'accept a request': { error: 'not-found' },
  chat: { error: 'not-found' },
  report: { error: 'ghost' },
  'redeem an invite': { error: 'ghost' },
}

/** Every report in a state's list, page by page. */
async function everyReport(state = 'open') {
  const out: AdminReportPage['reports'] = []
  let cursor = ''
  do {
    const res = await asOwner(`/api/admin/reports?state=${state}&cursor=${encodeURIComponent(cursor)}`)
    expect(res.status).toBe(200)
    const page = (await res.json()) as AdminReportPage
    out.push(...page.reports)
    cursor = page.next ?? ''
  } while (cursor)
  return out
}

/** Every admin route, with a method each answers to for an admin. */
const ROUTES: [string, string][] = [
  ['GET', '/api/admin/reports?state=open'],
  ['GET', '/api/admin/reports?state=open&cursor=abc'],
  ['POST', '/api/admin/reports/some-id/dismiss'],
  ['POST', '/api/admin/reports/some-id/action'],
  ...['ban', 'unban', 'mute', 'unmute', 'verify', 'unhide'].map((a): [string, string] => [
    'POST',
    `/api/admin/users/dev%3Asomeone/${a}`,
  ]),
  ['DELETE', '/api/admin/posters/p1'],
  ['GET', '/api/admin/users?q=a'],
  ['GET', '/api/admin/hidden'],
  ['GET', '/api/admin/stats'],
  ['GET', '/api/admin/waitlist.csv'],
  ['GET', '/api/admin/nothing-here'],
]

describe('admin', () => {
  it('non-admins get 404 on every admin route', async () => {
    const someone = await resident('Not An Admin')
    // Verified, even: being trusted is not being the owner.
    const notFound = { error: 'not found' }
    const callers: [string, Record<string, string>][] = [
      ['a resident', { Authorization: `Bearer ${someone}` }],
      ['no token', {}],
      ['a garbage token', { Authorization: 'Bearer dev.owner.0000' }],
    ]
    for (const [method, path] of ROUTES) {
      for (const [who, headers] of callers) {
        // A body that would be a 400 anywhere it was read: the admin check comes before any parsing.
        const res = await SELF.fetch(`${API}${path}`, {
          method,
          headers: { ...headers, 'content-type': 'application/json' },
          ...(method === 'GET' ? {} : { body: '{not json' }),
        })
        expect(res.status, `${who}: ${method} ${path}`).toBe(404)
        expect(await res.json(), `${who}: ${method} ${path}`).toEqual(notFound)
      }
    }
    // An unknown admin route looks like any other unknown route, for the owner too; and posters are a stub.
    for (const path of ['/api/admin/nothing-here', '/api/admin/posters/p1']) {
      const res = await asOwner(path, path.includes('posters') ? { method: 'DELETE' } : {})
      expect(res.status, path).toBe(404)
    }
    // While the owner gets real answers.
    expect((await asOwner('/api/admin/stats')).status).toBe(200)
    expect((await asOwner('/api/admin/reports?state=open')).status).toBe(200)
  })

  it('an empty or unset ADMIN_USER_IDS makes nobody an admin', async () => {
    const { handleAdmin } = await import('../src/admin')
    const req = new Request(`${API}/api/admin/stats`)
    for (const ADMIN_USER_IDS of [undefined, '', ' , ']) {
      const res = await handleAdmin(req, { ...testEnv, ADMIN_USER_IDS }, new URL(req.url), {
        id: 'dev:owner',
      })
      expect(res.status, String(ADMIN_USER_IDS)).toBe(404)
    }
    // Ids are compared whole: a prefix is not a match, and spaces around the commas are fine.
    const list = { ...testEnv, ADMIN_USER_IDS: 'clerk:user_abc , dev:owner' }
    expect((await handleAdmin(req, list, new URL(req.url), { id: 'dev:owner' })).status).toBe(200)
    expect((await handleAdmin(req, list, new URL(req.url), { id: 'clerk:user_ab' })).status).toBe(404)
  })

  it('a dev id is an admin only while dev auth is on', async () => {
    const { handleAdmin, isAdmin } = await import('../src/admin')
    const req = new Request(`${API}/api/admin/stats`)
    const ADMIN_USER_IDS = 'dev:owner,clerk:user_real'
    // Production (no DEV_AUTH, or anything but exactly '1'): the dev id copied in by mistake is nobody.
    for (const DEV_AUTH of [undefined, '', '0', 'true']) {
      const prod = { ...testEnv, ADMIN_USER_IDS, DEV_AUTH }
      expect(isAdmin(prod, 'dev:owner'), String(DEV_AUTH)).toBe(false)
      expect((await handleAdmin(req, prod, new URL(req.url), { id: 'dev:owner' })).status).toBe(404)
      // The real id beside it still works.
      expect((await handleAdmin(req, prod, new URL(req.url), { id: 'clerk:user_real' })).status).toBe(200)
    }
    expect(isAdmin({ ADMIN_USER_IDS, DEV_AUTH: '1' }, 'dev:owner')).toBe(true)
  })

  it('ban is idempotent and closes live sockets', async () => {
    const { a: token, aId: id, matchId } = await pair('Ban Target', 'Ban Partner')
    // Things a banned person might still try to use: a request waiting for them, and an unused invite code.
    const asker = await resident('Ban Asker')
    const asked = await api('/api/requests', asker, {
      method: 'POST',
      body: JSON.stringify({ to: id, reason: 'Chalo kabhi chai pe milte hain' }),
    })
    expect(asked.status).toBe(201)
    const { id: pendingId } = (await asked.json()) as { id: string }
    const founder = await SELF.fetch(`${API}/api/dev/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'dev:ban-founder' }),
    })
    const [code] = ((await founder.json()) as { codes: string[] }).codes
    const street = await live('mi-road', { token })
    street.send({ t: 'move', x: 1, z: 0, ry: 0 })
    await street.sync()
    const box = await inbox(token)

    const first = await userAction(id, 'ban')
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ id, banned: true })
    // The response comes after the live objects were told: both sockets are closing with `banned`.
    await expect.poll(() => street.closes).toEqual([LIVE_CLOSE.banned])
    await expect.poll(() => box.closes).toEqual([LIVE_CLOSE.banned])

    // A double tap on a slow network: the same 200, the same state.
    const again = await userAction(id, 'ban')
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({ id, banned: true })
    expect((await userRow(id))!.banned).toBe(1)

    // Signed in, they are told they are banned and can do nothing as themself.
    const me = await api('/api/me', token)
    expect(me.status).toBe(403)
    expect(await me.json()).toEqual({ error: 'banned' })
    const save = await api('/api/me/profile', token, { method: 'PUT', body: JSON.stringify({ name: 'X' }) })
    expect(save.status).toBe(403)
    expect((await api(`/api/profiles/${encodeURIComponent(id)}`, await resident('Ban Viewer'))).status).toBe(
      404,
    )

    // Every write path refuses them: they are no longer a resident, whatever they hold.
    const writes: [string, () => Promise<Response>][] = [
      [
        'send a request',
        () =>
          api('/api/requests', token, {
            method: 'POST',
            body: JSON.stringify({ to: devId('Ban Asker'), reason: 'Chalo kabhi chai pe milte hain' }),
          }),
      ],
      ['accept a request', () => api(`/api/requests/${pendingId}/accept`, token, { method: 'POST' })],
      [
        'chat',
        () =>
          api(`/api/matches/${matchId}/messages`, token, {
            method: 'POST',
            body: JSON.stringify({ body: 'still here?' }),
          }),
      ],
      [
        'report',
        () =>
          api('/api/reports', token, {
            method: 'POST',
            body: JSON.stringify({ kind: 'person', targetId: devId('Ban Partner'), reason: 'spam' }),
          }),
      ],
      [
        'redeem an invite',
        () => api('/api/invites/redeem', token, { method: 'POST', body: JSON.stringify({ code }) }),
      ],
    ]
    for (const [what, write] of writes) {
      const res = await write()
      expect([403, 404], what).toContain(res.status)
      expect(await res.json(), what).toEqual(BANNED_WRITE[what])
    }
    const pending = await testEnv.DB.prepare('SELECT state FROM requests WHERE id = ?')
      .bind(pendingId)
      .first<{ state: string }>()
    expect(pending!.state).toBe('pending')
    expect(await testEnv.DB.prepare('SELECT used_by FROM invites WHERE code = ?').bind(code).first()).toEqual(
      { used_by: null },
    )
    // No inbox, and on the street only a ghost: seen by nobody, sitting and speaking refused.
    expect((await openInbox({ token })).status).toBe(403)
    const street2 = await live('walled-city', { token })
    expect((await street2.next('welcome')).you.visible).toBe(false)
    const from = street2.mark()
    street2.send({ t: 'sit', bench: 'walled-city:0' })
    street2.send({ t: 'say', text: 'hello?' })
    await street2.sync()
    expect(street2.all('error', from)).toEqual([
      { t: 'error', code: 'ghost' },
      { t: 'error', code: 'ghost' },
    ])
    street2.close()

    // Unban restores, and is idempotent too.
    for (let i = 0; i < 2; i++) {
      const res = await userAction(id, 'unban')
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ id, banned: false })
    }
    expect((await api('/api/me', token)).status).toBe(200)
    // Someone who does not exist is a 404, not a new row.
    expect((await userAction('dev:no-such-person', 'ban')).status).toBe(404)
    expect(await userRow('dev:no-such-person')).toBeNull()
  })

  it('mute blocks writes for 24h', async () => {
    const { a, b, aId, matchId } = await pair('Mute Asha', 'Mute Ravi')
    await resident('Mute Other')
    const before = Date.now()
    const res = await userAction(aId, 'mute')
    expect(res.status).toBe(200)
    const muted = (await res.json()) as AdminUser
    expect(muted.mutedUntil).toBeGreaterThanOrEqual(before + 24 * 3600_000)
    expect(muted.mutedUntil).toBeLessThanOrEqual(Date.now() + 24 * 3600_000)
    // A second tap keeps the same end: it does not start the 24 hours again.
    expect(((await (await userAction(aId, 'mute')).json()) as AdminUser).mutedUntil).toBe(muted.mutedUntil)

    const writes = [
      () =>
        api('/api/requests', a, {
          method: 'POST',
          body: JSON.stringify({ to: devId('Mute Other'), reason: 'Mujhe bhi chai pasand hai yaar' }),
        }),
      () =>
        api(`/api/matches/${matchId}/messages`, a, {
          method: 'POST',
          body: JSON.stringify({ body: 'hello' }),
        }),
      () =>
        api('/api/me/profile', a, {
          method: 'PUT',
          body: JSON.stringify({
            name: 'Mute Asha',
            look: { skin: 1, outfit: 'pink', head: 'none' },
            status: 'naya status',
            homeArea: 'Raja Park',
            adult: true,
            pledge: true,
          }),
        }),
    ]
    for (const write of writes) {
      const r = await write()
      expect(r.status).toBe(403)
      expect(await r.json()).toEqual({ error: 'muted', until: muted.mutedUntil })
    }
    // The bench says so too.
    const street = await live('mi-road', { token: a })
    street.send({ t: 'status', text: 'still here' })
    await street.next('error', (m) => m.code === 'muted')
    // Reading, reporting and blocking stay open: a muted person can still keep themself safe.
    expect((await api('/api/requests', a)).status).toBe(200)
    expect(
      (
        await api('/api/reports', a, {
          method: 'POST',
          body: JSON.stringify({ kind: 'person', targetId: devId('Mute Other'), reason: 'spam' }),
        })
      ).status,
    ).toBe(201)
    // The other side of the chat is not muted.
    const reply = await api(`/api/matches/${matchId}/messages`, b, {
      method: 'POST',
      body: JSON.stringify({ body: 'hi' }),
    })
    expect(reply.status).toBe(201)

    // 24 hours on, it has run out by itself.
    await sql('UPDATE users SET muted_until = ? WHERE id = ?', Date.now() - 1, aId)
    expect((await writes[0]!()).status).toBe(201)

    // And unmute lifts it at once.
    await userAction(aId, 'mute')
    const lifted = await userAction(aId, 'unmute')
    expect(await lifted.json()).toMatchObject({ mutedUntil: null })
    const msg = await api(`/api/matches/${matchId}/messages`, a, {
      method: 'POST',
      body: JSON.stringify({ body: 'back' }),
    })
    expect(msg.status).toBe(201)
  })

  it('queue paginates', async () => {
    await resident('Queue Target')
    const target = devId('Queue Target')
    const base = Date.now() - 3600_000
    // Two at the same instant, so the cursor has to break the tie by id.
    const ids = Array.from({ length: 25 }, (_, i) => `queue-${String(i).padStart(2, '0')}`)
    for (const [i, id] of ids.entries())
      await insertReport(id, 'dev:queue-reporter', target, base + Math.min(i, 23) * 1000)
    await insertReport('queue-closed', 'dev:queue-reporter', target, base, { state: 'dismissed' })

    const seen: string[] = []
    let cursor = ''
    let pages = 0
    for (;;) {
      const res = await asOwner(`/api/admin/reports?state=open&cursor=${encodeURIComponent(cursor)}`)
      expect(res.status).toBe(200)
      const page = (await res.json()) as AdminReportPage
      expect(page.reports.length).toBeLessThanOrEqual(20)
      pages++
      seen.push(...page.reports.map((r) => r.id))
      if (!page.next) break
      expect(page.reports).toHaveLength(20)
      cursor = page.next
    }
    expect(pages).toBeGreaterThanOrEqual(2)
    // Every open one once, oldest first, and no closed one.
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.filter((id) => id.startsWith('queue-'))).toEqual(ids)
    // Closed reports have their own list.
    expect((await everyReport('dismissed')).map((r) => r.id)).toContain('queue-closed')
    // A cursor that is not one of ours, or a state that is not one, is a 400.
    expect((await asOwner('/api/admin/reports?state=open&cursor=%%%')).status).toBe(400)
    expect((await asOwner('/api/admin/reports?state=whatever')).status).toBe(400)
  })

  it('a report carries its people, the target as they are now, and its evidence as text', async () => {
    const { a, aId, bId, matchId } = await pair('Card Asha Rani', 'Card Ravi Kumar')
    const sent = await api(`/api/matches/${matchId}/messages`, a, {
      method: 'POST',
      body: JSON.stringify({ body: 'namaste <img src=x onerror=alert(1)>' }),
    })
    expect(sent.status).toBe(201)
    await api('/api/reports', a, {
      method: 'POST',
      body: JSON.stringify({ kind: 'chat', targetId: bId, reason: 'hate', note: 'see chat' }),
    })
    await insertReport('card-bench', 'dev:card-bench-reporter', bId, Date.now() - 50_000, {
      kind: 'bench',
      unconfirmed: 1,
      evidence: JSON.stringify({ bench: 'mi-road:0', lines: [], note: 'transcript-unavailable' }),
    })
    await insertReport('card-purged', aId, bId, Date.now() - 40_000, { evidence: null })

    const mine = (await everyReport()).filter((r) => r.target.id === bId)
    const chat = mine.find((r) => r.kind === 'chat')!
    expect(chat).toMatchObject({
      reason: 'hate',
      note: 'see chat',
      state: 'open',
      unconfirmed: false,
      reporter: { id: aId, verified: true, banned: false },
      target: { id: bId, profile: { name: 'Card Ravi Kumar', homeArea: 'Raja Park' }, openReports: 3 },
    })
    expect(chat.reporter.createdAt).toEqual(expect.any(Number))
    // Chat lines carry the sender's first name and the time; the text is exactly what was sent.
    expect(chat.evidence).toEqual({
      kind: 'lines',
      place: 'chat',
      missing: false,
      lines: [
        { from: aId, name: 'Card', text: 'namaste <img src=x onerror=alert(1)>', at: expect.any(Number) },
      ],
    })
    expect(mine.find((r) => r.id === 'card-bench')).toMatchObject({
      kind: 'bench',
      unconfirmed: true,
      evidence: { kind: 'lines', place: 'bench', lines: [], missing: true },
      // A reporter with no account row (deleted) still shows, with nothing known.
      reporter: { id: 'dev:card-bench-reporter', createdAt: null, profile: null },
    })
    expect(mine.find((r) => r.id === 'card-purged')!.evidence).toBeNull()
  })

  it('closing a report is idempotent and keeps its first outcome', async () => {
    await insertReport('close-me', 'dev:close-reporter', 'dev:close-target', Date.now())
    const first = await post('/api/admin/reports/close-me/action')
    expect(first.status).toBe(200)
    const closed = (await first.json()) as { id: string; state: string; closedAt: number }
    expect(closed).toMatchObject({ id: 'close-me', state: 'actioned', closedAt: expect.any(Number) })
    // Tapped twice, or the other button after: 200 and the state it already has.
    for (const action of ['action', 'dismiss']) {
      const res = await post(`/api/admin/reports/close-me/${action}`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(closed)
    }
    // Off the open queue; the cron then clears what it carried.
    expect((await everyReport()).map((r) => r.id)).not.toContain('close-me')
    expect((await everyReport('actioned')).map((r) => r.id)).toContain('close-me')
    expect((await post('/api/admin/reports/no-such-report/dismiss')).status).toBe(404)
  })

  it('verify gives two codes and says the admin did it; unhide brings someone back', async () => {
    const token = await resident('Verify Me', {}, { verified: false })
    const id = devId('Verify Me')
    for (let i = 0; i < 2; i++) {
      const res = await userAction(id, 'verify')
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ verified: true, verifiedBy: 'admin' })
    }
    expect(await userRow(id)).toMatchObject({ verified: 1, verified_by: 'admin' })
    const { codes } = (await (await api('/api/invites', token)).json()) as { codes: unknown[] }
    expect(codes).toHaveLength(2)

    await sql('UPDATE users SET hidden = 1 WHERE id = ?', id)
    const viewer = await resident('Unhide Viewer')
    expect((await api(`/api/profiles/${encodeURIComponent(id)}`, viewer)).status).toBe(404)
    for (let i = 0; i < 2; i++)
      expect(await (await userAction(id, 'unhide')).json()).toMatchObject({ hidden: false })
    expect((await api(`/api/profiles/${encodeURIComponent(id)}`, viewer)).status).toBe(200)
  })

  it('unhide keeps every report open with its evidence, and only reports filed after it count again', async () => {
    const viewer = await resident('Sticky Viewer')
    const targetToken = await resident('Sticky Target')
    const target = devId('Sticky Target')
    const report = (token: string) =>
      api('/api/reports', token, {
        method: 'POST',
        body: JSON.stringify({ kind: 'chat', targetId: target, reason: 'spam' }),
      })
    const visible = async () => (await api(`/api/profiles/${encodeURIComponent(target)}`, viewer)).status
    // Six people who chatted with them (matched before any hide: a hide stops new matches).
    const ring = new Map<string, string>()
    for (const n of ['One', 'Two', 'Three', 'Four', 'Five', 'Six'])
      ring.set(n, await matchedWith(`Sticky Ring ${n}`, targetToken, target))
    // Three verified chat reports hide them.
    for (const n of ['One', 'Two', 'Three']) expect((await report(ring.get(n)!)).status).toBe(201)
    expect(await visible()).toBe(404)

    const res = await userAction(target, 'unhide')
    expect(await res.json()).toMatchObject({ hidden: false, openReports: 3 })
    expect(await visible()).toBe(200)
    const states = async () =>
      (
        await testEnv.DB.prepare(
          'SELECT reporter, state, evidence IS NOT NULL AS kept FROM reports WHERE target_id = ? ORDER BY reporter',
        )
          .bind(target)
          .all<{ reporter: string; state: string; kept: number }>()
      ).results
    // Every report that hid them is still open, evidence and all: unhiding is not a verdict on them.
    expect(await states()).toEqual(
      ['One', 'Three', 'Two'].map((n) => ({ reporter: devId(`Sticky Ring ${n}`), state: 'open', kept: 1 })),
    )
    // One new counted report: still visible, since only reports filed after the unhide count.
    expect(await (await report(ring.get('Four')!)).json()).toEqual({ autoHidden: false })
    expect(await visible()).toBe(200)
    // A repeat unhide while visible changes nothing.
    await userAction(target, 'unhide')
    expect((await states()).filter((r) => r.state === 'open')).toHaveLength(4)
    // Three counted reports after the unhide hide them again.
    for (const n of ['Five', 'Six']) await report(ring.get(n)!)
    expect(await visible()).toBe(404)
  })

  it('the auto-hidden list shows who was hidden, by whom, and how new their accounts are', async () => {
    await resident('Hidden Target')
    const target = devId('Hidden Target')
    await resident('Ring One')
    await sql("UPDATE users SET verified_by = 'dev:ring-boss' WHERE id = ?", devId('Ring One'))
    await insertReport('hidden-r1', devId('Ring One'), target, Date.now() - 1000)
    await insertReport('hidden-r2', 'dev:ring-gone', target, Date.now() - 500, { kind: 'bench' })
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', target)

    const list = (await (await asOwner('/api/admin/hidden')).json()) as AdminHidden[]
    const entry = list.find((h) => h.user.id === target)!
    expect(entry.user).toMatchObject({ hidden: true, profile: { name: 'Hidden Target' } })
    expect(entry.reports.map((r) => r.id)).toEqual(['hidden-r2', 'hidden-r1'])
    expect(entry.reports[1]!.reporter).toMatchObject({
      id: devId('Ring One'),
      verified: true,
      verifiedBy: 'dev:ring-boss',
      createdAt: expect.any(Number),
    })
    // The list carries no evidence: that stays inside the report card.
    expect(JSON.stringify(list)).not.toContain('evidence')
    await userAction(target, 'unhide')
    const after = (await (await asOwner('/api/admin/hidden')).json()) as AdminHidden[]
    expect(after.map((h) => h.user.id)).not.toContain(target)
  })

  it('stats count live people per district, the open queue and the hidden', async () => {
    const res = await asOwner('/api/admin/stats')
    expect(res.status).toBe(200)
    const before = (await res.json()) as AdminStats
    const at = (s: AdminStats) => s.districts.find((d) => d.id === 'university')!
    const resident1 = await live('university', { token: await resident('Stats Resident') })
    resident1.send({ t: 'move', x: 1, z: 0, ry: 0 })
    await resident1.sync()
    const ghost = await live('university')
    await ghost.sync()
    await insertReport('stats-open', 'dev:stats-reporter', 'dev:stats-target', Date.now())
    const after = (await (await asOwner('/api/admin/stats')).json()) as AdminStats
    expect(after.districts.map((d) => d.id)).toEqual([
      'walled-city',
      'mi-road',
      'university',
      'malviya-nagar',
    ])
    expect(at(after).residents).toBe(at(before).residents! + 1)
    expect(at(after).ghosts).toBe(at(before).ghosts! + 1)
    expect(after.openReports).toBe(before.openReports + 1)
    expect(after).toHaveProperty('hidden', expect.any(Number))
    expect(after).toHaveProperty('queue')
  })

  it('looks people up by name prefix or id', async () => {
    await resident('Lookup Lalita')
    await resident('Lookup Lokesh')
    await resident('Elsewhere Lookup')
    const names = async (q: string) =>
      ((await (await asOwner(`/api/admin/users?q=${encodeURIComponent(q)}`)).json()) as AdminUser[]).map(
        (u) => u.profile?.name,
      )
    expect((await names('lookup l')).sort()).toEqual(['Lookup Lalita', 'Lookup Lokesh'])
    expect(await names(devId('Elsewhere Lookup'))).toEqual(['Elsewhere Lookup'])
    // LIKE's wildcards are only letters here.
    expect(await names('%')).toEqual([])
    expect(await names('')).toEqual([])
  })

  it('waitlist CSV escapes commas and quotes', async () => {
    const rows: [string, number][] = [
      ['plain@example.com', Date.UTC(2026, 10, 1)],
      ['comma,in@example.com', Date.UTC(2026, 10, 2)],
      ['say "hi"@example.com', Date.UTC(2026, 10, 3)],
      ['=HYPERLINK("http://x")@example.com', Date.UTC(2026, 10, 4)],
    ]
    for (const [email, at] of rows)
      await sql('INSERT INTO waitlist (email, created_at) VALUES (?, ?)', email, at)
    const res = await asOwner('/api/admin/waitlist.csv')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="waitlist.csv"')
    expect((await res.text()).split('\r\n')).toEqual([
      'email,joined',
      'plain@example.com,2026-11-01T00:00:00.000Z',
      '"comma,in@example.com",2026-11-02T00:00:00.000Z',
      '"say ""hi""@example.com",2026-11-03T00:00:00.000Z',
      `"'=HYPERLINK(""http://x"")@example.com",2026-11-04T00:00:00.000Z`,
      '',
    ])
  })

  it('a CSV cell is quoted when it must be, and never starts a formula', () => {
    expect(csvCell('a')).toBe('a')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(csvCell('a\rb')).toBe('"a\rb"')
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) expect(csvCell(`${lead}1`)).toMatch(/^"?'/)
    expect(csvCell('-1+1')).toBe("'-1+1")
    expect(
      toCsv([
        ['h1', 'h2'],
        ['x', 'y,z'],
      ]),
    ).toBe('h1,h2\r\nx,"y,z"\r\n')
  })
})
