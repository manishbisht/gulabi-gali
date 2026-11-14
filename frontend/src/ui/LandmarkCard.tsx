import { t, type Lang } from '../i18n/strings'
import type { LandmarkDef } from '../world/types'

interface Props {
  landmark: LandmarkDef
  lang: Lang
  stamped: boolean
  onCollect: () => void
}

/** Slides up from the bottom, beside the joystick, while the player stands in a landmark's ring. */
export function LandmarkCard({ landmark, lang, stamped, onCollect }: Props) {
  return (
    <section className="landmark-card" aria-label={landmark.name[lang]}>
      <h2>{landmark.name[lang]}</h2>
      <p>{landmark.story[lang]}</p>
      {stamped ? (
        <span className="landmark-done">{t('stampHave', lang)}</span>
      ) : (
        <button type="button" className="landmark-stamp" onClick={onCollect}>
          {t('stampButton', lang)}
        </button>
      )}
    </section>
  )
}
