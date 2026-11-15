import { useState } from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import type { RoofNotice as Notice } from '../world/useRooftop'

interface Props {
  /** The stair's foot is in reach. */
  near: boolean
  /** Up on the roof. */
  up: boolean
  /** The screen is fading for a climb or the way down. */
  fading: boolean
  lang: Lang
  onClimb: () => void
}

/**
 * "Chhat pe chalo" at the stair, "Neeche chalo" up on the roof (E too). It stays mounted, saying what it last
 * said, all through the fade either way, so a finger on it or the keyboard's focus is never dropped.
 */
export function RoofButton({ near, up, fading, lang, onClimb }: Props) {
  const now: StringKey | null = up ? 'roofDown' : near ? 'roofUp' : null
  const [said, setSaid] = useState<StringKey | null>(now)
  if (now && now !== said) setSaid(now)
  const label = now ?? said
  if (!label || (!now && !fading)) return null
  return (
    <button type="button" className="metro-button roof-button" aria-keyshortcuts="E" onClick={onClimb}>
      {t(label, lang)}
    </button>
  )
}

/** A polite line for screen readers on arriving up on the roof or back on the street. Always mounted. */
export function RoofNotice({ notice, lang }: { notice: Notice; lang: Lang }) {
  return (
    // a polite live region without the status role: the street's toasts are the page's status lines
    <p className="visually-hidden roof-notice" aria-live="polite">
      {notice && t(notice === 'up' ? 'roofOnTop' : 'roofOnStreet', lang)}
    </p>
  )
}
