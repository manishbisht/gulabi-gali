// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { ChatMessage, PublicPerson } from '../net/protocol'
import { ChatView } from './ChatView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ravi: PublicPerson = {
  id: 'p2',
  name: 'Ravi',
  look: { skin: 2, outfit: 'sandstone', head: 'none' },
  status: '',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const msg = (id: string, body: string, mine = false): ChatMessage => ({
  id,
  body,
  at: Number(id.slice(1)),
  mine,
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

async function mount(post: (body: string) => Response) {
  const newest = [msg('m3', '<b>hi</b> there'), msg('m4', 'second')]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return post(JSON.parse(init.body as string).body)
      if (url.includes('before=c1'))
        return json({ messages: [msg('m1', 'oldest'), msg('m2', 'older')], before: null })
      return json({ messages: newest, before: 'c1' })
    }),
  )
  const host = document.body.appendChild(document.createElement('div'))
  const onRead = vi.fn()
  await act(async () =>
    createRoot(host).render(
      <ChatView
        matchId="m"
        person={ravi}
        lang="en"
        token={async () => 'tok'}
        tick={0}
        onRead={onRead}
        onBack={() => {}}
        onUnmatch={async () => true}
      />,
    ),
  )
  await settle()
  const input = () => host.querySelector('input')!
  const type = (text: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text)
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
  const send = async () => {
    await act(
      async () =>
        void host
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
    await settle()
  }
  return { host, onRead, input, type, send }
}

it('shows messages as text, pages older ones in, and marks the newest read', async () => {
  const { host, onRead } = await mount(() => json({}))
  expect(host.querySelector('.chat-line')!.textContent).toBe('<b>hi</b> there')
  expect(host.querySelector('b')).toBeNull()
  expect(onRead).toHaveBeenCalledWith('m4')
  const older = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Show older')!
  await act(async () => void older.click())
  await settle()
  expect([...host.querySelectorAll('.chat-line')].map((l) => l.textContent)).toEqual([
    'oldest',
    'older',
    '<b>hi</b> there',
    'second',
  ])
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Show older')).toBe(false)
})

it('sends, confirms, and on a 429 keeps the text with a gentle note', async () => {
  let limited = true
  const { host, input, type, send } = await mount((body) =>
    limited ? json({ error: 'rate' }, 429) : json(msg('m9', body, true), 201),
  )
  await type('chai?')
  await send()
  expect(input().value).toBe('chai?')
  expect(host.querySelector('.chat-note')!.textContent).toContain('one message a second')
  expect([...host.querySelectorAll('.chat-line')].some((l) => l.textContent === 'chai?')).toBe(false)

  limited = false
  await send()
  expect(input().value).toBe('')
  expect(host.querySelector('.chat-note')).toBeNull()
  expect(host.querySelector('.chat-line[data-mine]')!.textContent).toBe('chai?')
})
