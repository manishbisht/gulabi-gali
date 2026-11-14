import { t, type Lang } from '../i18n/strings'

/** What a banned account sees instead of the city: plainly what happened, and a way to sign out. */
export function AccountClosed({ lang, onSignOut }: { lang: Lang; onSignOut(): void }) {
  return (
    <div className="intro account-closed" role="alert">
      <h1 className="intro-title">{t('bannedTitle', lang)}</h1>
      <p className="intro-tagline">{t('bannedBody', lang)}</p>
      <button type="button" className="enter" onClick={onSignOut}>
        {t('profileSignOut', lang)}
      </button>
    </div>
  )
}
