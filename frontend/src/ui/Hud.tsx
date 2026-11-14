import type { ReactNode } from 'react'
import { t, type Lang } from '../i18n/strings'
import type { CitySnapshot } from '../net/protocol'

interface Props {
  /** The district's name, already in the current language. */
  place: string
  snapshot: CitySnapshot | null
  lang: Lang
  onLang: (l: Lang) => void
  /** Later tasks fill these: toast/stamps, minimap, joystick area. */
  top?: ReactNode
  bottom?: ReactNode
}

export function Hud({ place, snapshot, lang, onLang, top, bottom }: Props) {
  const weather =
    snapshot && snapshot.tempC !== null ? `${Math.round(snapshot.tempC)}°C` : t('weatherUnknown', lang)
  return (
    <div className="hud">
      <div className="hud-top">
        <span className="hud-chip">{place}</span>
        <span className="hud-chip">{weather}</span>
        <button
          type="button"
          className="hud-chip lang-toggle"
          aria-label={t('langToggleLabel', lang)}
          onClick={() => onLang(lang === 'hi' ? 'en' : 'hi')}
        >
          {t('langToggle', lang)}
        </button>
      </div>
      {top}
      <div className="hud-bottom">{bottom}</div>
    </div>
  )
}
