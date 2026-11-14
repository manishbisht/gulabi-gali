import { useState } from 'react'
import { t, type Lang } from '../i18n/strings'

interface Props {
  name: string
  lang: Lang
  /** True once blocked; false shows a retry note and keeps the sheet. */
  onConfirm(): Promise<boolean>
  onCancel(): void
}

/** The in-sheet "Block them?" question (never `window.confirm`). */
export function BlockConfirm({ name, lang, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const yes = async () => {
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
