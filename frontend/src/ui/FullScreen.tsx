import { useState, type FormEvent } from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import { joinWaitlist } from '../net/api'

const NOTES: Record<'invalid' | 'failed', StringKey> = {
  invalid: 'fullEmailInvalid',
  failed: 'fullEmailFailed',
}

/**
 * The city has as many residents as it may: this one waits in line, a ghost meanwhile. A card at the bottom,
 * not a dialog, so they keep exploring; it says where they stand, and takes an email for when there is room
 * (nothing is sent from the site: the owner writes to the list).
 */
export function FullScreen({ position, lang, onClose }: { position: number; lang: Lang; onClose(): void }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'invalid' | 'failed'>('idle')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (state === 'sending' || !email.trim()) return
    setState('sending')
    const out = await joinWaitlist(email)
    setState(out === 'ok' ? 'done' : out)
  }

  return (
    <section
      className="landmark-card full-card"
      role="status"
      aria-label={t('fullTitle', lang, { n: position })}
    >
      <h2>{t('fullTitle', lang, { n: position })}</h2>
      <p>{t('fullBody', lang)}</p>
      {state === 'done' ? (
        <p>{t('fullEmailDone', lang)}</p>
      ) : (
        <form className="auth-form" noValidate onSubmit={(e) => void submit(e)}>
          <label>
            {t('fullEmailLabel', lang)}
            <input
              type="email"
              value={email}
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              aria-invalid={state === 'invalid' || undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <small>{t('fullEmailKept', lang)}</small>
          {(state === 'invalid' || state === 'failed') && <p role="alert">{t(NOTES[state], lang)}</p>}
          <button type="submit" disabled={state === 'sending'}>
            {t(state === 'sending' ? 'fullEmailSending' : 'fullEmailSend', lang)}
          </button>
        </form>
      )}
      <div className="person-actions">
        <button type="button" className="person-close" onClick={onClose}>
          {t('fullClose', lang)}
        </button>
      </div>
    </section>
  )
}
