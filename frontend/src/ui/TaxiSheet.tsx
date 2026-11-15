import { t, type Lang } from '../i18n/strings'
import type { TaxiStop } from '../world/useTaxi'

interface Props {
  /** The district's landmarks. */
  stops: TaxiStop[]
  lang: Lang
  onPick: (stop: TaxiStop) => void
  onClose: () => void
}

/** "Le chalo": the auto-taxi's destinations, in the same bottom-card slot as the metro's. */
export function TaxiSheet({ stops, lang, onPick, onClose }: Props) {
  return (
    <section className="landmark-card travel-sheet taxi-sheet" aria-label={t('taxiTitle', lang)}>
      <h2>{t('taxiTitle', lang)}</h2>
      <ul>
        {stops.map((stop) => (
          <li key={stop.id}>
            <button type="button" className="travel-stop" onClick={() => onPick(stop)}>
              {stop.name[lang]}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="travel-close" onClick={onClose}>
        {t('taxiClose', lang)}
      </button>
    </section>
  )
}
