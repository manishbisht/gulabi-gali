// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthContext, SIGNED_OUT, type AuthState } from '../auth/useAuth'
import type {
  AdminErrorGroup,
  AdminHidden,
  AdminReport,
  AdminReportPage,
  AdminStats,
  AdminUser,
} from '../net/protocol'
import { storage } from '../storage'
import AdminPage from './AdminPage'
import { STATS_MS, when } from './adminApi'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const DAY = 86_400_000

const person = (id: string, name: string | null, over: Partial<AdminUser> = {}): AdminUser => ({
  id,
  createdAt: Date.now() - 3 * DAY,
  verified: true,
  verifiedBy: 'admin',
  banned: false,
  hidden: false,
  mutedUntil: null,
  openReports: 1,
  profile: name ? { name, status: 'chai', homeArea: 'Raja Park', about: 'hi' } : null,
  ...over,
})

const AT = Date.UTC(2026, 10, 14, 9, 30)
const chatReport: AdminReport = {
  id: 'r-chat',
  kind: 'chat',
  reason: 'hate',
  note: 'see <b>this</b>',
  createdAt: AT,
  state: 'open',
  closedAt: null,
  unconfirmed: true,
  reporter: person('dev:asha', 'Asha Rani'),
  target: person('dev:ravi', 'Ravi Kumar'),
  evidence: {
    kind: 'lines',
    place: 'chat',
    missing: false,
    lines: [{ from: 'dev:ravi', name: 'Ravi', text: '<img src=x onerror="alert(1)">', at: AT }],
  },
}
const stats: AdminStats = {
  districts: [
    { id: 'walled-city', residents: 3, ghosts: 5 },
    { id: 'mi-road', residents: null, ghosts: null },
    { id: 'university', residents: 0, ghosts: 0 },
    { id: 'malviya-nagar', residents: 1, ghosts: 2 },
  ],
  live: 4,
  queue: 2,
  openReports: 1,
  hidden: 1,
}

interface Call {
  method: string
  path: string
}

/** A fake Worker: `routes` answers by "METHOD path" (path with its query); everything else is a 404. */
function stubApi(routes: Record<string, () => Response>) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url)
      const call = { method: init?.method ?? 'GET', path: u.pathname + u.search }
      calls.push(call)
      const route = routes[`${call.method} ${call.path}`] ?? routes[`${call.method} ${u.pathname}`]
      return route ? route() : json({ error: 'not found' }, 404)
    }),
  )
  return calls
}

const ADMIN_ROUTES = (over: Record<string, () => Response> = {}) => ({
  'GET /api/admin/stats': () => json(stats),
  'GET /api/admin/hidden': () => json([] satisfies AdminHidden[]),
  'GET /api/admin/errors': () => json([] satisfies AdminErrorGroup[]),
  'GET /api/admin/reports': () => json({ reports: [chatReport], next: null } satisfies AdminReportPage),
  ...over,
})

const signedIn: AuthState = { ...SIGNED_OUT, mode: 'dev', signedIn: true, token: async () => 'tok' }
let roots: Root[] = []

async function render(auth: AuthState = signedIn) {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  roots.push(root)
  await act(async () =>
    root.render(
      <AuthContext.Provider value={auth}>
        <AdminPage />
      </AuthContext.Provider>,
    ),
  )
  await settle()
  await settle()
  return host
}

const buttons = (host: ParentNode, label: string) =>
  [...host.querySelectorAll('button')].filter((b) => b.textContent === label)
const click = (host: ParentNode, label: string) =>
  act(async () => {
    const [b] = buttons(host, label)
    expect(b, `a '${label}' button`).toBeDefined()
    b!.click()
  })

let visibility: DocumentVisibilityState = 'visible'
beforeEach(() => {
  storage.set('gg-lang', 'en')
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  vi.useRealTimers()
  vi.unstubAllGlobals()
  storage.clear()
  document.body.innerHTML = ''
})

