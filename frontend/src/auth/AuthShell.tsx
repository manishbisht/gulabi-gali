import { useMemo, useState, type ReactNode } from 'react'
import { useLang } from '../i18n/lang'
import { t } from '../i18n/strings'
import { InAppHint } from './InAppHint'
import { AuthContext, type AuthMode, type AuthState } from './useAuth'

interface Props {
  mode: AuthMode
  signedIn: boolean
  token: AuthState['token']
  signOut: AuthState['signOut']
  /** The mode's sign-in body; it is mounted only while the sheet is open. */
  form: ReactNode
  children: ReactNode
}

export function SignInSheet({ form, onClose }: { form: ReactNode; onClose: () => void }) {
  const [lang] = useLang() // read when the sheet opens, so it follows the language chosen in the HUD
  return (
    <div className="auth-scrim">
      <section className="auth-sheet" role="dialog" aria-modal="true" aria-label={t('signInTitle', lang)}>
        <h2>{t('signInTitle', lang)}</h2>
        <InAppHint lang={lang} />
        {form}
        <button type="button" className="auth-close" onClick={onClose}>
          {t('signInClose', lang)}
        </button>
      </section>
    </div>
  )
}

/** The context and the sign-in sheet, shared by every mode; a mode supplies who is signed in and its form. */
export function AuthShell({ mode, signedIn, token, signOut, form, children }: Props) {
  const [open, setOpen] = useState(false)
  if (signedIn && open) setOpen(false) // signing in closes the sheet
  const value = useMemo<AuthState>(
    () => ({ mode, signedIn, ready: true, token, signOut, openSignIn: () => setOpen(true) }),
    [mode, signedIn, token, signOut],
  )
  return (
    <AuthContext.Provider value={value}>
      {children}
      {open && <SignInSheet form={form} onClose={() => setOpen(false)} />}
    </AuthContext.Provider>
  )
}
