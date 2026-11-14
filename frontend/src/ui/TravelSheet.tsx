import { t, type Lang } from '../i18n/strings'
import type { DistrictId } from '../net/protocol'
import { DISTRICTS } from '../world/district'
import { DISTRICT_NAMES } from '../world/districtNames'

interface Props {
  /** The district the player is in; the sheet lists the others. */
  here: DistrictId
  lang: Lang
  onPick: (id: DistrictId) => void
  onClose: () => void
}

/** The metro's destinations, in the same bottom-card slot as a landmark's. No ride yet: you arrive. */
export function TravelSheet({ here, lang, onPick, onClose }: Props) {
  return (
    <section className="landmark-card travel-sheet" aria-label={t('metroTitle', lang)}>
      <h2>{t('metroTitle', lang)}</h2>
      <ul>
        {DISTRICTS.filter((id) => id !== here).map((id) => (
          <li key={id}>
            <button type="button" className="travel-stop" onClick={() => onPick(id)}>
              {DISTRICT_NAMES[id][lang]}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="travel-close" onClick={onClose}>
        {t('metroClose', lang)}
      </button>
    </section>
  )
}