it('signed out: sends the owner to the city page to sign in, and never opens the sheet itself', async () => {
  const calls = stubApi({})
  const openSignIn = vi.fn()
  const host = await render({ ...SIGNED_OUT, mode: 'clerk', openSignIn })
  expect(host.textContent).toContain('Sign in on the city page first')
  expect([...host.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('#/')
  expect(openSignIn).not.toHaveBeenCalled()
  expect(calls).toEqual([])
})

it('Hinglish too: signed out says so in Hinglish', async () => {
  storage.set('gg-lang', 'hi')
  stubApi({})
  const host = await render({ ...SIGNED_OUT, mode: 'dev' })
  expect(host.textContent).toContain('Pehle city page pe login karo')
})

it('someone who is not an admin finds nothing here, and nothing else is asked for', async () => {
  const calls = stubApi({})
  const host = await render()
  expect(host.textContent).toContain('Nothing here.')
  expect(calls.map((c) => c.path)).toEqual(['/api/admin/stats'])
})

it('a report card shows the evidence as text, with the sender and time, and marks it unconfirmed', async () => {
  stubApi(ADMIN_ROUTES())
  const host = await render()
  const card = host.querySelector('[data-report="r-chat"]')!
  expect(card).not.toBeNull()
  // Typed markup stays text: nothing it names is ever made.
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('b')).toBeNull()
  expect(card.textContent).toContain('<img src=x onerror="alert(1)">')
  expect(card.textContent).toContain('see <b>this</b>')
  const line = card.querySelector('.admin-transcript li')!
  expect(line.querySelector('.admin-who')!.textContent).toBe('Ravi')
  expect(line.querySelector('time')!.textContent).toBe(when(AT))
  expect(card.textContent).toContain("Unconfirmed: on the reporter's word only")
  // Who filed it: their age and who vouched for them.
  expect(card.textContent).toContain('Asha Rani')
  expect(card.textContent).toContain('Account 3 days old')
  expect(card.textContent).toContain('Verified by admin')
  // The live counts, and a district that could not be asked.
  expect(host.textContent).toContain('3 residents · 5 ghosts')
  expect(host.textContent).toContain('unknown')
  // The city's cap: everyone it counts, and everyone waiting for room.
  expect(host.textContent).toContain('Seen across the city: 4')
  expect(host.textContent).toContain('Waiting for room: 2')
})

it('evidence lives only in the report card', async () => {
  stubApi(
    ADMIN_ROUTES({
      'GET /api/admin/hidden': () =>
        json([{ user: chatReport.target, reports: [{ ...chatReport, target: undefined }] }]),
    }),
  )
  const host = await render()
  const outside = [...host.querySelectorAll('section')].filter((s) => !s.querySelector('[data-report]'))
  for (const section of outside) expect(section.textContent).not.toContain('onerror')
  expect(host.querySelectorAll('.admin-transcript')).toHaveLength(1)
})

it('Close + ban asks first in the sheet, then bans and closes once, however often it is tapped', async () => {
  const calls = stubApi(
    ADMIN_ROUTES({
      'POST /api/admin/users/dev%3Aravi/ban': () => json({ ...chatReport.target, banned: true }),
      'POST /api/admin/reports/r-chat/action': () => json({ id: 'r-chat', state: 'actioned', closedAt: 1 }),
    }),
  )
  const host = await render()
  await click(host, 'Close + ban')
  const ask = host.querySelector('[role="alertdialog"]')!
  expect(ask.textContent).toContain('Ban Ravi Kumar?')
  // what else a ban does, before it is done: the reports about them close, and their evidence goes
  expect(ask.textContent).toContain(
    'Their open reports (1) close too, and the evidence in them is erased once closed.',
  )
  expect(calls.filter((c) => c.method === 'POST')).toEqual([])
  // A double tap on a slow network: the second finds the button disabled.
  await act(async () => {
    const [yes] = buttons(ask, 'Yes, ban')
    yes!.click()
    yes!.click()
  })
  await settle()
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
    '/api/admin/users/dev%3Aravi/ban',
    '/api/admin/reports/r-chat/action',
  ])
  expect(host.querySelector('[data-report="r-chat"]')).toBeNull()
  expect(host.textContent).toContain('No open reports.')
})

