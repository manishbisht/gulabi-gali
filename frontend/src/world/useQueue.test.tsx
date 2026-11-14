// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ADMITTED_MS, useQueue } from './useQueue'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => vi.useRealTimers())

function mount() {
  const out = {} as ReturnType<typeof useQueue>
  function Probe() {
    Object.assign(out, useQueue())
    return null
  }
  act(() => createRoot(document.createElement('div')).render(<Probe />))
  return out
}

it('shows the card while waiting, until dismissed; a new wait shows it again', () => {
  const q = mount()
  expect(q.position).toBeNull()
  expect(q.card).toBe(false)
  act(() => q.queued(3, false))
  expect(q.position).toBe(3)
  expect(q.card).toBe(true)
  act(() => q.dismiss())
  expect(q.card).toBe(false)
  // Moving up the line keeps it dismissed; the chip still knows the number.
  act(() => q.queued(2, false))
  expect(q.card).toBe(false)
  expect(q.position).toBe(2)
  act(() => q.reopen())
  expect(q.card).toBe(true)
})

it('getting in clears the wait and says so for a while; leaving the line otherwise says nothing', () => {
  vi.useFakeTimers()
  const q = mount()
  act(() => q.queued(1, false))
  act(() => q.queued(null, true))
  expect(q.position).toBeNull()
  expect(q.card).toBe(false)
  expect(q.admitted).toBe(true)
  act(() => void vi.advanceTimersByTime(ADMITTED_MS))
  expect(q.admitted).toBe(false)
  // Signed out while waiting: no "you're in".
  act(() => q.queued(2, false))
  act(() => q.queued(null, false))
  expect(q.admitted).toBe(false)
  // Welcomed as a resident with no wait before it: nothing to say either.
  act(() => q.queued(null, true))
  expect(q.admitted).toBe(false)
})
