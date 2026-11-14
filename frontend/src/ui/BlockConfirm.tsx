import { useState } from 'react'
import { t, type Lang } from '../i18n/strings'

interface Props {
  name: string
  lang: Lang
  /** True once blocked; false shows a retry note and keeps the sheet. */
  onConfirm(): Promise<boolean>
  onCancel(): void
  /**
   * Offers "Also report?". Ticked, the yes goes to the report form instead (with "Also block?" ticked there),
   * so the report is filed first and the block follows it.
   */
  onReport?(): void
}

/** The in-sheet "Block them?" question (never `window.confirm`). */
export function BlockConfirm({ name, lang, onConfirm, onCancel, onReport }: Props) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [alsoReport, setAlsoReport] = useState(false)
  const yes = async () => {
    if (alsoReport && onReport) return onReport()
    setBusy(true)
    setFailed(false)
    const done = await onConfirm().catch(() => false)
    // on success the parent closes this; it may already be gone
    setBusy(false)
    if (!done) setFailed(true)
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
          {t(alsoReport && onReport ? 'blockNext' : 'blockYes', lang)}
        </button>
        <button type="button" className="person-close" onClick={onCancel}>
          {t('blockNo', lang)}
        </button>
      </div>
    </div>
  )
}