it('Close + mute mutes and closes; Dismiss only closes', async () => {
  const second = { ...chatReport, id: 'r-two' }
  const calls = stubApi(
    ADMIN_ROUTES({
      'GET /api/admin/reports': () => json({ reports: [chatReport, second], next: null }),
      'POST /api/admin/users/dev%3Aravi/mute': () =>
        json({ ...chatReport.target, mutedUntil: Date.now() + DAY }),
      'POST /api/admin/reports/r-chat/action': () => json({ id: 'r-chat', state: 'actioned', closedAt: 1 }),
      'POST /api/admin/reports/r-two/dismiss': () => json({ id: 'r-two', state: 'dismissed', closedAt: 1 }),
    }),
  )
  const host = await render()
  await click(host.querySelector('[data-report="r-chat"]')!, 'Close + mute')
  await settle()
  await click(host.querySelector('[data-report="r-two"]')!, 'Dismiss')
  await settle()
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
    '/api/admin/users/dev%3Aravi/mute',
    '/api/admin/reports/r-chat/action',
    '/api/admin/reports/r-two/dismiss',
  ])
  expect(host.querySelectorAll('[data-report]')).toHaveLength(0)
})

it('a poster report shows the poster as text, and taking it down clears every report about it', async () => {
  const poster = (id: string, posterId: string): AdminReport => ({
    ...chatReport,
    id,
    kind: 'poster',
    unconfirmed: false,
    evidence: {
      kind: 'poster',
      posterId,
      district: 'walled-city',
      wall: 2,
      text: '<b>Cheap</b> phones, DM me',
      when: AT,
    },
  })
  const calls = stubApi(
    ADMIN_ROUTES({
      'GET /api/admin/reports': () =>
        json({ reports: [poster('r-p1', 'poster-1'), poster('r-p2', 'poster-1'), chatReport], next: null }),
      'DELETE /api/admin/posters/poster-1': () => json({ id: 'poster-1', removed: true, closed: 2 }),
    }),
  )
  const host = await render()
  const card = host.querySelector('[data-report="r-p1"]')!
  expect(host.querySelector('b')).toBeNull()
  expect(card.textContent).toContain('<b>Cheap</b> phones, DM me')
  expect(card.textContent).toContain('Pink City, wall 3')
  expect(card.textContent).toContain(`When: ${when(AT)}`)
  // Only a poster report has the button.
  expect(buttons(host.querySelector('[data-report="r-chat"]')!, 'Take the poster down')).toHaveLength(0)
  await click(card, 'Take the poster down')
  await settle()
  expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual([
    '/api/admin/posters/poster-1',
  ])
  expect([...host.querySelectorAll('[data-report]')].map((c) => c.getAttribute('data-report'))).toEqual([
    'r-chat',
  ])
})

it('a poster report says whether its poster is hidden by reports, up, or gone', async () => {
  const report = (id: string, posterState: AdminReport['posterState']): AdminReport => ({
    ...chatReport,
    id,
    kind: 'poster',
    unconfirmed: false,
    posterState,
    evidence: {
      kind: 'poster',
      posterId: `p-${id}`,
      district: 'mi-road',
      wall: 0,
      text: 'Plan text',
      when: null,
    },
  })
  stubApi(
    ADMIN_ROUTES({
      'GET /api/admin/reports': () =>
        json({
          reports: [report('r-h', 'hidden'), report('r-u', 'up'), report('r-g', 'gone'), chatReport],
          next: null,
        }),
    }),
  )
  const host = await render()
  const text = (id: string) => host.querySelector(`[data-report="${id}"]`)!.textContent
  expect(text('r-h')).toContain(
    'Hidden from every wall by reports. Dismissing its last open report puts it back up, unless one was actioned.',
  )
  expect(text('r-u')).toContain('Up on the wall now.')
  expect(text('r-g')).toContain('No longer on the wall.')
  expect(text('r-chat')).not.toContain('on the wall')
})

