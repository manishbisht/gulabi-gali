import { useState } from 'react'
import { t, type Lang } from '../i18n/strings'

interface Props {
  name: string
  lang: Lang
  /**
   * Blocks them; true once blocked, false shows a retry note and keeps the sheet. `thenReport`: "Also report?"
   * was ticked, so whatever holds this stays up for the report form (`onReport`) instead of closing.
   */
  onConfirm(thenReport: boolean): Promise<boolean>
  onCancel(): void
  /**
   * Offers "Also report?". The block always happens first, on the yes; only once it is done does this open the
   * report form, so cancelling or failing the report never leaves them unblocked.
   */
  onReport?(): void
}

/** The in-sheet "Block them?" question (never `window.confirm`). */
export function BlockConfirm({ name, lang, onConfirm, onCancel, onReport }: Props) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [alsoReport, setAlsoReport] = useState(false)
  const yes = async () => {
    const thenReport = alsoReport && onReport !== undefined
    setBusy(true)
    setFailed(false)
    const done = await onConfirm(thenReport).catch(() => false)
    // on success the parent closes this (or, to report, swaps it for the form); it may already be gone
    setBusy(false)
    if (!done) return setFailed(true)
    if (thenReport) onReport!()
  }
  return (
    <div className="chat-confirm" role="alertdialog" aria-label={t('blockButton', lang)}>
      <p>{t('blockAsk', lang, { name })}</p>
      {onReport && (
        <label className="report-block">
          <input type="checkbox" checked={alsoReport} onChange={(e) => setAlsoReport(e.target.checked)} />
          {t('blockAlsoReport', lang)}
        </label>
      )}
      {failed && (
        <p className="chat-note" role="alert">
          {t('blockFailed', lang)}
        </p>
      )}
      <div className="person-actions">
        <button type="button" className="landmark-stamp" disabled={busy} onClick={() => void yes()}>
          {t('blockYes', lang)}
        </button>
        <button type="button" className="person-close" onClick={onCancel}>
          {t('blockNo', lang)}
        </button>
      </div>
    </div>
  )
}
