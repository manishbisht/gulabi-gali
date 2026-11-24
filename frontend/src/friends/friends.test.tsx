// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FriendLists, PublicPerson } from '../net/protocol'
import { ChatView } from '../ui/ChatView'
import type { Bench } from '../world/benches'
import { ChaiInvite } from './ChaiInvite'
import { FriendsPanel } from './FriendsPanel'
import { FRIENDS_POLL_MS, useFriends } from './useFriends'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

let lists: FriendLists
let calls: string[]
let bodies: Record<string, unknown>
/** What POST /api/chai answers. */
let chaiReply: () => Response

beforeEach(() => {
  calls = []
  bodies = {}
  chaiReply = () => json({ sent: true }, 202)
  lists = {
    friends: [
      { id: 'u-asha', name: 'Asha', here: 'university' },
      { id: 'u-ravi', name: 'Ravi' },
    ],
    incoming: [{ id: 'u-meera', name: 'Meera' }],
    sent: [{ id: 'u-kabir', name: 'Kabir' }],
    settings: { showPresence: true, chaiInvites: true },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '')
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${path}`)
      if (init?.body) bodies[`${method} ${path}`] = JSON.parse(String(init.body))
      if (path === '/api/friends' && method === 'GET') return json(lists)
      if (path === '/api/friends' && method === 'POST') return json({ state: 'asked' }, 201)
      if (path === '/api/me/friend-settings') {
        lists = { ...lists, settings: { ...lists.settings, ...(bodies[`PUT ${path}`] as object) } }
        return json(lists.settings)
      }
      if (path === '/api/friends/u-meera/accept') {
        lists = { ...lists, incoming: [], friends: [...lists.friends, { id: 'u-meera', name: 'Meera' }] }
        return json({ state: 'friends' })
      }
      if (path === '/api/friends/u-ravi' && method === 'DELETE') {
        lists = { ...lists, friends: lists.friends.filter((f) => f.id !== 'u-ravi') }
        return new Response(null, { status: 204 })
      }
      if (path === '/api/chai' && method === 'POST') return chaiReply()
      return json({ error: 'not found' }, 404)
    }),
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

function Panel() {
  const friends = useFriends({ user: 'me', token: async () => 'tok', tick: 0 })
  return <FriendsPanel friends={friends} lang="en" />
}

const bench: Bench = { id: 'university:1', kind: 'tapri', at: { x: 0, z: 0 }, rot: 0 }
function Seated() {
  const friends = useFriends({ user: 'me', token: async () => 'tok', tick: 0 })
  return <ChaiInvite bench={bench} friends={friends} lang="en" token={async () => 'tok'} />
}

async function mount(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(node))
  await settle()
  const button = (name: string | RegExp) =>
    [...host.querySelectorAll('button')].find((b) =>
      (b.getAttribute('aria-label') ?? b.textContent ?? '').match(name),
    )!
  const click = (el: Element) =>
    act(async () => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  return { host, button, click }
}

it('a friend shows "in the lanes · <district>" only when the server says so; anyone else, just the name', async () => {
  const { host } = await mount(<Panel />)
  const rows = [...host.querySelectorAll('.friends-list li')].map((li) => li.textContent)
  expect(rows[0]).toBe('Asha' + 'in the lanes · University & JKK' + 'Remove')
  // Ravi is away, or sharing is off, or anything else: the row says nothing about which
  expect(rows[1]).toBe('RaviRemove')
  expect(host.textContent).not.toMatch(/offline|away|hidden/i)
  // an ask still waiting reads as waiting (a no is never shown)
  expect(rows[2]).toBe('Kabir · waiting for a yes')
})

it('answers an ask, removes a friend after a second tap, and flips the switches', async () => {
  const { host, button, click } = await mount(<Panel />)
  expect(host.textContent).toContain('Want to be friends')
  await click(button(/^Yes$/))
  await settle()
  expect(calls).toContain('POST /api/friends/u-meera/accept')
  expect(host.textContent).not.toContain('Want to be friends')
  expect(host.textContent).toContain('Meera')
  // Remove asks once more before it goes
  await click(button('Remove Ravi as a friend'))
  expect(calls).not.toContain('DELETE /api/friends/u-ravi')
  await click(button(/Yes, remove/))
  await settle()
  expect(calls).toContain('DELETE /api/friends/u-ravi')
  expect(host.textContent).not.toContain('Ravi')
  // "Show my friends when I'm in the lanes", on by default: off
  const show = host.querySelector<HTMLInputElement>('input[data-field=showPresence]')!
  expect(show.checked).toBe(true)
  expect(host.querySelector<HTMLInputElement>('input[data-field=chaiInvites]')!.checked).toBe(true)
  await click(show)
  await settle()
  expect(bodies['PUT /api/me/friend-settings']).toEqual({ showPresence: false })
  expect(host.querySelector<HTMLInputElement>('input[data-field=showPresence]')!.checked).toBe(false)
})

it(`open, the list looks again every ${FRIENDS_POLL_MS / 1000} s, and stops once closed`, async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  function Toggle() {
    const [open, setOpen] = useState(true)
    const friends = useFriends({ user: 'me', token: async () => 'tok', tick: 0 })
    return (
      <>
        <button type="button" onClick={() => setOpen(false)}>
          shut
        </button>
        {open && <FriendsPanel friends={friends} lang="en" />}
      </>
    )
  }
  const { button, click } = await mount(<Toggle />)
  const reads = () => calls.filter((c) => c === 'GET /api/friends').length
  expect(reads()).toBe(1)
  await act(async () => void vi.advanceTimersByTime(FRIENDS_POLL_MS))
  await settle()
  expect(reads()).toBe(2)
  await click(button(/shut/))
  await act(async () => void vi.advanceTimersByTime(3 * FRIENDS_POLL_MS))
  await settle()
  expect(reads()).toBe(2)
})

it('Chai pe bulao: pick a friend, the invite names this bench, and "Invite sent" is all it ever says', async () => {
  const { host, button, click } = await mount(<Seated />)
  await click(button(/Invite for chai/))
  await settle()
  expect(host.textContent).toContain('Who would you like to invite?')
  await click(button('Invite Asha for chai'))
  await settle()
  expect(bodies['POST /api/chai']).toEqual({ to: 'u-asha', bench: 'university:1', kind: 'tapri' })
  expect(host.querySelector('.chai-note')!.textContent).toBe('Invite sent')
  // too many: a line of its own, and no general "slow down"
  chaiReply = () => json({ error: 'rate' }, 429)
  await click(button(/Invite for chai/))
  await settle()
  await click(button('Invite Ravi for chai'))
  await settle()
  expect(host.querySelector('.chai-note')!.textContent).toBe("Hold on: you've sent enough invites for now.")
})

it('with no friends yet, the picker says how to make one', async () => {
  lists = { ...lists, friends: [] }
  const { host, button, click } = await mount(<Seated />)
  await click(button(/Invite for chai/))
  await settle()
  expect(host.textContent).toContain('No friends yet. Tap "Be friends" in a chat')
})

it('a chat\'s menu offers "Be friends" until it is asked, then says where it stands', async () => {
  const ravi: PublicPerson = {
    id: 'u-ravi',
    name: 'Ravi',
    look: { skin: 1, outfit: 'pink', head: 'none' },
    status: '',
  }
  const onBefriend = vi.fn(async () => 'asked' as const)
  function Chat({ friend }: { friend: 'asked' | 'friends' | null }) {
    return (
      <ChatView
        matchId="m1"
        person={ravi}
        lang="en"
        token={async () => 'tok'}
        tick={0}
        onRead={() => {}}
        onBack={() => {}}
        onUnmatch={async () => true}
        friend={friend}
        onBefriend={onBefriend}
      />
    )
  }
  const { host, button, click } = await mount(<Chat friend={null} />)
  await click(button(/^More$/))
  await click(button(/Be friends/))
  await settle()
  expect(onBefriend).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain('Friend request sent.')
  const asked = await mount(<Chat friend="asked" />)
  await asked.click(asked.button(/^More$/))
  expect(asked.host.textContent).toContain('Ravi · waiting for a yes')
  expect(asked.button(/Be friends/)).toBeUndefined()
  const done = await mount(<Chat friend="friends" />)
  await done.click(done.button(/^More$/))
  expect(done.host.textContent).toContain("You're friends")
})

it('a switch moves at once, and goes back with a note when the save fails', async () => {
  const { host, click } = await mount(<Panel />)
  const fetcher = vi.mocked(fetch)
  const real = fetcher.getMockImplementation()!
  let release: (r: Response) => void = () => {}
  fetcher.mockImplementation(async (url, init) =>
    String(url).endsWith('/api/me/friend-settings')
      ? new Promise<Response>((r) => (release = r))
      : real(url as string, init),
  )
  const box = () => host.querySelector<HTMLInputElement>('input[data-field=chaiInvites]')!
  await click(box())
  expect(box().checked).toBe(false)
  await act(async () => release(json({ error: 'rate' }, 429)))
  await settle()
  expect(box().checked).toBe(true)
  expect(host.textContent).toContain("Couldn't save that. Try again.")
})