it('a failed ban keeps the report open and says so', async () => {
  stubApi(ADMIN_ROUTES({ 'POST /api/admin/users/dev%3Aravi/ban': () => json({}, 500) }))
  const host = await render()
  await click(host, 'Close + ban')
  await click(host, 'Yes, ban')
  await settle()
  expect(host.querySelector('[data-report="r-chat"]')).not.toBeNull()
  expect(host.querySelector('[role="alert"]')!.textContent).toBe("That didn't work. Try again.")
})

it('the queue shows each person once, with how many open reports there are; a ban clears them all', async () => {
  const ravi = { ...chatReport.target, openReports: 3 }
  const meera = person('dev:meera', 'Meera', { openReports: 1 })
  const calls = stubApi(
    ADMIN_ROUTES({
      // As the server sends it: grouped by person, in order.
      'GET /api/admin/reports': () =>
        json({
          reports: [
            { ...chatReport, id: 'r-1', target: ravi },
            { ...chatReport, id: 'r-2', target: ravi, reason: 'spam' },
            { ...chatReport, id: 'r-3', target: meera },
          ],
          next: null,
        }),
      'POST /api/admin/users/dev%3Aravi/ban': () => json({ ...ravi, banned: true, openReports: 0 }),
      'POST /api/admin/reports/r-1/action': () => json({ id: 'r-1', state: 'actioned', closedAt: 1 }),
    }),
  )
  const host = await render()
  const groups = [...host.querySelectorAll('.admin-group')]
  expect(groups.map((g) => g.querySelector('h3')!.textContent)).toEqual([
    'Ravi Kumar · open reports: 3',
    'Meera · open reports: 1',
  ])
  expect(groups[0]!.querySelectorAll('[data-report]')).toHaveLength(2)
  await click(groups[0]!.querySelector('[data-report="r-1"]')!, 'Close + ban')
  await click(host, 'Yes, ban')
  await settle()
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
    '/api/admin/users/dev%3Aravi/ban',
    '/api/admin/reports/r-1/action',
  ])
  // The ban closed every report about him on the server: none of them stays on the page.
  expect([...host.querySelectorAll('[data-report]')].map((c) => c.getAttribute('data-report'))).toEqual([
    'r-3',
  ])
})

it('a card the next page repeats is shown once', async () => {
  stubApi(
    ADMIN_ROUTES({
      'GET /api/admin/reports?state=open&cursor=': () => json({ reports: [chatReport], next: 'CURSOR-1' }),
      // the queue moved between the two loads: the same report comes again
      'GET /api/admin/reports?state=open&cursor=CURSOR-1': () =>
        json({ reports: [chatReport, { ...chatReport, id: 'r-older' }], next: null }),
    }),
  )
  const host = await render()
  await click(host, 'Load more')
  await settle()
  expect([...host.querySelectorAll('[data-report]')].map((c) => c.getAttribute('data-report'))).toEqual([
    'r-chat',
    'r-older',
  ])
  expect(host.querySelectorAll('.admin-group')).toHaveLength(1)
})

it('the queue loads 20 more with the cursor it was given', async () => {
  const calls = stubApi(
    ADMIN_ROUTES({
      'GET /api/admin/reports?state=open&cursor=': () => json({ reports: [chatReport], next: 'CURSOR-1' }),
      'GET /api/admin/reports?state=open&cursor=CURSOR-1': () =>
        json({ reports: [{ ...chatReport, id: 'r-older' }], next: null }),
    }),
  )
  const host = await render()
  await click(host, 'Load more')
  await settle()
  expect(calls.map((c) => c.path)).toContain('/api/admin/reports?state=open&cursor=CURSOR-1')
  expect([...host.querySelectorAll('[data-report]')].map((c) => c.getAttribute('data-report'))).toEqual([
    'r-chat',
    'r-older',
  ])
  expect(buttons(host, 'Load more')).toHaveLength(0)
})

