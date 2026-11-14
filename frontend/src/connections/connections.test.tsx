// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MatchView, PublicPerson, RequestLists, RequestView } from '../net/protocol'
import { Connections } from '../ui/Connections'
import { useConnections } from './useConnections'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeSocket {
  static all: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  send() {}
  close() {}
}

const face = { skin: 2, outfit: 'sandstone', head: 'none' } as const
const person = (id: string, name: string): PublicPerson => ({ id, name, look: face, status: '' })
const asha = person('p1', 'Asha')
const ravi = person('p2', 'Ravi')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

let requests: RequestLists
let matches: MatchView[]
let calls: string[]
let msgs: { id: string; body: string; at: number; mine: boolean }[]
/** Armed, the next GET /api/requests waits until `release` is called with its body. */
let armed: boolean
let release: (body: unknown) => void

const incomingFrom = (p: PublicPerson, reason: string): RequestView => ({
  id: `r-${p.id}`,
  person: p,
  reason,
  createdAt: 1,
  state: 'pending',
})

beforeEach(() => {
  FakeSocket.all = []
  calls = []
  armed = false
  msgs = [{ id: 'z9', body: 'hello', at: 5, mine: false }]
  localStorage.clear()
  requests = { incoming: [incomingFrom(asha, 'Chai pe chalein? JKK ke baad')], sent: [] }
  matches = [{ id: 'm1', person: ravi, last: { body: 'hello', at: 5, mine: false } }]
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '')
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${path}`)
      if (path === '/api/requests') {
        if (!armed) return json(requests)
        armed = false
        return new Promise<Response>((resolve) => {
          release = (body) => resolve(json(body))
        })
      }
      if (path === '/api/matches') return json(matches)
      if (path === '/api/matches/m1/messages') return json({ messages: msgs, before: null })
      if (path === '/api/requests/r-p1/accept' && method === 'POST') {
        requests = { ...requests, incoming: [] }
        matches = [{ id: 'm2', person: asha }, ...matches]
        return json({ matchId: 'm2' })
      }
      if (path === '/api/matches/m1' && method === 'DELETE') {
        matches = matches.filter((m) => m.id !== 'm1')
        return new Response(null, { status: 204 })
      }
      return json({ error: 'not found' }, 404)
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

function Probe({ sheet, user = 'u1' }: { sheet: boolean; user?: string | null }) {
  const conn = useConnections({ user, token: async () => 'tok' })
  const [open, setOpen] = useState(sheet)
  return (
    <>
      <output data-testid="badge">{conn.badge}</output>
      <output data-testid="incoming">{conn.incoming.length}</output>
      <button type="button" data-testid="open" onClick={() => setOpen(true)} />
      {open && <Connections conn={conn} lang="en" token={async () => 'tok'} onClose={() => setOpen(false)} />}
    </>
  )
}

async function mount() {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<Probe sheet={false} />))
  await settle()
  // the inbox socket comes up: the lists are fetched
  expect(FakeSocket.all[0]!.url).toBe('ws://127.0.0.1:8787/api/inbox?token=tok')
  await act(async () => FakeSocket.all[0]!.onopen!())
  await settle()
  const q = (sel: string) => host.querySelector(sel)!
  const button = (name: string | RegExp) =>
    [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').match(name))!
  const click = (el: Element) =>
    act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  return { host, q, button, click }
}

it('badge counts unread', async () => {
  const { q, click } = await mount()
  // one unread request and one chat whose last line is theirs
  expect(q('[data-testid=badge]').textContent).toBe('2')
  // looking at the incoming tab reads the request; the chat stays unread
  await click(q('[data-testid=open]'))
  await settle()
  expect(q('[data-testid=badge]').textContent).toBe('1')
})

it('accept moves request into Baatein', async () => {
  const { host, q, button, click } = await mount()
  await click(q('[data-testid=open]'))
  await settle()
  expect(host.textContent).toContain('Chai pe chalein? JKK ke baad')
  await click(button(/^Yes$/))
  await settle()
  expect(calls).toContain('POST /api/requests/r-p1/accept')
  expect(host.textContent).not.toContain('Chai pe chalein? JKK ke baad')
  // the sheet lands on the chats, and the new match is there
  expect(host.querySelector('[role=tab][aria-selected=true]')!.textContent).toContain('Chats')
  expect(host.textContent).toContain('Asha')
})

it('unmatch removes the chat', async () => {
  const { host, q, button, click } = await mount()
  await click(q('[data-testid=open]'))
  await settle()
  await click([...host.querySelectorAll('[role=tab]')].find((b) => b.textContent?.includes('Chats'))!)
  await click(button(/Ravi/))
  await settle()
  await click(button(/^Unmatch$/))
  // the confirm is in the sheet, not a native dialog
  expect(calls).not.toContain('DELETE /api/matches/m1')
  await click(button(/Yes, unmatch/))
  await settle()
  expect(calls).toContain('DELETE /api/matches/m1')
  expect(host.textContent).not.toContain('Ravi')
  expect(JSON.parse(localStorage.getItem('gg-read') ?? '{}')).not.toHaveProperty('m1')
})

it('the later refresh wins when answers come back out of order', async () => {
  armed = true // the first refresh (the socket opening) is slow
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<Probe sheet={false} />))
  await settle()
  await act(async () => FakeSocket.all[0]!.onopen!())
  await settle()
  const first = release
  // a notice: a second refresh, which answers at once with the fresh list
  await act(async () => FakeSocket.all[0]!.onmessage!({ data: JSON.stringify({ t: 'request', id: 'r-p1' }) }))
  await settle()
  expect(host.querySelector('[data-testid=incoming]')!.textContent).toBe('1')
  // the slow, older answer (an empty list) lands last and must not win
  await act(async () => first({ incoming: [], sent: [] }))
  await settle()
  expect(host.querySelector('[data-testid=incoming]')!.textContent).toBe('1')
})

it('a refresh that resolves after sign-out changes nothing', async () => {
  localStorage.setItem('gg-read', JSON.stringify({ gone: 'x' }))
  armed = true
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<Probe sheet={false} />))
  await settle()
  await act(async () => FakeSocket.all[0]!.onopen!())
  await settle()
  await act(async () => root.render(<Probe sheet={false} user={null} />))
  await settle()
  await act(async () => release(requests))
  await settle()
  expect(host.querySelector('[data-testid=incoming]')!.textContent).toBe('0')
  expect(host.querySelector('[data-testid=badge]')!.textContent).toBe('0')
  // nothing was pruned against the wrong user's matches
  expect(JSON.parse(localStorage.getItem('gg-read')!)).toEqual({ gone: 'x' })
})

it('an open chat catches up after the inbox reconnects', async () => {
  const { host, q, button, click } = await mount()
  await click(q('[data-testid=open]'))
  await settle()
  await click([...host.querySelectorAll('[role=tab]')].find((b) => b.textContent?.includes('Chats'))!)
  await click(button(/Ravi/))
  await settle()
  expect(host.textContent).toContain('hello')
  // the socket drops; a message lands on the server during the gap, unheard
  await act(async () => FakeSocket.all[0]!.onclose!({ code: 1006 }))
  msgs = [...msgs, { id: 'z10', body: 'sent while you were away', at: 6, mine: false }]
  await act(async () => void (await new Promise((r) => setTimeout(r, 1100))))
  expect(FakeSocket.all).toHaveLength(2)
  expect(host.textContent).not.toContain('sent while you were away')
  await act(async () => FakeSocket.all[1]!.onopen!())
  await settle()
  expect(host.textContent).toContain('sent while you were away')
})

it('a message notice refetches the chats only; any other notice refetches both lists', async () => {
  await mount()
  const notice = (n: unknown) => act(async () => FakeSocket.all[0]!.onmessage!({ data: JSON.stringify(n) }))
  let from = calls.length
  await notice({ t: 'message', matchId: 'm1', id: 'z10' })
  await settle()
  expect(calls.slice(from)).toEqual(['GET /api/matches'])
  from = calls.length
  await notice({ t: 'request', id: 'r-p9' })
  await settle()
  expect(calls.slice(from).sort()).toEqual(['GET /api/matches', 'GET /api/requests'])
})

it('a chats-only refetch never lets an older request list win', async () => {
  armed = true // the first refresh (the socket opening) is slow on requests
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<Probe sheet={false} />))
  await settle()
  await act(async () => FakeSocket.all[0]!.onopen!())
  await settle()
  // a message arrives meanwhile: chats only, and the slow request list still lands
  await act(async () =>
    FakeSocket.all[0]!.onmessage!({ data: JSON.stringify({ t: 'message', matchId: 'm1', id: 'z10' }) }),
  )
  await settle()
  await act(async () => release(requests))
  await settle()
  expect(host.querySelector('[data-testid=incoming]')!.textContent).toBe('1')
})
