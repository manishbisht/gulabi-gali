// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDialog } from './useDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Sheet({ name, onClose }: { name: string; onClose: () => void }) {
  const ref = useDialog<HTMLElement>(onClose)
  return (
    <section ref={ref} role="dialog" aria-modal="true" aria-label={name}>
      <button id={`${name}-a`}>a</button>
      <input id={`${name}-b`} />
      <button id={`${name}-c`}>c</button>
    </section>
  )
}

let root: Root
beforeEach(() => {
  document.body.innerHTML = '<button id="opener">open</button><div id="app"></div>'
  root = createRoot(document.getElementById('app')!)
})
afterEach(() => act(() => root.unmount()))

const key = (k: string, shiftKey = false) => {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true })
  act(() => void document.activeElement?.dispatchEvent(e))
  return e
}
const el = (id: string) => document.getElementById(id)!

it('takes focus into the dialog, and gives it back to the opener when it closes', () => {
  el('opener').focus()
  act(() => root.render(<Sheet name="s" onClose={() => {}} />))
  expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'))
  act(() => root.render(null))
  expect(document.activeElement).toBe(el('opener'))
})

it('keeps Tab and Shift+Tab inside, wrapping at both ends', () => {
  act(() => root.render(<Sheet name="s" onClose={() => {}} />))
  el('s-c').focus()
  expect(key('Tab').defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(el('s-a'))
  expect(key('Tab', true).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(el('s-c'))
  // a Tab from the dialog itself (where focus starts) goes to the first control
  ;(document.querySelector('[role="dialog"]') as HTMLElement).focus()
  key('Tab')
  expect(document.activeElement).toBe(el('s-a'))
  // in the middle, the browser moves focus itself
  el('s-b').focus()
  expect(key('Tab').defaultPrevented).toBe(false)
})

it('Escape closes it, and says it was used', () => {
  const onClose = vi.fn()
  act(() => root.render(<Sheet name="s" onClose={onClose} />))
  expect(key('Escape').defaultPrevented).toBe(true)
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('with two stacked, only the top one answers Escape and holds Tab', () => {
  const lower = vi.fn()
  const upper = vi.fn()
  act(() =>
    root.render(
      <>
        <Sheet name="low" onClose={lower} />
        <Sheet name="up" onClose={upper} />
      </>,
    ),
  )
  key('Escape')
  expect(upper).toHaveBeenCalledTimes(1)
  expect(lower).not.toHaveBeenCalled()
  el('up-c').focus()
  key('Tab')
  expect(document.activeElement).toBe(el('up-a'))
})