it('auto-hidden comes first, shows how new the reporters are and who invited them, and unhides in one tap', async () => {
  const ring = (n: number) =>
    person(`dev:ring-${n}`, `Ring ${n}`, { createdAt: Date.now(), verifiedBy: 'dev:boss' })
  const hidden: AdminHidden[] = [
    {
      user: person('dev:meera', 'Meera', { hidden: true }),
      reports: [1, 2, 3].map((n) => ({
        id: `h${n}`,
        kind: 'person',
        reason: 'spam',
        createdAt: AT,
        state: 'open',
        closedAt: null,
        unconfirmed: false,
        reporter: ring(n),
      })),
    },
  ]
  let unhidden = false
  const calls = stubApi(
    ADMIN_ROUTES({
      'GET /api/admin/hidden': () => json(unhidden ? [] : hidden),
      'POST /api/admin/users/dev%3Ameera/unhide': () => {
        unhidden = true
        return json({ ...hidden[0]!.user, hidden: false })
      },
    }),
  )
  const host = await render()
  const sections = [...host.querySelectorAll('section.admin-section')]
  expect(sections[0]!.querySelector('h2')!.textContent).toBe('Auto-hidden')
  const entry = sections[0]!
  expect(entry.textContent).toContain('Meera')
  expect(entry.textContent?.match(/Account 0 days old/g)).toHaveLength(3)
  expect(entry.textContent?.match(/Verified by dev:boss/g)).toHaveLength(3)
  // The owner is told what an unhide does before tapping it.
  expect(entry.textContent).toContain(
    'Unhiding closes no report: they all stay open in the queue, evidence and all. Only reports filed after this count: three new chat or bench reports would hide them again.',
  )
  const queueAsks = () => calls.filter((c) => c.path.startsWith('/api/admin/reports')).length
  expect(queueAsks()).toBe(1)
  await click(entry, 'Unhide')
  await settle()
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
    '/api/admin/users/dev%3Ameera/unhide',
  ])
  expect(entry.textContent).toContain('Nobody is hidden.')
  // The queue is asked for again, from the start, so its cards show them as they now are.
  await settle()
  expect(queueAsks()).toBe(2)
})

it('looks someone up and acts on them; a ban asks first', async () => {
  const lalita = person('dev:lalita', 'Lalita', { verified: false, verifiedBy: null })
  const calls = stubApi(
    ADMIN_ROUTES({
      'GET /api/admin/users?q=Lal': () => json([lalita]),
      'POST /api/admin/users/dev%3Alalita/verify': () =>
        json({ ...lalita, verified: true, verifiedBy: 'admin' }),
      'POST /api/admin/users/dev%3Alalita/ban': () => json({ ...lalita, verified: true, banned: true }),
    }),
  )
  const host = await render()
  const lookup = [...host.querySelectorAll('section')].find((s) => s.textContent?.includes('Find someone'))!
  const input = lookup.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Lal')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click(lookup, 'Search')
  await settle()
  expect(lookup.textContent).toContain('Not verified')
  await click(lookup, 'Verify')
  await settle()
  expect(lookup.textContent).toContain('Verified by admin')
  expect(buttons(lookup, 'Verify')).toHaveLength(0)
  await click(lookup, 'Ban')
  expect(lookup.querySelector('[role="alertdialog"]')!.textContent).toContain(
    'Their open reports (1) close too',
  )
  expect(calls.some((c) => c.path.endsWith('/ban'))).toBe(false)
  await click(lookup, 'Yes, ban')
  await settle()
  expect(lookup.textContent).toContain('Banned')
  expect(buttons(lookup, 'Unban')).toHaveLength(1)
})

it('lists whom someone vouched for, and takes their verification away', async () => {
  const boss = person('dev:boss', 'Boss', { verifiedBy: 'admin' })
  const calls = stubApi(
    ADMIN_ROUTES({
      'GET /api/admin/users?q=Boss': () => json([boss]),
      'GET /api/admin/users/dev%3Aboss/verified': () =>
        json([person('dev:ring-1', 'Ring One', { verifiedBy: 'dev:boss' })]),
      'POST /api/admin/users/dev%3Aboss/unverify': () => json({ ...boss, verified: false, verifiedBy: null }),
    }),
  )
  const host = await render()
  const lookup = [...host.querySelectorAll('section')].find((s) => s.textContent?.includes('Find someone'))!
  const input = lookup.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Boss')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click(lookup, 'Search')
  await settle()
  await click(lookup, 'Whom they verified')
  await settle()
  const vouched = lookup.querySelector('[aria-label="Whom they verified"]')!
  expect(vouched.textContent).toContain('Ring One')
  expect(vouched.textContent).toContain('Verified by dev:boss')
  await click(lookup, 'Unverify')
  await settle()
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
    '/api/admin/users/dev%3Aboss/unverify',
  ])
  expect(lookup.textContent).toContain('Not verified')
  expect(buttons(lookup, 'Unverify')).toHaveLength(0)
  expect(buttons(lookup, 'Verify')).toHaveLength(1)
})

