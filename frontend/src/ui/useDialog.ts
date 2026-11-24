import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Tab can land on it: not hidden, not inert, not display:none or visibility:hidden (itself or an ancestor). */
function reachable(el: HTMLElement): boolean {
  if (el.closest('[inert], [hidden]')) return false
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (getComputedStyle(n).display === 'none') return false
  }
  return getComputedStyle(el).visibility !== 'hidden'
}

/**
 * The stops Tab makes in `dialog`, in order. A group of radios (one `name`) is one stop, as the browser makes
 * it: its checked radio, else its first; the arrow keys move within it.
 */
function tabStops(dialog: HTMLElement): HTMLElement[] {
  const all = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(reachable)
  const stop = new Map<string, HTMLInputElement>()
  for (const el of all) {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) continue
    if (!stop.has(el.name) || el.checked) stop.set(el.name, el)
  }
  return all.filter(
    (el) => !(el instanceof HTMLInputElement && el.type === 'radio' && el.name) || stop.get(el.name) === el,
  )
}

/** Where focus goes when the control that opened a dialog is gone: the first button of the HUD, if any. */
const fallbackHome = () => document.querySelector<HTMLElement>('.hud button:not([disabled])')

/** The dialogs open now, oldest first: only the last answers the keyboard (a sheet can open over a sheet). */
const open: object[] = []

/**
 * A modal dialog's keyboard: focus moves into it when it opens (to the dialog itself, so a phone's keyboard
 * stays down), Tab and Shift+Tab stay inside it, Escape closes it, and focus goes back to where it was when it
 * goes. Put the returned ref on the dialog's element. `onClose` may change between renders.
 */
export function useDialog<T extends HTMLElement>(onClose: () => void): RefObject<T | null> {
  const ref = useRef<T>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => void (onCloseRef.current = onClose))

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const me = {}
    open.push(me)
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1
    dialog.focus()
    const onKey = (e: KeyboardEvent) => {
      if (open[open.length - 1] !== me) return
      if (e.key === 'Escape') {
        e.preventDefault() // a hint or a game under it sees that this Escape was spent
        return onCloseRef.current()
      }
      if (e.key !== 'Tab') return
      const items = tabStops(dialog)
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return e.preventDefault()
      const focused = document.activeElement
      // a radio stands for its group's stop
      const at =
        focused instanceof HTMLInputElement && focused.type === 'radio' && focused.name
          ? (items.find((i) => i instanceof HTMLInputElement && i.name === focused.name) ?? focused)
          : focused
      if (!dialog.contains(at) || at === dialog) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && at === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && at === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      open.splice(open.indexOf(me), 1)
      if (before?.isConnected && before !== document.body) before.focus()
      else fallbackHome()?.focus() // the opener went away (a chip that re-rendered): never fall to <body>
    }
  }, [])
  return ref
}
