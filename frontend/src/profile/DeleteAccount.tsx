import { useState, type FormEvent } from 'react'
import { t, type Lang } from '../i18n/strings'

/** What the person must type, exactly (case matters). */
export const DELETE_WORD = 'DELETE'

interface Props {
  lang: Lang
  /** Erases the account: true once it is gone. */
  onDelete: () => Promise<boolean>
}

/** The "Delete my account" step in the profile sheet: a button that opens a typed confirm, never `confirm()`. */
export function DeleteAccount({ lang, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!open)
    return (
      <button type="button" className="auth-close delete-open" onClick={() => setOpen(true)}>
        {t('deleteTitle', lang)}
      </button>
    )

  const ready = typed === DELETE_WORD && !busy
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setFailed(false)
    const gone = await onDelete()
    // On success the page signs out and this sheet goes away.
    if (!gone) {
      setBusy(false)
      setFailed(true)
    }
  }
  return (
    <form className="auth-form delete-confirm" onSubmit={submit}>
      <h3>{t('deleteTitle', lang)}</h3>
      <p>{t('deleteWhat', lang)}</p>
      <label>
        {t('deleteTypeLabel', lang)}
        <input
          data-field="deleteConfirm"
          value={typed}
          autoComplete="off"
          autoCapitalize="characters"
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      {failed && <p role="alert">{t('deleteFailed', lang)}</p>}
      <button type="submit" className="delete-go" disabled={!ready}>
        {t(busy ? 'deleteWorking' : 'deleteConfirm', lang)}
      </button>
      <button type="button" onClick={() => setOpen(false)} disabled={busy}>
        {t('deleteCancel', lang)}
      </button>
    </form>
  )
}
