import { useEffect, useState } from 'react'
import { t, type Lang } from '../i18n/strings'

/** What the compass needs of a reading (see `WayReading`). */
type Reading = { distance: number; angle: number }

interface Props {
  /** The target's name, already in the current language. */
  name: string
  /** Subscribes to the readings (null once cleared); returns an unsubscribe. */
  watch: (cb: (r: Reading | null) => void) => () => void
  lang: Lang
  /** A tap: no more target. */
  onClear: () => void
}

/**
 * The small compass under the HUD while a place on the map is the target: an arrow pointing to it from the way
 * the view looks, its name and how far it is. A tap clears it. Only this pill re-renders as the player walks.
 */
export function Compass({ name, watch, lang, onClear }: Props) {
  const [reading, setReading] = useState<Reading | null>(null)
  useEffect(() => watch(setReading), [watch])
  return (
    <button type="button" className="compass" onClick={onClear}>
      <span
        className="compass-arrow"
        aria-hidden="true"
        style={reading ? { transform: `rotate(${reading.angle}deg)` } : undefined}
      >
        ↑
      </span>
      <span>{reading ? t('mapAway', lang, { name, m: reading.distance }) : name}</span>
      <span className="visually-hidden">{t('compassClear', lang)}</span>
    </button>
  )
}
