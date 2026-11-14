import type { ReactNode } from 'react'
import { t, type Lang } from '../i18n/strings'
import type { CitySnapshot, DistrictId } from '../net/protocol'

interface Props {
  district: DistrictId
  snapshot: CitySnapshot | null
  lang: Lang
  onLang: (l: Lang) => void
  /** Later tasks fill these: toast/stamps, minimap, joystick area. */
  top?: ReactNode
  bottom?: ReactNode
}

const DISTRICT_NAMES: Record<DistrictId, string> = {
  'walled-city': 'Walled City',
  'mi-road': 'MI Road',
  university: 'University',
  'malviya-nagar': 'Malviya Nagar',
}

export function Hud({ district, snapshot, lang, onLang, top, bottom }: Props) {
  const weather =
    snapshot && snapshot.tempC !== null ? `${Math.round(snapshot.tempC)}°C` : t('weatherUnknown', lang)
  return (
    <div className="hud">
      <div className="hud-top">
        <span className="hud-chip">{DISTRICT_NAMES[district]}</span>
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
