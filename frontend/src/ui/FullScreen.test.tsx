// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { FullScreen } from './FullScreen'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

async function mount(position: number, lang: 'hi' | 'en' = 'en') {
  const host = document.body.appendChild(document.createElement('div'))
  const onClose = vi.fn()
  const root = createRoot(host)
  await act(async () => root.render(<FullScreen position={position} lang={lang} onClose={onClose} />))
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)
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
  const rerender = (n: number) =>
    act(async () => root.render(<FullScreen position={n} lang={lang} onClose={onClose} />))
  return { host, onClose, button, type, submit, rerender }
}

it('says the city is full and where they stand, in either language, and keeps up with the line', async () => {
  const en = await mount(4)
  expect(en.host.textContent).toContain("Jaipur is full right now! You're number 4")
  // A card at the bottom, not a dialog: the city stays walkable behind it.
  expect(en.host.querySelector('[role="dialog"]')).toBeNull()
  await en.rerender(2)
  expect(en.host.textContent).toContain("You're number 2")
  document.body.innerHTML = ''
  const hi = await mount(7, 'hi')
  expect(hi.host.textContent).toContain('Jaipur full hai! Tumhara number: 7')
})

it('leaves an email on the waitlist, then hides the field', async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  const { host, button, type, submit } = await mount(3)
  await type('  asha@example.in ')
  await submit()
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toMatch(/\/api\/waitlist$/)
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body as string)).toEqual({ email: 'asha@example.in' })
  // No auth: someone waiting may have no account.
  expect(new Headers(init.headers).has('Authorization')).toBe(false)
  expect(host.querySelector('input')).toBeNull()
  expect(host.textContent).toContain("We'll let you know when there's room")
  expect(button('OK')).toBeDefined()
})

it('a bad email is said so, and a failure can be tried again', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid' }), { status: 400 }))
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  const { host, type, submit } = await mount(3)
  await type('asha@')
  await submit()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("That email doesn't look right.")
  expect(host.querySelector('input')).not.toBeNull()
  await type('asha@example.in')
  await submit()
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "Couldn't save that just now. Try again in a bit.",
  )
  await submit()
  expect(host.querySelector('input')).toBeNull()
})

it('closes without leaving the city', async () => {
  const { onClose, button } = await mount(1)
  await act(async () => button('OK')!.click())
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('the waitlist form says how long the email is kept', async () => {
  const en = await mount(3)
  expect(en.host.querySelector('form')!.textContent).toContain('deleted after 90 days')
  document.body.innerHTML = ''
  const hi = await mount(3, 'hi')
  expect(hi.host.querySelector('form')!.textContent).toContain('90 din')
})
