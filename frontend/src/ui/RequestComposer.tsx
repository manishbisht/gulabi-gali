import { useState, type FormEvent } from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import { sendMeetRequest, type RequestOutcome } from '../net/api'
import { MAX_REASON, MIN_REASON, type LivePerson } from '../net/protocol'
import { cleanReason, points } from '../profile/reason'

/** How a finished request ended, as the person card remembers it. */
export type Sent = 'sent' | 'matched'

interface Props {
  person: LivePerson
  lang: Lang
  token(): Promise<string | null>
  onDone(result: Sent): void
  onClose(): void
}

const ERROR_TEXT: Record<Extract<RequestOutcome, { ok: false }>['error'], StringKey> = {
  already: 'requestAlready',
  paused: 'requestPaused',
  ghost: 'requestGhost',
  'not-verified': 'requestNotVerified',
  'no-such-person': 'requestGone',
  invalid: 'requestFailed',
  failed: 'requestFailed',
}

/** The note a resident writes when they ask someone to meet: 10 to 140 characters, counted as they type. */
export function RequestComposer({ person, lang, token, onDone, onClose }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<keyof typeof ERROR_TEXT | null>(null)
  const n = points(text)
  const reason = cleanReason(text)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!reason || busy) return
    setBusy(true)
    setError(null)
    const tok = await token().catch(() => null)
    const out: RequestOutcome = tok
      ? await sendMeetRequest(tok, person.id, reason)
      : { ok: false, error: 'ghost' }
    setBusy(false)
    if (out.ok) onDone(out.kind)
    else setError(out.error)
  }

  return (
    <section
      className="landmark-card request-composer"
      aria-label={t('requestTitle', lang, { name: person.name })}
    >
      <h2>{t('requestTitle', lang, { name: person.name })}</h2>
      <p className="person-note">{t('requestHint', lang)}</p>
      <form onSubmit={submit}>
        <textarea
          aria-label={t('requestLabel', lang)}
          placeholder={t('requestPlaceholder', lang)}
          value={text}
          rows={3}
          maxLength={MAX_REASON * 2}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="request-count" data-over={n > MAX_REASON ? '' : undefined}>
          <span aria-live="polite">{t('requestCount', lang, { n: String(n), max: String(MAX_REASON) })}</span>
          {n > 0 && n < MIN_REASON && ` · ${t('requestMin', lang, { n: String(MIN_REASON) })}`}
        </p>
        {error && (
          <p className="person-note" role="alert">
            {t(ERROR_TEXT[error], lang)}
          </p>
        )}
        <div className="person-actions">
          <button type="submit" className="landmark-stamp" disabled={!reason || busy}>
            {t(busy ? 'requestSending' : 'requestSend', lang)}
          </button>
          <button type="button" className="person-close" onClick={onClose}>
            {t('requestBack', lang)}
          </button>
        </div>
      </form>
    </section>
  )
}
