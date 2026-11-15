import { useId, useLayoutEffect, useRef, useState } from 'react'
import { t, type Lang } from '../i18n/strings'
import { storage } from '../storage'

/** Set once the hint has been closed: it is never shown again on this browser. */
export const HINTED_KEY = 'gg-hinted'

/** The street: where focus goes when the hint closes (the canvas is not otherwise focusable). */
function stageEl(): HTMLElement | null {
  const canvas = document.querySelector<HTMLElement>('canvas')
  if (canvas && !canvas.hasAttribute('tabindex')) canvas.tabIndex = -1
  return canvas
}

/**
 * Three short steps for a first visit, under the HUD once the city is open: how to walk (the joystick on a
 * touch screen, the keys with a keyboard and mouse), sitting on a chai bench, and meeting someone. Not modal:
 * the street stays walkable and tappable under it. Focus goes to its button, and to the street when it closes
 * (the button, or Escape). Closed once, `gg-hinted` keeps it closed.
 */
export function FirstHint({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(() => storage.get(HINTED_KEY) !== '1')
  const [touch] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
  const button = useRef<HTMLButtonElement>(null)
  const title = useId()

  // A layout effect: the Escape listener is on from the commit that shows the hint, so a key pressed before the
  // next paint (an effect would still be pending) is not lost.
  useLayoutEffect(() => {
    if (!open) return
    button.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // a sheet (or the kite game) over the street owns this Escape, even one that does not preventDefault
      if (document.querySelector('[aria-modal="true"]')) return
      storage.set(HINTED_KEY, '1')
      setOpen(false)
      stageEl()?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const close = () => {
    storage.set(HINTED_KEY, '1')
    setOpen(false)
    stageEl()?.focus()
  }
  return (
    <section className="landmark-card first-hint" role="dialog" aria-modal="false" aria-labelledby={title}>
      <h2 id={title}>{t('hintTitle', lang)}</h2>
      <ol>
        <li>{t(touch ? 'hintWalkTouch' : 'hintWalkKeys', lang)}</li>
        <li>{t(touch ? 'hintSitTouch' : 'hintSitKeys', lang)}</li>
        <li>{t(touch ? 'hintMeetTouch' : 'hintMeetMouse', lang)}</li>
      </ol>
      <button ref={button} type="button" className="first-hint-close" onClick={close}>
        {t('hintClose', lang)}
      </button>
    </section>
  )
}
