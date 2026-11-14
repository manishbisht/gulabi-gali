import { t, type Lang } from '../i18n/strings'
import type { DistrictId } from '../net/protocol'
import { METRO_STATIONS } from '../world/metroRide'

interface Props {
  from: DistrictId
  to: DistrictId
  lang: Lang
  /** The ride is over but the next district is still loading. */
  waiting: boolean
  onSkip: () => void
}

/** The inside of a Pink Line coach, in CSS only, over the black screen. Tapping anywhere skips. */
export function MetroRide({ from, to, lang, waiting, onSkip }: Props) {
  return (
    <button type="button" className="metro-ride" data-waiting={waiting || undefined} onClick={onSkip}>
      <span className="metro-from">{METRO_STATIONS[from][lang]}</span>
      <span className="metro-window" aria-hidden="true">
        <span className="metro-tunnel" />
      </span>
      <span className="metro-handrail" aria-hidden="true" />
      <span className="metro-board" aria-live="polite">
        <span className="metro-next">{t('rideNext', lang, { station: METRO_STATIONS[to][lang] })}</span>
        <span className="metro-line">{t(waiting ? 'rideWaiting' : 'rideDoors', lang)}</span>
      </span>
      {!waiting && <span className="metro-skip">{t('rideSkip', lang)}</span>}
    </button>
  )
}
