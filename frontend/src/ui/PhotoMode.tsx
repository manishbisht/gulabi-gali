import { useEffect, useRef, useState } from 'react'
import type { Stage } from '../engine/stage'
import { t, type Lang } from '../i18n/strings'
import { capturePhoto, sharePhoto, WORDMARK } from './photo'

interface Props {
  stage: Pick<Stage, 'capture'>
  lang: Lang
  onExit: () => void
}

/**
 * Photo mode: the street with nothing over it but a frame, the wordmark, a shutter and a way back. The shutter
 * draws one frame (see `Stage.capture`) and hands the PNG to the share sheet, or downloads it where the
 * browser cannot share files.
 */
export function PhotoMode({ stage, lang, onExit }: Props) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const shutter = useRef<HTMLButtonElement>(null)
  const exitRef = useRef(onExit)
  useEffect(() => void (exitRef.current = onExit))

  useEffect(() => {
    shutter.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) exitRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const take = async () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      const outcome = await sharePhoto(await capturePhoto(stage))
      setNote(outcome === 'downloaded' ? t('photoDownloaded', lang) : null)
    } catch {
      setNote(t('photoFailed', lang))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="photo-mode">
      <div className="photo-frame" role="group" aria-label={t('photoFrame', lang)}>
        <span className="photo-wordmark">{WORDMARK}</span>
      </div>
      <button type="button" className="photo-exit" aria-label={t('photoExit', lang)} onClick={onExit}>
        <span aria-hidden="true">✕</span>
      </button>
      {note && (
        <p className="photo-note" role="status">
          {note}
        </p>
      )}
      <button
        ref={shutter}
        type="button"
        className="photo-shutter"
        aria-label={t('photoShutter', lang)}
        disabled={busy}
        onClick={() => void take()}
      />
    </div>
  )
}
