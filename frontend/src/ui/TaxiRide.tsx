import { useEffect, useRef } from 'react'
import { t, type Lang } from '../i18n/strings'
import { inertRest } from './inertRest'

interface Props {
  /** The landmark the auto heads for, in the page's language. */
  place: string
  lang: Lang
  onSkip: () => void
}

/**
 * Over the street while the auto-taxi rides: clear, so the drive shows, with where it is headed on a small
 * board at the top. Tapping anywhere (or Escape) skips. As with the metro's coach, focus sits on it, the rest of
 * the page is inert and the game hears no keys, and focus goes back where it was afterwards. The dark of getting
 * in and out is App's own `.fade`, which outlives this.
 */
export function TaxiRide({ place, lang, onSkip }: Props) {
  const button = useRef<HTMLButtonElement>(null)
  const onSkipRef = useRef(onSkip)
  useEffect(() => void (onSkipRef.current = onSkip))

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    button.current?.focus()
    const release = inertRest(button.current?.parentElement, (el) => el.hasAttribute('data-taxi-ride'))
    const block = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return
      if (e.key === 'Escape') onSkipRef.current()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', block, true)
    return () => {
      window.removeEventListener('keydown', block, true)
      release()
      const canvas = document.querySelector<HTMLElement>('canvas')
      if (canvas && !canvas.hasAttribute('tabindex')) canvas.tabIndex = -1
      const back = before && before.isConnected && before !== document.body ? before : canvas
      back?.focus()
    }
  }, [])

  const to = t('taxiTo', lang, { place })
  return (
    <>
      <button
        ref={button}
        type="button"
        data-taxi-ride=""
        className="taxi-ride"
        aria-label={t('taxiRide', lang)}
        onClick={onSkip}
      >
        <span className="taxi-board" aria-hidden="true">
          <span>{to}</span>
          <span className="metro-skip">{t('rideSkip', lang)}</span>
        </span>
      </button>
      <p role="status" data-taxi-ride="" className="visually-hidden">
        {to}
      </p>
    </>
  )
}
