import type { ReactNode } from 'react'
import { t, type Lang } from '../i18n/strings'
import type { LandmarkDef } from '../world/types'

interface Props {
  landmark: LandmarkDef
  lang: Lang
  stamped: boolean
  onCollect: () => void
  /** "Bulao": a link to this landmark to send someone (see `PlaceInvite`). */
  invite?: ReactNode
}

/** Slides up from the bottom, beside the joystick, while the player stands in a landmark's ring. */
export function LandmarkCard({ landmark, lang, stamped, onCollect, invite }: Props) {
  return (
    <section className="landmark-card" aria-label={landmark.name[lang]}>
      <h2>{landmark.name[lang]}</h2>
      <p>{landmark.story[lang]}</p>
      <div className="landmark-actions">
        {stamped ? (
          <span className="landmark-done">{t('stampHave', lang)}</span>
        ) : (
          <button type="button" className="landmark-stamp" onClick={onCollect}>
            {t('stampButton', lang)}
          </button>
        )}
        {invite}
      </div>
    </section>
  )
}
