// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanReason } from '../profile/reason'
import type { LivePerson } from '../net/protocol'
import { PersonCard } from './PersonCard'
import { RequestComposer } from './RequestComposer'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const asha: LivePerson = {
  id: 'p1',
  name: 'Asha',
  look: { skin: 2, outfit: 'sandstone', head: 'none' },
  status: 'chai pe aao',
  x: 1,
  z: 0,
  ry: 0,
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function mount(over: Partial<Parameters<typeof RequestComposer>[0]> = {}) {
  const host = document.body.appendChild(document.createElement('div'))
  const props = {
    person: asha,
    lang: 'en' as const,
    token: async () => 'tok',
    onDone: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  const root = createRoot(host)
  act(() => root.render(<RequestComposer {...props} />))
  const area = () => host.querySelector('textarea')!
  const send = () => [...host.querySelectorAll('button')].find((b) => b.type === 'submit')!
  const type = async (text: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(area(), text)
      area().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const submit = async () => {
    await act(async () => {
      send().click()
    })
    await act(async () => undefined)
  }
  return { host, props, area, send, type, submit }
}

it('cleans a reason like the server does', () => {
  expect(cleanReason('  hello\n‮  there, friend ')).toBe('hello there, friend')
  expect(cleanReason('short')).toBeNull()
  expect(cleanReason('x'.repeat(141))).toBeNull()
  expect(cleanReason('😀'.repeat(140))).not.toBeNull()
})

it('counts live, and Send waits for 10 characters', async () => {
  const { host, send, type } = mount()
  expect(host.textContent).toContain('0/140')
  expect(send().disabled).toBe(true)
  await type('too short')
  expect(host.textContent).toContain('9/140')
  expect(send().disabled).toBe(true)
  await type('long enough now')
  expect(host.textContent).toContain('15/140')
  expect(send().disabled).toBe(false)
})

it('sends the cleaned reason and reports done', async () => {
  const fetchMock = vi.fn(async () => json({ id: 'r1' }, 201))
  vi.stubGlobal('fetch', fetchMock)
  const { props, type, submit } = mount()
  await type('  Loved your sketches, chai?  ')
  await submit()
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toContain('/api/requests')
  expect(JSON.parse(init.body as string)).toEqual({ to: 'p1', reason: 'Loved your sketches, chai?' })
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  expect(props.onDone).toHaveBeenCalledWith('sent')
})

it('a crossed request reports a match', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ matched: 'm1' })),
  )
  const { props, type, submit } = mount()
  await type('Loved your sketches, chai?')
  await submit()
  expect(props.onDone).toHaveBeenCalledWith('matched')
})

it.each([
  ['already', 409, 'already have a request open'],
  ['paused', 409, "They're not taking requests right now"],
  ['ghost', 403, 'Be visible first'],
])('%s shows its own message and keeps the text', async (error, status, text) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ error }, status)),
  )
  const { host, props, area, type, submit } = mount()
  await type('Loved your sketches, chai?')
  await submit()
  expect(host.textContent).toContain(text)
  expect(area().value).toBe('Loved your sketches, chai?')
  expect(props.onDone).not.toHaveBeenCalled()
})

it('a network failure says so, and Send works again', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(new Error('offline'))),
  )
  const { host, send, type, submit } = mount()
  await type('Loved your sketches, chai?')
  await submit()
  expect(host.textContent).toContain("Couldn't send")
  expect(send().disabled).toBe(false)
})

it('the card confirms a sent request and disables "Say hello"', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () =>
    createRoot(host).render(
      <PersonCard
        person={asha}
        gone={false}
        viewer="resident"
        lang="en"
        sent="sent"
        token={async () => null}
        onVisible={() => undefined}
        onRequest={() => undefined}
        onClose={() => undefined}
      />,
    ),
  )
  expect(host.textContent).toContain('Sent!')
  const meet = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Say hello')!
  expect(meet.disabled).toBe(true)
})
