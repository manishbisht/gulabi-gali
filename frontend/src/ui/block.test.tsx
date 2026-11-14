// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { LivePerson, Me, PublicPerson } from '../net/protocol'
import { ProfileSheet } from '../profile/ProfileSheet'
import { PersonCard } from './PersonCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ravi: LivePerson = {
  id: 'p2',
  name: 'Ravi',
  look: { skin: 2, outfit: 'sandstone', head: 'none' },
  status: 'chai',
  x: 0,
  z: 0,
  ry: 0,
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label)!

it('PersonCard: Block asks in the sheet first, and blocks only on the yes', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ ...ravi, homeArea: 'Raja Park', about: '', pauseRequests: false })),
  )
  const confirm = vi.fn()
  vi.stubGlobal('confirm', confirm)
  const onBlock = vi.fn(async () => true)
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () =>
    createRoot(host).render(
      <PersonCard
        person={ravi}
        gone={false}
        viewer="verified"
        lang="en"
        token={async () => 'tok'}
        onVisible={() => {}}
        onGetVerified={() => {}}
        onRequest={() => {}}
        onBlock={onBlock}
        onClose={() => {}}
      />,
    ),
  )
  await settle()
  await act(async () => button(host, 'Block').click())
  expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "Block Ravi? You won't see each other",
  )
  expect(onBlock).not.toHaveBeenCalled()
  await act(async () => button(host, 'Never mind').click())
  expect(host.querySelector('[role="alertdialog"]')).toBeNull()
  await act(async () => button(host, 'Block').click())
  await act(async () => button(host, 'Yes, block').click())
  expect(onBlock).toHaveBeenCalledWith(ravi)
  expect(confirm).not.toHaveBeenCalled()
})

it('PersonCard: a failed block keeps the sheet and says so', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({}, 404)),
  )
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () =>
    createRoot(host).render(
      <PersonCard
        person={ravi}
        gone={false}
        viewer="resident"
        lang="en"
        token={async () => 'tok'}
        onVisible={() => {}}
        onGetVerified={() => {}}
        onRequest={() => {}}
        onBlock={async () => false}
        onClose={() => {}}
      />,
    ),
  )
  await settle()
  await act(async () => button(host, 'Block').click())
  await act(async () => button(host, 'Yes, block').click())
  expect(host.textContent).toContain("Couldn't block")
})

it('ProfileSheet lists the people you blocked by first name, and Unblock removes one', async () => {
  const blocked: PublicPerson[] = [{ id: 'p9', name: 'Meera', look: ravi.look, status: '' }]
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace(/^.*\/api/, '')}`)
      return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json(blocked)
    }),
  )
  const me: Me = {
    id: 'u',
    complete: true,
    verified: true,
    profile: {
      id: 'u',
      name: 'Asha Sharma',
      look: ravi.look,
      status: '',
      homeArea: 'Raja Park',
      hereFor: null,
      about: '',
      pauseRequests: false,
    },
  }
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () =>
    createRoot(host).render(
      <ProfileSheet
        me={me}
        lang="en"
        token={async () => 'tok'}
        onSave={async () => ({ ok: true })}
        onClose={() => {}}
        onSignOut={() => {}}
      />,
    ),
  )
  await settle()
  expect(host.querySelector('.blocked-list')?.textContent).toContain('Meera')
  await act(async () => button(host, 'Unblock').click())
  expect(calls).toContain('DELETE /blocks/p9')
  expect(host.querySelector('.blocked-list')?.textContent).toContain("You haven't blocked anyone")
})
