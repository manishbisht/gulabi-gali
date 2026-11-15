import { t, type Lang } from '../i18n/strings'
import type { DistrictId } from '../net/protocol'
import { DISTRICTS } from '../world/district'
import { DISTRICT_NAMES } from '../world/districtNames'
import { rideBy } from '../world/metroRide'

interface Props {
  /** The district the player is in; the sheet lists the others. */
  here: DistrictId
  lang: Lang
  onPick: (id: DistrictId) => void
  onClose: () => void
}

/**
 * The trips from here, in the same bottom-card slot as a landmark's. Picking one rides the Pink Line there, or
 * the bus when either end has no metro (Amer): a bus stop wears its own colour and a "Bus" tag, and is named
 * by what it shows ("Amer Bus").
 */
export function TravelSheet({ here, lang, onPick, onClose }: Props) {
  return (
    <section className="landmark-card travel-sheet" aria-label={t('metroTitle', lang)}>
      <h2>{t('metroTitle', lang)}</h2>
      <ul>
        {DISTRICTS.filter((id) => id !== here).map((id) => {
          const name = DISTRICT_NAMES[id][lang]
          const bus = rideBy(here, id) === 'bus'
          return (
            <li key={id}>
              <button
                type="button"
                className="travel-stop"
                data-id={id}
                data-by={bus ? 'bus' : 'metro'}
                onClick={() => onPick(id)}
              >
                {bus ? (
                  <>
                    <span className="travel-name">{name}</span>{' '}
                    <span className="travel-by">{t('bus', lang)}</span>
                  </>
                ) : (
                  name
                )}
              </button>
            </li>
          )
        })}
      </ul>
      <button type="button" className="travel-close" onClick={onClose}>
        {t('metroClose', lang)}
      </button>
    </section>
  )
}
