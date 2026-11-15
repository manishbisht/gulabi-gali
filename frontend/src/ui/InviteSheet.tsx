import { useEffect, useState, type FormEvent } from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import { getInvites, redeemInvite, type RedeemError } from '../net/api'
import type { InviteView, Me } from '../net/protocol'
import { shareCode, showCode } from './inviteShare'
import { useDialog } from './useDialog'

interface Props {
  me: Me
  lang: Lang
  token(): Promise<string | null>
  /** The code worked: the server's new `Me`, now verified. */
  onVerified(me: Me): void
  onClose(): void
}

const ERROR_TEXT: Record<RedeemError, StringKey> = {
  'bad-code': 'inviteBadCode',
  used: 'inviteUsed',
  'own-code': 'inviteOwn',
  'already-verified': 'inviteAlready',
  rate: 'inviteRate',
  failed: 'inviteFailed',
}

/**
 * Invite codes. Someone not yet verified types a friend's code; a verified member sees their own codes, each
 * with a share button.
 */
export function InviteSheet({ me, lang, token, onVerified, onClose }: Props) {
  const ref = useDialog<HTMLElement>(onClose)
  const [verified, setVerified] = useState(me.verified)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<RedeemError | null>(null)
  const [codes, setCodes] = useState<InviteView[] | null>(null)
  const [note, setNote] = useState<StringKey | null>(null)

  useEffect(() => {
    if (!verified) return
    const ctl = new AbortController()
    void (async () => {
      try {
        const tok = await token()
        const got = tok ? await getInvites(tok, ctl.signal) : []
        if (!ctl.signal.aborted) setCodes(got)
      } catch {
        if (!ctl.signal.aborted) setCodes([])
      }
    })()
    return () => ctl.abort()
  }, [verified, token])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    const tok = await token().catch(() => null)
    const out = tok ? await redeemInvite(tok, text) : ({ ok: false, error: 'failed' } as const)
    setBusy(false)
    if (!out.ok) return setError(out.error)
    setVerified(true)
    setNote('inviteNow')
    onVerified(out.me)
  }

  const share = async (code: string) => {
    const outcome = await shareCode(code, lang)
    setNote(outcome === 'copied' ? 'inviteCopied' : outcome === 'failed' ? 'inviteCopyFailed' : null)
  }

  return (
    <div className="auth-scrim">
      <section
        ref={ref}
        className="auth-sheet invite-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('inviteTitle', lang)}
      >
        <h2>{t('inviteTitle', lang)}</h2>
        {!verified && (
          <form className="auth-form" onSubmit={submit}>
            <p className="person-note">{t('inviteEnterHint', lang)}</p>
            <label>
              {t('inviteEnterLabel', lang)}
              <input
                data-field="code"
                value={text}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={32}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            {error && <p role="alert">{t(ERROR_TEXT[error], lang)}</p>}
            <button type="submit" disabled={!text.trim() || busy}>
              {t(busy ? 'inviteRedeeming' : 'inviteRedeem', lang)}
            </button>
          </form>
        )}
        {verified && (
          <div className="invite-codes">
            <h3>{t('inviteYours', lang)}</h3>
            <p className="person-note">{t('inviteYoursHint', lang)}</p>
            {codes && codes.length === 0 && <p className="person-note">{t('inviteNone', lang)}</p>}
            <ul>
              {(codes ?? []).map((c) => (
                <li key={c.code}>
                  <code>{showCode(c.code)}</code>
                  {c.used ? (
                    <span className="person-note">{t('inviteUsedTag', lang)}</span>
                  ) : (
                    <button type="button" onClick={() => void share(c.code)}>
                      {t('inviteShare', lang)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {note && (
          <p role="status" className="person-note">
            {t(note, lang)}
          </p>
        )}
        <button type="button" className="auth-close" onClick={onClose}>
          {t('inviteClose', lang)}
        </button>
      </section>
    </div>
  )
}
