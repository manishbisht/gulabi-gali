import { useEffect, useRef, useState, type FormEvent } from 'react'
import { WordsHint } from '../filter/WordsHint'
import { t, type Lang, type StringKey } from '../i18n/strings'
import type { BlockOutcome } from '../connections/useBlock'
import { sendReport, type ReportError } from '../net/api'
import {
  MAX_REPORT_NOTE,
  REPORT_REASONS,
  type ReportInput,
  type ReportKind,
  type ReportReason,
} from '../net/protocol'

interface Props {
  kind: ReportKind
  /** The person the report is about (a poster's id, for `poster`; a block's handle, `fromBlockList`). */
  targetId: string
  /** `targetId` is a handle from the block list, which never carries an id: the server finds the person. */
  fromBlockList?: boolean
  /** For a bench report: which bench. */
  bench?: string
  name: string
  lang: Lang
  token(): Promise<string | null>
  /**
   * The block flow, offered as "Also block?" and run once the report has gone; true once blocked, `gone` when a
   * poster's owner can no longer be found. Left out when they are blocked already (the block question's "Also
   * report?" blocks before this opens).
   */
  onBlock?(): Promise<BlockOutcome>
  onClose(): void
}

const REASON_TEXT: Record<ReportReason, StringKey> = {
  harassment: 'reportHarassment',
  hate: 'reportHate',
  spam: 'reportSpam',
  underage: 'reportUnderage',
  other: 'reportOther',
}

const ERROR_TEXT: Record<ReportError | 'block' | 'block-gone', StringKey> = {
  rate: 'reportRate',
  words: 'wordsHint',
  'not-there': 'reportNotThere',
  gone: 'reportGone',
  failed: 'reportFailed',
  block: 'blockFailed',
  'block-gone': 'blockPosterGone',
}

/**
 * The in-sheet report form (never `window.confirm`): a reason, an optional note, and "Also block?". Only the
 * reason and note are sent; the server gathers what was said or shown itself.
 */
export function ReportSheet({
  kind,
  targetId,
  fromBlockList,
  bench,
  name,
  lang,
  token,
  onBlock,
  onClose,
}: Props) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [note, setNote] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<ReportError | 'block' | 'block-gone' | null>(null)
  /** Filed; `missing` when the server no longer had the bench's record to send with it. */
  const [sent, setSent] = useState<'ok' | 'missing' | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!reason || busy) return
    setBusy(true)
    setProblem(null)
    const text = note.trim()
    const input: ReportInput = {
      kind,
      targetId,
      ...(fromBlockList ? { blocked: true as const } : {}),
      ...(bench ? { bench } : {}),
      reason,
      ...(text ? { note: text } : {}),
    }
    const tok = await token().catch(() => null)
    const out = tok ? await sendReport(tok, input) : ({ ok: false, error: 'failed' } as const)
    if (!alive.current) return
    if (!out.ok) {
      setBusy(false)
      return setProblem(out.error)
    }
    // the block flow closes whatever this sheet sits in once it is done
    const blocked = alsoBlock && onBlock ? await onBlock().catch(() => false) : true
    if (!alive.current) return
    setBusy(false)
    setSent(out.evidence === 'missing' ? 'missing' : 'ok')
    if (blocked !== true) setProblem(blocked === 'gone' ? 'block-gone' : 'block')
  }

  const title = t('reportTitle', lang, { name })
  return (
    <div
      className="chat-confirm report-sheet"
      role="dialog"
      aria-label={title}
      onKeyDown={(e) => {
        // Escape closes this sheet only, not the sheet it sits in (and loses what was typed there)
        if (e.key !== 'Escape' || busy) return
        e.stopPropagation()
        e.preventDefault()
        onClose()
      }}
    >
      <h3>{title}</h3>
      {sent ? (
        <>
          <p role="status">{t(sent === 'missing' ? 'reportThanksMissing' : 'reportThanks', lang)}</p>
          {problem && (
            <p className="chat-note" role="alert">
              {t(ERROR_TEXT[problem], lang)}
            </p>
          )}
          <div className="person-actions">
            <button type="button" className="landmark-stamp" onClick={onClose}>
              {t('benchNoticeClose', lang)}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <div className="pick-row" role="group" aria-label={t('reportWhy', lang)}>
            <span>{t('reportWhy', lang)}</span>
            {REPORT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className="pick pick-text"
                aria-pressed={reason === r}
                onClick={() => setReason(r)}
              >
                {t(REASON_TEXT[r], lang)}
              </button>
            ))}
          </div>
          <label className="report-note">
            {t('reportNote', lang)}
            <textarea
              rows={2}
              value={note}
              maxLength={MAX_REPORT_NOTE}
              onChange={(e) => {
                setNote(e.target.value)
                if (problem === 'words') setProblem(null)
              }}
            />
            <WordsHint text={note} lang={lang} />
          </label>
          {onBlock && (
            <label className="report-block">
              <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} />
              {t('reportAlsoBlock', lang)}
            </label>
          )}
          {problem && (
            <p className="chat-note" role="alert">
              {t(ERROR_TEXT[problem], lang)}
            </p>
          )}
          <div className="person-actions">
            <button type="submit" className="landmark-stamp" disabled={!reason || busy}>
              {t(busy ? 'reportSending' : 'reportSend', lang)}
            </button>
            <button type="button" className="person-close" onClick={onClose}>
              {t('reportCancel', lang)}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
