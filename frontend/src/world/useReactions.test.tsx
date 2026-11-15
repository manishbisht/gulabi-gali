// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { REACT_PAIR_MS } from '../net/protocol'
import { ReactionToast } from '../ui/ReactionToast'
import { REPEAT_MS, useReactions } from './useReactions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function mountHook() {
  const out = {} as ReturnType<typeof useReactions>
  function Probe() {
    Object.assign(out, useReactions())
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe />))
  return { out, unmount: () => act(() => root.unmount()) }
}

const asha = { id: 'dev:asha', name: 'Asha' }

it('a greeting goes through the session; offline or too far is said at once', () => {
  const { out } = mountHook()
  const react = vi.fn().mockReturnValueOnce(null).mockReturnValueOnce('far')
  act(() => out.bind({ react }))
  act(() => out.react('dev:asha', 'wave'))
  expect(react).toHaveBeenCalledWith('dev:asha', 'wave')
  expect(out.notice).toBeNull()
  act(() => out.react('dev:asha', 'namaste'))
  expect(out.notice).toEqual({ t: 'no', why: 'far' })
  act(() => out.bind(null))
  act(() => out.react('dev:asha', 'wave'))
  expect(out.notice).toEqual({ t: 'no', why: 'offline' })
})

it("the server's word that it went rests the buttons for that person until the pair's wait is over", () => {
  const { out } = mountHook()
  act(() => out.hooks.sent('dev:asha', 'namaste'))
  expect(out.sent).toEqual({ 'dev:asha': 'namaste' })
  act(() => vi.advanceTimersByTime(REACT_PAIR_MS - 1))
  expect(out.sent['dev:asha']).toBe('namaste')
  act(() => vi.advanceTimersByTime(1))
  expect(out.sent['dev:asha']).toBeUndefined()
})

it('a refusal is a passing notice', () => {
  const { out } = mountHook()
  act(() => out.hooks.refused('dev:asha', 'wait'))
  expect(out.notice).toEqual({ t: 'no', why: 'wait' })
  act(() => vi.advanceTimersByTime(5000))
  expect(out.notice).toBeNull()
})

it('a greeting is a gentle toast; the third from one person in a few minutes offers a block', () => {
  const { out } = mountHook()
  act(() => out.hooks.got(asha, 'namaste'))
  expect(out.notice).toEqual({ t: 'got', id: 'dev:asha', name: 'Asha', kind: 'namaste', again: false })
  act(() => vi.advanceTimersByTime(40_000))
  expect(out.notice).toBeNull()
  act(() => out.hooks.got(asha, 'wave'))
  expect(out.notice).toMatchObject({ kind: 'wave', again: false })
  act(() => vi.advanceTimersByTime(40_000))
  act(() => out.hooks.got(asha, 'wave'))
  expect(out.notice).toMatchObject({ again: true })
  // with a block on offer it stays up longer
  act(() => vi.advanceTimersByTime(5000))
  expect(out.notice).toMatchObject({ again: true })
  act(() => out.dismiss())
  expect(out.notice).toBeNull()
})

it('greetings further apart than the window, or from different people, never add up', () => {
  const { out } = mountHook()
  act(() => out.hooks.got(asha, 'wave'))
  act(() => out.hooks.got({ id: 'dev:ravi', name: 'Ravi' }, 'wave'))
  act(() => vi.advanceTimersByTime(REPEAT_MS))
  act(() => out.hooks.got(asha, 'wave'))
  act(() => out.hooks.got(asha, 'wave'))
  expect(out.notice).toMatchObject({ id: 'dev:asha', again: false })
})

it('unmounting clears its timers', () => {
  const { out, unmount } = mountHook()
  act(() => out.hooks.sent('dev:asha', 'wave'))
  act(() => out.hooks.got(asha, 'wave'))
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

function toast(notice: Parameters<typeof ReactionToast>[0]['notice'], lang: 'hi' | 'en' = 'en') {
  const host = document.body.appendChild(document.createElement('div'))
  const onBlock = vi.fn()
  act(() => createRoot(host).render(<ReactionToast notice={notice} lang={lang} onBlock={onBlock} />))
  return { host, onBlock }
}

it('the toast names who greeted, and offers the block only when it keeps happening', () => {
  const { host } = toast({ t: 'got', id: 'dev:asha', name: 'Asha', kind: 'namaste', again: false })
  expect(host.querySelector('[role="status"]')!.textContent).toBe('Asha says namaste 🙏')
  expect(host.querySelector('button')).toBeNull()
  const again = toast({ t: 'got', id: 'dev:asha', name: 'Asha', kind: 'wave', again: true }, 'hi')
  expect(again.host.textContent).toContain('Asha aapko dekh ke haath hila rahe hain 👋')
  const button = again.host.querySelector('button')!
  expect(button.getAttribute('aria-label')).toBe('Asha ko block karo')
  act(() => button.click())
  expect(again.onBlock).toHaveBeenCalledWith('dev:asha', 'Asha')
})

it('a refusal says why, never whether a block was the reason', () => {
  expect(toast({ t: 'no', why: 'far' }).host.textContent).toContain('8 metres')
  expect(toast({ t: 'no', why: 'gone' }).host.textContent).toBe("They're not around here any more")
})
