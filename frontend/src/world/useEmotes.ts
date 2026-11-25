import { useCallback, useEffect, useState } from 'react'
import { EMOTE_KINDS, type EmoteKind } from '../net/protocol'

/**
 * The emote wheel as the page sees it: whether it is open, and picking one (which plays it and closes the
 * wheel). `can`: the player may emote now (on foot on the street); when not, the wheel is shut and the keys do
 * nothing. Keys: G opens and closes it, 1 to 5 pick while it is open and Escape shuts it; never while a text
 * field has the keys or a dialog is up.
 */
export function useEmotes(can: boolean, play: (kind: EmoteKind) => boolean) {
  const [wanted, setOpen] = useState(false)
  const open = wanted && can
  if (wanted && !can) setOpen(false)

  const pick = useCallback(
    (kind: EmoteKind) => {
      setOpen(false)
      play(kind)
    },
    [play],
  )

  useEffect(() => {
    if (!can) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const el = e.target
      if (el instanceof Element && el.closest('input, textarea, select, [contenteditable]')) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.code === 'KeyG') return setOpen((was) => !was)
      if (!open) return
      if (e.code === 'Escape') return setOpen(false)
      const kind = /^Digit[1-9]$/.test(e.code) ? EMOTE_KINDS[Number(e.code.slice(5)) - 1] : undefined
      if (kind) pick(kind)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [can, open, pick])

  const toggle = useCallback(() => setOpen((was) => !was), [])
  return { open, toggle, pick }
}
