import { useState } from 'react'
import { t, type Lang } from '../i18n/strings'
import { isInAppBrowser } from './inApp'

/** Inside Instagram and friends Google sign-in fails; point at Chrome. Dismissible, and only on the sign-in sheet. */
export function InAppHint({ lang }: { lang: Lang }) {
  const [shown, setShown] = useState(() => isInAppBrowser())
  if (!shown) return null
  return (
    <p className="auth-hint" role="note">
      <span>{t('inAppHint', lang)}</span>
      <button type="button" aria-label={t('inAppHintDismiss', lang)} onClick={() => setShown(false)}>
        ×
      </button>
    </p>
  )
}
