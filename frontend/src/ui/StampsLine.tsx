import { t, type Lang } from '../i18n/strings'
import { darshanComplete } from '../world/darshan'
import { stampName, TOTAL_STAMPS } from '../world/stamps'

/** The badge for every landmark stamped, derived from the count: nothing extra is stored. */
export function DarshanBadge({ lang }: { lang: Lang }) {
  return <span className="darshan-badge">{t('darshanBadge', lang)}</span>
}

/**
 * "Jaipur Darshan · 2/9" and the landmarks stamped, by name: on a person's card and in your own profile. With
 * `hint`, none yet says where stamps come from (your own sheet); without it, it is the count alone.
 */
export function StampsLine({ ids, lang, hint }: { ids: readonly string[]; lang: Lang; hint?: boolean }) {
  return (
    <div className="person-stamps">
      <p>{t('stampsLine', lang, { n: ids.length, total: TOTAL_STAMPS })}</p>
      {darshanComplete(ids) && <DarshanBadge lang={lang} />}
      {ids.length > 0 ? (
        <ul aria-label={t('stampsList', lang)}>
          {ids.map((id) => (
            <li key={id}>{stampName(id, lang)}</li>
          ))}
        </ul>
      ) : (
        hint && <p className="person-stamps-none">{t('stampsNone', lang)}</p>
      )}
    </div>
  )
}
