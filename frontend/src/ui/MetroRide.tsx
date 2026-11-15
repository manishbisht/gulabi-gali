import { useEffect, useRef, useState } from 'react'
import { t, type Lang } from '../i18n/strings'
import type { DistrictId } from '../net/protocol'
import { METRO_STATIONS } from '../world/metroRide'

/** Waiting at the next station this long offers a way back to the district left. */
export const STUCK_MS = 15_000

interface Props {
  from: DistrictId
  to: DistrictId
  lang: Lang
  /** The ride is over but the next district is still loading. */
  waiting: boolean
  onSkip: () => void
  /** Gives up on the trip; the district the player left stays. */
  onBack: () => void
}

/** Where focus goes when the ride ends: the stage, which is not otherwise focusable. */
function stage(): HTMLElement | null {
  const canvas = document.querySelector<HTMLElement>('canvas')
  if (canvas && !canvas.hasAttribute('tabindex')) canvas.tabIndex = -1
  return canvas
}

/**
 * The inside of a Pink Line coach, in CSS only, over the black screen. Tapping anywhere skips. Focus moves
 * onto the skip button while it shows (and onto "Go back" once the wait has dragged on), the game beneath is
 * inert and ignores keys, and focus comes back to where it was (or the stage) afterwards. The spoken status sits
 * beside the button, not in it.
 */
export function MetroRide({ from, to, lang, waiting, onSkip, onBack }: Props) {
  const button = useRef<HTMLButtonElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const onSkipRef = useRef(onSkip)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    button.current?.focus()
    // everything else on the page is inert while the coach is up; its own nodes (marked) are not
    const others = [...(button.current?.parentElement?.children ?? [])].filter(
      (el) => !el.hasAttribute('data-metro-ride'),
    )
    const was = others.map((el) => el.hasAttribute('inert'))
    others.forEach((el) => el.setAttribute('inert', ''))
    // the game listens on the window: keys other than Tab go no further than here
    const block = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return
      if (e.key === 'Escape') onSkipRef.current()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', block, true)
    return () => {
      window.removeEventListener('keydown', block, true)
      others.forEach((el, i) => {
        if (!was[i]) el.removeAttribute('inert')
      })
      const back = before && before.isConnected && before !== document.body ? before : stage()
      back?.focus()
    }
  }, [])
  useEffect(() => void (onSkipRef.current = onSkip))

  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setStuck(true), STUCK_MS)
    return () => clearTimeout(timer)
  }, [waiting])
  // the way back appears where nobody is looking: focus goes to it, so a keyboard or a screen reader finds it
  useEffect(() => {
    if (stuck) backButton.current?.focus()
  }, [stuck])

  const station = METRO_STATIONS[to][lang]
  return (
    <>
      <button
        ref={button}
        type="button"
        data-metro-ride=""
        className="metro-ride"
        data-waiting={waiting || undefined}
        aria-label={t('rideLabel', lang)}
        onClick={onSkip}
      >
        <span className="metro-from" aria-hidden="true">
          {METRO_STATIONS[from][lang]}
        </span>
        <span className="metro-window" aria-hidden="true">
          <span className="metro-tunnel" />
        </span>
        <span className="metro-handrail" aria-hidden="true" />
        <span className="metro-board" aria-hidden="true">
          <span className="metro-next">{t('rideNext', lang, { station })}</span>
          <span className="metro-line">{t(waiting ? 'rideWaiting' : 'rideDoors', lang)}</span>
        </span>
        {!waiting && (
          <span className="metro-skip" aria-hidden="true">
            {t('rideSkip', lang)}
          </span>
        )}
      </button>
      <p role="status" data-metro-ride="" className="visually-hidden">
        {t('rideNext', lang, { station })} {t(waiting ? 'rideWaiting' : 'rideDoors', lang)}
      </p>
      {stuck && (
        <button ref={backButton} type="button" data-metro-ride="" className="metro-back" onClick={onBack}>
          {t('rideBack', lang)}
        </button>
      )}
    </>
  )
}
