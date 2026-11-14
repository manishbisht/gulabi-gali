import { t, type Lang } from '../i18n/strings'

export function NoWebGL({ lang }: { lang: Lang }) {
  return (
    <div className="intro" role="alert">
      <h1 className="intro-title">Gulabi Gali</h1>
      <p className="intro-tagline">{t('noWebgl', lang)}</p>
    </div>
  )
}
