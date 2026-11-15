// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  LIVE_CLOSE,
  type EndedChat,
  type MatchView,
  type PublicPerson,
  type RequestLists,
  type RequestView,
} from '../net/protocol'
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
let ended: EndedChat[]
/** The bodies of the reports filed. */
let reports: unknown[]
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
  onBlock = undefined
  ended = []
  reports = []
  armed = false
  msgs = [{ id: 'z9', body: 'hello', at: 5, mine: false }]
  localStorage.clear()
  requests = { incoming: [incomingFrom(asha, 'Chai pe chalein? JKK ke baad')], sent: [] }
  matches = [{ id: 'm1', person: ravi, last: { id: 'z9', body: 'hello', at: 5, mine: false } }]
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
      if (path === '/api/ended') return json(ended)
      if (path === '/api/reports' && method === 'POST') {
        reports.push(JSON.parse(String(init!.body)))
        return json({ autoHidden: false }, 201)
      }
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

/** What the Connections sheet's block does here: set per test. */
let onBlock: ((id: string, name: string) => Promise<boolean>) | undefined

function Probe({ sheet, user = 'u1' }: { sheet: boolean; user?: string | null }) {
  const conn = useConnections({ user, token: async () => 'tok' })
  const [open, setOpen] = useState(sheet)
  return (
    <>
      <output data-testid="badge">{conn.badge}</output>
      <output data-testid="incoming">{conn.incoming.length}</output>
      <button type="button" data-testid="open" onClick={() => setOpen(true)} />
      {open && (
        <Connections
          conn={conn}
          lang="en"
          token={async () => 'tok'}
          onBlock={onBlock}
          onClose={() => setOpen(false)}
        />
      )}
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

it("loading the inbox fetches no chat's messages: a chat's last id is in the list", async () => {
  localStorage.setItem('gg-read', JSON.stringify({ m1: 'z9' }))
  const { q } = await mount()
  expect(calls.filter((c) => c.includes('/messages'))).toEqual([])
  // read up to its last line: only the request counts
  expect(q('[data-testid=badge]').textContent).toBe('1')
})

it('a chat read before is unread again once its last line is newer, and read once opened', async () => {
  localStorage.setItem('gg-read', JSON.stringify({ m1: 'z8' }))
  const { host, q, button, click } = await mount()
  expect(calls.filter((c) => c.includes('/messages'))).toEqual([])
  expect(q('[data-testid=badge]').textContent).toBe('2')
  await click(q('[data-testid=open]'))
  await settle()
  await click([...host.querySelectorAll('[role=tab]')].find((b) => b.textContent?.includes('Chats'))!)
  await click(button(/Ravi/))
  await settle()
  expect(q('[data-testid=badge]').textContent).toBe('0')
  expect(JSON.parse(localStorage.getItem('gg-read')!)).toEqual({ m1: 'z9' })
})

it('a new message (a notice, then the list) makes a read chat unread, without fetching it', async () => {
  localStorage.setItem('gg-read', JSON.stringify({ m1: 'z9' }))
  const { q } = await mount()
  expect(q('[data-testid=badge]').textContent).toBe('1')
  matches = [{ id: 'm1', person: ravi, last: { id: 'z10', body: 'aur?', at: 6, mine: false } }]
  await act(async () =>
    FakeSocket.all[0]!.onmessage!({ data: JSON.stringify({ t: 'message', matchId: 'm1', id: 'z10' }) }),
  )
  await settle()
  expect(q('[data-testid=badge]').textContent).toBe('2')
  expect(calls.filter((c) => c.includes('/messages'))).toEqual([])
  // my own reply as the last line is never unread
  matches = [{ id: 'm1', person: ravi, last: { id: 'z11', body: 'chalo', at: 7, mine: true } }]
  await act(async () =>
    FakeSocket.all[0]!.onmessage!({ data: JSON.stringify({ t: 'message', matchId: 'm1', id: 'z11' }) }),
  )
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
  await click(button(/^More$/))
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
  expect(calls.slice(from).sort()).toEqual(['GET /api/ended', 'GET /api/matches', 'GET /api/requests'])
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

it('an open chat the other person ended says so, and takes no more messages', async () => {
  const { host, q, button, click } = await mount()
  await click(q('[data-testid=open]'))
  await settle()
  await click([...host.querySelectorAll('[role=tab]')].find((b) => b.textContent?.includes('Chats'))!)
  await click(button(/Ravi/))
  await settle()
  expect(host.textContent).toContain('hello')
  // Ravi unmatches: the match is gone from the server, and the inbox says so
  matches = matches.filter((m) => m.id !== 'm1')
  await act(async () =>
    FakeSocket.all[0]!.onmessage!({ data: JSON.stringify({ t: 'unmatched', matchId: 'm1' }) }),
  )
  await settle()
  // still on the chat, with the lines already read, and told it has ended
  expect(host.textContent).toContain('Ravi')
  expect(host.textContent).toContain('hello')
  expect(host.textContent).toContain('This conversation has ended')
  expect(host.querySelector('input[aria-label="Write in the chat"]')).toBeNull()
  expect(button(/^Unmatch$/)).toBeUndefined()
  // and it can still be reported from right there
  await click(button(/^Report$/))
  const form = host.querySelector('[role=dialog][aria-label="Report Ravi"]')!
  await click([...form.querySelectorAll('button')].find((b) => b.textContent === 'Harassing me')!)
  await click([...form.querySelectorAll('button')].find((b) => b.textContent === 'Send report')!)
  await settle()
  expect(reports).toEqual([{ kind: 'chat', targetId: 'p2', reason: 'harassment' }])
  await click(button(/^OK$/))
  // back goes to the list, where it is gone
  await click(button(/^Back$/))
  await settle()
  expect(host.textContent).not.toContain('Ravi')
  expect(host.textContent).not.toContain('This conversation has ended')
})

it('an inbox closed for a ban (4004) tells the page, so it can show the ban at once', async () => {
  const onBanned = vi.fn()
  function Banned() {
    useConnections({ user: 'u1', token: async () => 'tok', onBanned })
    return null
  }
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(<Banned />))
  await settle()
  await act(async () => FakeSocket.all[0]!.onopen!())
  await act(async () => FakeSocket.all[0]!.onclose!({ code: LIVE_CLOSE.banned }))
  expect(onBanned).toHaveBeenCalledOnce()
})

it('Ended chats: a chat that is over can still be reported, and opening the sheet looks again', async () => {
  const { host, q, button, click } = await mount()
  // Kabir blocked us since the inbox came up: no notice says so (a block tells the blocked nothing)
  ended = [{ matchId: 'm0', person: { id: 'p7', name: 'Kabir' }, endedAt: 3 }]
  await click(q('[data-testid=open]'))
  await settle()
  await click([...host.querySelectorAll('[role=tab]')].find((b) => b.textContent?.includes('Chats'))!)
  const section = host.querySelector('[aria-label="Ended chats"]')!
  expect(section.textContent).toContain('Kabir')
  await click([...section.querySelectorAll('button')].find((b) => b.textContent === 'Report')!)
  const form = host.querySelector('[role=dialog][aria-label="Report Kabir"]')!
  await click([...form.querySelectorAll('button')].find((b) => b.textContent === 'Harassing me')!)
  await click([...form.querySelectorAll('button')].find((b) => b.textContent === 'Send report')!)
  await settle()
  expect(reports).toEqual([{ kind: 'chat', targetId: 'p7', reason: 'harassment' }])
  expect(host.textContent).toContain('Thank you. The moderator will take a look.')
  await click(button(/^OK$/))
  expect(host.querySelector('[role=dialog][aria-label="Report Kabir"]')).toBeNull()
})

it('an ended chat with no saved name says someone', async () => {
  ended = [{ matchId: 'm0', person: { id: 'p7', name: null }, endedAt: 3 }]
  const { host, q, click } = await mount()
  await click(q('[data-testid=open]'))
  await settle()
  await click([...host.querySelectorAll('[role=tab]')].find((b) => b.textContent?.includes('Chats'))!)
  expect(host.querySelector('[aria-label="Ended chats"]')!.textContent).toContain('Someone')
})

it('blocking from a chat with "Also report?" blocks at once and keeps the chat for the report form', async () => {
  const blocked: string[] = []
  onBlock = async (id) => {
    blocked.push(id)
    // the block ends the match on the server
    matches = matches.filter((m) => m.id !== 'm1')
    return true
  }
  const { host, q, button, click } = await mount()
  await click(q('[data-testid=open]'))
  await settle()
  await click([...host.querySelectorAll('[role=tab]')].find((b) => b.textContent?.includes('Chats'))!)
  await click(button(/Ravi/))
  await settle()
  await click(button(/^More$/))
  await click(button(/^Block$/))
  const ask = host.querySelector('[role=alertdialog]')!
  await click(
    [...ask.querySelectorAll('label')].find((l) => l.textContent === 'Also report?')!.querySelector('input')!,
  )
  await click(button(/^Yes, block$/))
  await settle()
  expect(blocked).toEqual(['p2'])
  // the list refreshes (the match is gone), and the chat stays, ended, under the form
  await act(async () => FakeSocket.all[0]!.onmessage!({ data: JSON.stringify({ t: 'request', id: 'x' }) }))
  await settle()
  const form = host.querySelector('[role=dialog][aria-label="Report Ravi"]')!
  expect(form).not.toBeNull()
  expect(form.textContent).not.toContain('Also block?')
  // cancelled: no report, the block stands, back to the list
  await click([...form.querySelectorAll('button')].find((b) => b.textContent === 'Never mind')!)
  await settle()
  expect(reports).toEqual([])
  expect(blocked).toEqual(['p2'])
  expect(host.querySelector('.conn-chat')).toBeNull()
})
