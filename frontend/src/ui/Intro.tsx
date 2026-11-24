import { t, type Lang } from '../i18n/strings'
import { useCityCount } from '../live/useCityCount'

/** The count as the welcome screen says it: 0 is quiet, ten and up was rounded down (so "n+"). */
function countLine(n: number, lang: Lang): string {
  if (n === 0) return t('introQuiet', lang)
  return t(n >= 10 ? 'introCountMany' : 'introCount', lang, { n })
}

interface Props {
  lang: Lang
  onLang: (l: Lang) => void
  onEnter: () => void
  onPrivacy?: () => void
  /** "Aaj ka Darshan": the day's goal, in `lang`; one quiet line, nothing to press. */
  today?: string
}

export function Intro({ lang, onLang, onEnter, onPrivacy, today }: Props) {
  const count = useCityCount()
  return (
    <div className="intro">
      <button
        type="button"
        className="lang-toggle intro-lang"
        aria-label={t('langToggleLabel', lang)}
        onClick={() => onLang(lang === 'hi' ? 'en' : 'hi')}
      >
        {t('langToggle', lang)}
      </button>
      <h1 className="intro-title">Gulabi Gali</h1>
      <p className="intro-tagline">{t('tagline', lang)}</p>
      {/* its line is always there (empty until a count arrives), so nothing below it jumps */}
      <p className="intro-count" aria-live="polite">
        {count === null ? '' : countLine(count, lang)}
      </p>
      {today && <p className="intro-today">{t('todayChip', lang, { goal: today })}</p>}
      <button type="button" className="enter" onClick={onEnter}>
        {t('enter', lang)}
      </button>
      {onPrivacy && (
        <button type="button" className="intro-privacy" onClick={onPrivacy}>
          {t('privacyLink', lang)}
        </button>
      )}
    </div>
  )
}
