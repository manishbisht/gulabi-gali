import { t, type Lang } from '../i18n/strings'
import { darshanComplete, darshanEntries } from '../world/darshan'
import { DISTRICT_NAMES } from '../world/districtNames'
import { TOTAL_STAMPS } from '../world/stamps'
import { DarshanBadge } from './StampsLine'
import { useDialog } from './useDialog'

interface Props {
  /** The landmark ids stamped so far. */
  ids: readonly string[]
  lang: Lang
  onClose: () => void
}

/**
 * Every Jaipur Darshan landmark: the stamped ones by name, the rest as a short riddle (so there is something
 * to look for), each with its district. Opens from the stamps chip.
 */
export function DarshanList({ ids, lang, onClose }: Props) {
  const ref = useDialog<HTMLElement>(onClose)
  return (
    <div className="auth-scrim">
      <section
        ref={ref}
        className="auth-sheet darshan-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('darshanTitle', lang)}
      >
        <h2>{t('stampsLine', lang, { n: ids.length, total: TOTAL_STAMPS })}</h2>
        {darshanComplete(ids) && <DarshanBadge lang={lang} />}
        <ul className="darshan-list" aria-label={t('darshanListLabel', lang)}>
          {darshanEntries(ids, lang).map((e) => (
            <li key={e.id} data-id={e.id} data-got={e.got}>
              <strong>{e.got ? e.name : t('darshanLocked', lang)}</strong>
              <span className="darshan-district">{DISTRICT_NAMES[e.district][lang]}</span>
              {!e.got && <em>{e.riddle}</em>}
            </li>
          ))}
        </ul>
        <button type="button" className="auth-close" onClick={onClose}>
          {t('darshanClose', lang)}
        </button>
      </section>
    </div>
  )
}
