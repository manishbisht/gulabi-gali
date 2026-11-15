import { t, type Lang } from '../i18n/strings'
import { stampName, TOTAL_STAMPS } from '../world/stamps'

/**
 * "Jaipur Darshan · 2/9" and the landmarks stamped, by name: on a person's card and in your own profile. With
 * `hint`, none yet says where stamps come from (your own sheet); without it, it is the count alone.
 */
export function StampsLine({ ids, lang, hint }: { ids: readonly string[]; lang: Lang; hint?: boolean }) {
  return (
    <div className="person-stamps">
      <p>{t('stampsLine', lang, { n: ids.length, total: TOTAL_STAMPS })}</p>
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