it(`stats are asked for every ${STATS_MS / 1000} s, and only while the page is in view`, async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const calls = stubApi(ADMIN_ROUTES())
  await render()
  const asked = () => calls.filter((c) => c.path === '/api/admin/stats').length
  expect(asked()).toBe(1)
  await act(async () => void vi.advanceTimersByTime(STATS_MS))
  await settle()
  expect(asked()).toBe(2)
  // Out of view: nothing, however long.
  visibility = 'hidden'
  await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => void vi.advanceTimersByTime(STATS_MS * 4))
  await settle()
  expect(asked()).toBe(2)
  // Back in view: asked at once, then on the beat again.
  visibility = 'visible'
  await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
  await settle()
  expect(asked()).toBe(3)
  await act(async () => void vi.advanceTimersByTime(STATS_MS))
  await settle()
  expect(asked()).toBe(4)
})

it('Errors lists the top fingerprints as text: count, last seen, the browsers, and a sample stack', async () => {
  const groups: AdminErrorGroup[] = [
    {
      fingerprint: 'f1',
      where: 'error',
      msg: 'TypeError: <img src=x onerror="alert(1)">',
      count: 7,
      lastSeen: AT,
      sample: { stack: 'at tick (https://g.test/a.js:1:2)', build: 'abc1234', district: 'mi-road' },
      ua: { 'mobile/instagram': 5, 'desktop/other': 2 },
    },
    {
      fingerprint: 'f2',
      where: 'webgl-lost',
      msg: 'WebGL context lost',
      count: 1,
      lastSeen: AT,
      sample: { stack: null, build: 'abc1234', district: null },
      ua: { 'mobile/facebook': 1 },
    },
  ]
  const calls = stubApi(ADMIN_ROUTES({ 'GET /api/admin/errors': () => json(groups) }))
  const host = await render()
  const section = host.querySelector('[aria-labelledby="admin-errors"]')!
  expect(section.querySelector('h2')!.textContent).toBe('Errors')
  const cards = section.querySelectorAll('.admin-card')
  expect(cards).toHaveLength(2)
  expect(cards[0]!.textContent).toContain('TypeError: <img src=x onerror="alert(1)">')
  expect(section.querySelector('img')).toBeNull()
  expect(cards[0]!.textContent).toContain(`7 times · last: ${when(AT)}`)
  expect(cards[0]!.textContent).toContain('mobile/instagram 5 · desktop/other 2')
  expect(cards[0]!.textContent).toContain('MI Road')
  expect(cards[0]!.querySelector('pre')!.textContent).toBe('at tick (https://g.test/a.js:1:2)')
  expect(cards[1]!.querySelector('pre')).toBeNull()
  // asked once, and again only on Refresh
  expect(calls.filter((c) => c.path === '/api/admin/errors')).toHaveLength(1)
  await click(section, 'Refresh')
  await settle()
  expect(calls.filter((c) => c.path === '/api/admin/errors')).toHaveLength(2)
})

it('Errors says when there are none, and when they could not be loaded', async () => {
  stubApi(ADMIN_ROUTES())
  const host = await render()
  expect(host.querySelector('[aria-labelledby="admin-errors"]')!.textContent).toContain(
    'No errors in the last 14 days.',
  )
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ''
  stubApi(ADMIN_ROUTES({ 'GET /api/admin/errors': () => json({ error: 'x' }, 500) }))
  const failed = await render()
  expect(failed.querySelector('[aria-labelledby="admin-errors"] [role="alert"]')).not.toBeNull()
})
