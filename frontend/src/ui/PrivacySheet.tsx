import { t, type Lang, type StringKey } from '../i18n/strings'

interface Props {
  lang: Lang
  onClose: () => void
}

const SECTIONS: [StringKey, StringKey][] = [
  ['privacyStoredTitle', 'privacyStored'],
  ['privacyBenchTitle', 'privacyBench'],
  ['privacyReportsTitle', 'profilePrivacy'],
  ['privacyReportsTitle', 'privacyReportsKept'],
  ['privacyLocationTitle', 'privacyLocation'],
  ['privacyDeleteTitle', 'privacyDelete'],
  ['privacyContactTitle', 'privacyContact'],
]

/** What Gulabi Gali keeps, in plain words. Linked from the intro and the profile sheet. */
export function PrivacySheet({ lang, onClose }: Props) {
  return (
    <div className="auth-scrim">
      <section
        className="auth-sheet privacy-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('privacyTitle', lang)}
      >
        <h2>{t('privacyTitle', lang)}</h2>
        {SECTIONS.map(([title, body], i) => {
          const heading = title !== SECTIONS[i - 1]?.[0]
          return (
            <div key={body}>
              {heading && <h3>{t(title, lang)}</h3>}
              <p>{t(body, lang)}</p>
            </div>
          )
        })}
        <button type="button" className="auth-close" onClick={onClose}>
          {t('privacyClose', lang)}
        </button>
      </section>
    </div>
  )
}
