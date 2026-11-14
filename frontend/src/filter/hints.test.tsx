// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { hintFlagged, resetHints } from './hints'
import { WordsHint } from './WordsHint'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sha1 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

// A placeholder word only: the real list never reaches a test, or the page.
const serve = async () =>
  vi.fn(async () => new Response(JSON.stringify({ hashes: [await sha1('badword'), await sha1('~badword')] })))

beforeEach(() => resetHints())
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

it('flags what the hashed list holds, spaced, leet or stretched, and nothing else', async () => {
  vi.stubGlobal('fetch', await serve())
  for (const s of ['badword', 'B4DW0RD!', 'b a d w o r d', 'baaadword'])
    expect(await hintFlagged(s), s).toBe(true)
  for (const s of ['badwords', 'gandalf', 'chai pe aao', '   ', ''])
    expect(await hintFlagged(s), s).toBe(false)
})

it('fails open: no list, a bad answer or a thrown fetch means no hint', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('nope', { status: 500 })),
  )
  expect(await hintFlagged('badword')).toBe(false)
  resetHints()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"hashes":"x"}')),
  )
  expect(await hintFlagged('badword')).toBe(false)
  resetHints()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(new Error('offline'))),
  )
  expect(await hintFlagged('badword')).toBe(false)
})

it('fetches the list once, and waits a minute before asking again after a failure', async () => {
  const ok = await serve()
  vi.stubGlobal('fetch', ok)
  await hintFlagged('one')
  await hintFlagged('two')
  expect(ok).toHaveBeenCalledTimes(1)
  resetHints()
  const down = vi.fn(async () => Promise.reject(new Error('offline')))
  vi.stubGlobal('fetch', down)
  await hintFlagged('one')
  await hintFlagged('two')
  expect(down).toHaveBeenCalledTimes(1)
})

it('WordsHint shows its line in both languages, after a pause, only for a flagged text', async () => {
  vi.stubGlobal('fetch', await serve())
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const show = async (text: string, lang: 'hi' | 'en') => {
    await act(async () => root.render(<WordsHint text={text} lang={lang} />))
    await act(async () => new Promise((r) => setTimeout(r, 450)))
  }
  await show('chai pe aao', 'en')
  expect(host.textContent).toBe('')
  await show('you b4dword', 'en')
  expect(host.textContent).toContain('respectful')
  await show('you b4dword', 'hi')
  expect(host.textContent).toContain('Izzat se likhiye')
  await show('', 'en')
  expect(host.textContent).toBe('')
  await act(async () => root.unmount())
})
