// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { Me } from '../net/protocol'
import { InviteSheet } from './InviteSheet'
import { shareCode, showCode } from './inviteShare'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const meOf = (verified: boolean): Me => ({ id: 'u', profile: null, complete: true, verified })

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function mount(verified: boolean, over: Partial<Parameters<typeof InviteSheet>[0]> = {}) {
  const host = document.body.appendChild(document.createElement('div'))
  const props = {
    me: meOf(verified),
    lang: 'en' as const,
    token: async () => 'tok',
    onVerified: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  await act(async () => createRoot(host).render(<InviteSheet {...props} />))
  await act(async () => undefined)
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!
  const type = async (text: string) =>
    act(async () => {
      const input = host.querySelector('input')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const submit = async () => {
    await act(async () => host.querySelector('form')!.requestSubmit())
    await act(async () => undefined)
  }
  return { host, props, button, type, submit }
}

it('shows a code as XXXX-XXXX', () => expect(showCode('ABCD1234')).toBe('ABCD-1234'))

it('a code is sent as typed, and success turns the sheet into the member view', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/redeem')
      ? json(meOf(true))
      : json({
          codes: [
            { code: 'AAAA1111', used: false },
            { code: 'BBBB2222', used: true },
          ],
        }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const { host, props, button, type, submit } = await mount(false)
  expect(button('Use code').disabled).toBe(true)
  await type('abcd-1234')
  await submit()
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toContain('/api/invites/redeem')
  expect(JSON.parse(init.body as string)).toEqual({ code: 'abcd-1234' })
  expect(props.onVerified).toHaveBeenCalledWith(meOf(true))
  expect(host.textContent).toContain("you're verified")
  expect(host.textContent).toContain('AAAA-1111')
  expect(host.textContent).toContain('used')
  expect(host.querySelector('input')).toBeNull()
})

it.each([
  ['bad-code', 404, "couldn't find that code"],
  ['used', 410, 'already been used'],
  ['own-code', 403, 'your own code'],
  ['already-verified', 409, 'already verified'],
  ['rate', 429, 'Too many tries'],
  ['weird', 500, "didn't work"],
])('%s says so and keeps the text', async (error, status, text) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ error }, status)),
  )
  const { host, props, type, submit } = await mount(false)
  await type('ZZZZZZZZ')
  await submit()
  expect(host.textContent).toContain(text)
  expect(host.querySelector('input')!.value).toBe('ZZZZZZZZ')
  expect(props.onVerified).not.toHaveBeenCalled()
})

it('a network failure is a plain failure, and the button works again', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(new Error('offline'))),
  )
  const { host, button, type, submit } = await mount(false)
  await type('ZZZZZZZZ')
  await submit()
  expect(host.textContent).toContain("didn't work")
  expect(button('Use code').disabled).toBe(false)
})

it('a verified member sees their codes, and share hands over the bilingual text', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ codes: [{ code: 'AAAA1111', used: false }] })),
  )
  const share = vi.fn(async () => undefined)
  vi.stubGlobal('navigator', { share })
  const { host, button } = await mount(true)
  expect(host.querySelector('input')).toBeNull()
  await act(async () => button('Share').click())
  expect(share).toHaveBeenCalledWith({ text: 'Come to Gulabi Gali — my invite code: AAAA-1111' })
})

it('share falls back to the clipboard, and says when both fail', async () => {
  const writeText = vi.fn(async () => undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  expect(await shareCode('AAAA1111', 'hi')).toBe('copied')
  expect(writeText).toHaveBeenCalledWith('Gulabi Gali pe aao — mera invite code: AAAA-1111')

  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('no'))) } })
  expect(await shareCode('AAAA1111', 'en')).toBe('failed')
  vi.stubGlobal('navigator', {})
  expect(await shareCode('AAAA1111', 'en')).toBe('failed')
})

it('share falls back when the share sheet is unavailable, and a dismissed sheet is not a failure', async () => {
  const writeText = vi.fn(async () => undefined)
  vi.stubGlobal('navigator', {
    share: vi.fn(async () => Promise.reject(new DOMException('no', 'NotAllowedError'))),
    clipboard: { writeText },
  })
  expect(await shareCode('AAAA1111', 'en')).toBe('copied')
  vi.stubGlobal('navigator', {
    share: vi.fn(async () => Promise.reject(new DOMException('cancel', 'AbortError'))),
    clipboard: { writeText },
  })
  writeText.mockClear()
  expect(await shareCode('AAAA1111', 'en')).toBe('cancelled')
  expect(writeText).not.toHaveBeenCalled()
})

it('both failing shows the code to send by hand', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ codes: [{ code: 'AAAA1111', used: false }] })),
  )
  vi.stubGlobal('navigator', {})
  const { host, button } = await mount(true)
  await act(async () => button('Share').click())
  await act(async () => undefined)
  expect(host.textContent).toContain('send it by hand')
  expect(host.textContent).toContain('AAAA-1111')
})
