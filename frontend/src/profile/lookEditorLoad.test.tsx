// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LookEditor } from './lazyLookEditor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The dressing room's chunk: gone on the server (a deploy since the tab opened), or a dropped connection. */
const chunk = vi.hoisted(() => ({ fail: true }))
vi.mock('./LookEditor', async (original) => {
  if (chunk.fail) throw new Error('Failed to fetch dynamically imported module')
  return original()
})

let root: Root
let host: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  // React reports the caught error; that is expected here
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const LOOK = { skin: 1, outfit: 'teal', head: 'cap' } as const

it('a dressing room that cannot load says so and closes itself; the page around it carries on', async () => {
  const onCancel = vi.fn()
  await act(async () =>
    root.render(
      <main>
        <p id="city">the city</p>
        <LookEditor look={LOOK} lang="hi" mode="local" onSave={() => true} onCancel={onCancel} />
      </main>,
    ),
  )
  await act(async () => vi.advanceTimersByTimeAsync(50))
  const line = host.querySelector('[role="alert"]')
  expect(line?.textContent).toBe('Kapde badalne wala panna khul nahi paya. Thodi der mein phir try karo.')
  expect(host.querySelector('#city')).not.toBeNull()
  expect(onCancel).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(4000))
  expect(onCancel).toHaveBeenCalledTimes(1)
})

it('the next open fetches it afresh, and it opens once the chunk is there', async () => {
  const onCancel = vi.fn()
  const editor = (lang: 'en') => (
    <LookEditor look={LOOK} lang={lang} mode="local" onSave={() => true} onCancel={onCancel} />
  )
  await act(async () => root.render(editor('en')))
  await act(async () => vi.advanceTimersByTimeAsync(50))
  expect(host.textContent).toContain("Couldn't open the dressing room. Try again in a moment.")
  await act(async () => root.render(null))

  chunk.fail = false
  vi.resetModules() // what a fresh fetch of the chunk gets
  await act(async () => root.render(editor('en')))
  await vi.waitFor(async () => {
    await act(async () => vi.advanceTimersByTimeAsync(50))
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  })
  expect(host.querySelector('[role="dialog"]')!.textContent).toContain('Your look')
})
