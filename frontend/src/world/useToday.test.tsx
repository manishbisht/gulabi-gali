// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TodayRecord } from '../net/protocol'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Hooks = typeof import('./useToday')
type Today = typeof import('./today')
type Deeds = typeof import('./deeds')
type Account = Parameters<Hooks['useToday']>[0]
let hooks: Hooks
let today: Today
let deeds: Deeds

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules() // storage keeps an in-memory fallback map, so start from a fresh copy
  hooks = await import('./useToday')
  today = await import('./today')
  deeds = await import('./deeds')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The server's side: works the streak out from what it holds, as the Worker does. */
function server(start: TodayRecord | null = null, fail = false) {
  let held = start ?? today.NO_RECORD
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (fail) return json({ error: 'rate' }, 429)
    held = today.advance(held, (JSON.parse(String(init?.body)) as { day: string }).day)
    return json(held)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function mount(account: Account, visible = true, override = 'photo') {
  const out = {} as ReturnType<Hooks['useToday']>
  let root!: Root
  const goal = today.goalById(override)
  function Probe({ acc, vis }: { acc: Account; vis: boolean }) {
    Object.assign(out, hooks.useToday(acc, vis, goal))
    return null
  }
  act(() => {
    root = createRoot(document.createElement('div'))
    root.render(<Probe acc={account} vis={visible} />)
  })
  return {
    out,
    rerender: (acc: Account, vis = visible) => act(() => root.render(<Probe acc={acc} vis={vis} />)),
    settle: () => act(async () => {}),
  }
}
const resident = (rec?: TodayRecord, id = 'dev:asha'): Account => ({
  id,
  token: async () => 'tok',
  ...(rec ? { today: rec } : {}),
})
const day = () => today.istDay(Date.now())
const yesterday = () => today.dayBefore(day())

it("a ghost's goal done: the chip says so, the toast celebrates, the record stays on the device; other deeds do nothing", async () => {
  const fetchMock = server()
  const { out } = mount(null)
  expect(out.goal.id).toBe('photo')
  expect(out.done).toBe(false)
  act(() => deeds.emitDeed({ kind: 'roof' }))
  expect(out.done).toBe(false)
  act(() => deeds.emitDeed({ kind: 'photo' }))
  expect(out.done).toBe(true)
  expect(out.streak).toBe(1)
  expect(out.toast).toBe(1)
  expect(today.localRecord()).toEqual({ last: day(), streak: 1, best: 1 })
  // a second photo is no second celebration
  act(() => deeds.emitDeed({ kind: 'photo' }))
  expect(today.localRecord().streak).toBe(1)
  expect(fetchMock).not.toHaveBeenCalled()
})

it('the run carries on from yesterday; a run with a day missed shows 0 until today is done', () => {
  today.saveLocalRecord({ last: yesterday(), streak: 2, best: 4 })
  const { out } = mount(null)
  expect(out.streak).toBe(2)
  act(() => deeds.emitDeed({ kind: 'photo' }))
  expect(out.streak).toBe(3)
  expect(out.best).toBe(4)

  localStorage.clear()
  today.saveLocalRecord({ last: today.dayBefore(yesterday()), streak: 5, best: 5 })
  const later = mount(null).out
  expect(later.streak).toBe(0)
  expect(later.best).toBe(5)
})

it("without the override it is the day's own goal", () => {
  const out = (() => {
    const o = {} as ReturnType<Hooks['useToday']>
    function Probe() {
      Object.assign(o, hooks.useToday(null, true))
      return null
    }
    act(() => createRoot(document.createElement('div')).render(<Probe />))
    return o
  })()
  expect(out.goal).toEqual(today.goalFor(day()))
})

it("a resident's done day goes to the server, whose answer is the record", async () => {
  const fetchMock = server({ last: yesterday(), streak: 6, best: 6 })
  const { out, settle } = mount(resident({ last: yesterday(), streak: 6, best: 6 }))
  expect(out.streak).toBe(6)
  act(() => deeds.emitDeed({ kind: 'photo' }))
  expect(out.done).toBe(true) // shown at once
  await settle()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0]!
  expect(url).toContain('/api/me/today')
  expect(init?.method).toBe('PUT')
  expect(JSON.parse(String(init?.body))).toEqual({ day: day() }) // only the day: never a number
  expect(out.streak).toBe(7)
  // nothing of a resident's is written to the ghost's record on the device
  expect(today.localRecord()).toEqual(today.NO_RECORD)
})

it("a resident's failed mark stays pending and goes up on the next load, the same day", async () => {
  server(null, true)
  const first = mount(resident())
  act(() => deeds.emitDeed({ kind: 'photo' }))
  await first.settle()
  expect(today.pendingDay('dev:asha')).toBe(day())
  const fetchMock = server()
  const again = mount(resident())
  await again.settle()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(again.out.done).toBe(true)
  expect(today.pendingDay('dev:asha')).toBe('')
})

it('a pending mark from a past day is dropped, never sent', async () => {
  const fetchMock = server()
  localStorage.setItem('gg-today-pending:dev:asha', yesterday())
  const { out, settle } = mount(resident())
  await settle()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(out.done).toBe(false)
  expect(today.pendingDay('dev:asha')).toBe('')
})

it("today's goal done as a ghost comes along when they sign in; the server already knowing it sends nothing", async () => {
  const fetchMock = server()
  const page = mount(null)
  act(() => deeds.emitDeed({ kind: 'photo' }))
  page.rerender(resident())
  await page.settle()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(page.out.done).toBe(true)
  const known = server({ last: day(), streak: 1, best: 1 })
  mount(resident({ last: day(), streak: 1, best: 1 }, 'dev:ravi'))
  await page.settle()
  expect(known).not.toHaveBeenCalled()
})

it('the toast waits while the HUD is hidden (photo mode), then stays its few seconds', async () => {
  vi.useFakeTimers()
  const page = mount(null, false)
  act(() => deeds.emitDeed({ kind: 'photo' }))
  expect(page.out.toast).toBeNull() // hidden
  act(() => vi.advanceTimersByTime(10_000))
  page.rerender(null, true)
  expect(page.out.toast).toBe(1) // still to be seen
  act(() => vi.advanceTimersByTime(4_100))
  expect(page.out.toast).toBeNull()
})
