import { t, type Lang } from '../i18n/strings'

interface Props {
  lang: Lang
  onLang: (l: Lang) => void
  onEnter: () => void
}

export function Intro({ lang, onLang, onEnter }: Props) {
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
      <button type="button" className="enter" onClick={onEnter}>
        {t('enter', lang)}
      </button>
    </div>
  )
}
