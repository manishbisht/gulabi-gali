// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { LivePerson, Me } from '../net/protocol'
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
  expect(onBlock).toHaveBeenCalledWith(ravi, false)
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
  const blocked = [{ id: 'p9', name: 'Meera' }]
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

it('ProfileSheet: Report next to Unblock files a report about the person you blocked', async () => {
  const calls: { path: string; body?: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/api/, '')
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return path === '/reports' ? json({ autoHidden: false }, 201) : json([{ id: 'p9', name: 'Meera' }])
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
  await act(async () => button(host.querySelector('.blocked-list')!, 'Report').click())
  const form = host.querySelector('[role="dialog"][aria-label="Report Meera"]')!
  // already blocked: no "Also block?"
  expect(form.textContent).not.toContain('Also block?')
  await act(async () => button(form as HTMLElement, 'Spam').click())
  await act(async () => button(form as HTMLElement, 'Send report').click())
  await settle()
  expect(calls.find((c) => c.path === '/reports')?.body).toEqual({
    kind: 'person',
    targetId: 'p9',
    reason: 'spam',
  })
})

it('BlockConfirm: "Also report?" blocks at once, then opens the report; cancelling it leaves the block', async () => {
  const sent: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/reports')) {
        sent.push(JSON.parse(String(init!.body)))
        return json({ autoHidden: false }, 201)
      }
      return json({ ...ravi, homeArea: 'Raja Park', about: '', pauseRequests: false })
    }),
  )
  const onBlock = vi.fn(async () => true)
  const onClose = vi.fn()
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
        onClose={onClose}
      />,
    ),
  )
  await settle()
  await act(async () => button(host, 'Block').click())
  const ask = host.querySelector('[role="alertdialog"]')!
  const box = [...ask.querySelectorAll('label')].find((l) => l.textContent === 'Also report?')!
  await act(async () => box.querySelector('input')!.click())
  // the same plain block button, ticked or not
  await act(async () => button(ask as HTMLElement, 'Yes, block').click())
  await settle()
  // blocked first, at once, and told to keep the card up for the report
  expect(onBlock).toHaveBeenCalledOnce()
  expect(onBlock).toHaveBeenCalledWith(ravi, true)
  const form = host.querySelector('[role="dialog"][aria-label="Report Ravi"]')!
  expect(form).not.toBeNull()
  // already blocked: no "Also block?" in the form
  expect(form.textContent).not.toContain('Also block?')
  // cancelled: nothing reported, the block stands (no unblock), and the card closes as a block would close it
  await act(async () => button(form as HTMLElement, 'Never mind').click())
  expect(sent).toEqual([])
  expect(onBlock).toHaveBeenCalledOnce()
  expect(onClose).toHaveBeenCalledOnce()
})

it('BlockConfirm: a block that fails opens no report form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ ...ravi, homeArea: 'Raja Park', about: '', pauseRequests: false })),
  )
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
        onBlock={async () => false}
        onClose={() => {}}
      />,
    ),
  )
  await settle()
  await act(async () => button(host, 'Block').click())
  const ask = host.querySelector('[role="alertdialog"]')!
  await act(async () => [...ask.querySelectorAll('input')][0]!.click())
  await act(async () => button(ask as HTMLElement, 'Yes, block').click())
  await settle()
  expect(host.textContent).toContain("Couldn't block")
  expect(host.querySelector('[role="dialog"][aria-label="Report Ravi"]')).toBeNull()
})
