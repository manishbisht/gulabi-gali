import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return e.preventDefault()
      const at = document.activeElement
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
    }
  }, [])
  return ref
}
