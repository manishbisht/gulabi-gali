import { useEffect, useRef, useState } from 'react'
import type { Stage } from '../engine/stage'
import { t, type Lang } from '../i18n/strings'
import { emitDeed } from '../world/deeds'
import { SEP } from './cardLayout'
import { HoldToSave } from './HoldToSave'
import { capturePhoto, sharePhoto, WORDMARK } from './photo'
import { pictureName, shareImage } from './share'

interface Props {
  stage: Pick<Stage, 'capture'>
  /** Where the postcard says it was taken: the landmark the player stands by, else the district. */
  place: string
  lang: Lang
  onExit: () => void
}

type Kind = 'photo' | 'postcard'

/** The postcard composer, fetched the first time someone takes one. */
const loadCards = () => import('./cards')

/**
 * Photo mode: the street with nothing over it but a frame, the wordmark, a shutter and a way back. The shutter
 * draws one frame (see `Stage.capture`) and hands the PNG to the share sheet, or downloads it where the
 * browser cannot share files. "Postcard" frames a 9:16 Story with a band naming the place (see `cards.ts`).
 */
export function PhotoMode({ stage, place, lang, onExit }: Props) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>('photo')
  /** A picture to press and save, where the browser can neither share nor download (Instagram's). */
  const [hold, setHold] = useState<Blob | null>(null)
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
      const postcard = kind === 'postcard'
      const shot = postcard
        ? await (await loadCards()).composePostcard(stage, place)
        : await capturePhoto(stage)
      emitDeed({ kind: 'photo' }) // taken, whether it is then shared, saved or the share sheet closed
      const outcome = postcard ? await shareImage(shot, pictureName('postcard-')) : await sharePhoto(shot)
      if (outcome === 'hold') setHold(shot)
      setNote(outcome === 'downloaded' ? t(postcard ? 'postcardDownloaded' : 'photoDownloaded', lang) : null)
    } catch {
      setNote(t('photoFailed', lang))
    } finally {
      setBusy(false)
    }
  }

  const label = kind === 'postcard' ? ['Gulabi Gali', place, 'Jaipur'].filter(Boolean).join(SEP) : WORDMARK
  return (
    <>
      <div className="photo-mode">
        <div
          className={kind === 'postcard' ? 'photo-frame photo-frame-postcard' : 'photo-frame'}
          role="group"
          aria-label={t('photoFrame', lang)}
        >
          <span className="photo-wordmark">{label}</span>
        </div>
        <div className="photo-kinds" role="radiogroup" aria-label={t('photoKinds', lang)}>
          {(['photo', 'postcard'] as const).map((k) => (
            <label key={k} className="photo-kind">
              <input
                type="radio"
                name="photo-kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
              />
              <span>{t(k === 'photo' ? 'photoKindPhoto' : 'photoKindPostcard', lang)}</span>
            </label>
          ))}
        </div>
        <button type="button" className="photo-exit" aria-label={t('photoExit', lang)} onClick={onExit}>
          <span aria-hidden="true">✕</span>
        </button>
        {/* mounted from the start and only its text changes, so a screen reader hears the change */}
        <p className="photo-note" role="status">
          {note}
        </p>
        <button
          ref={shutter}
          type="button"
          className="photo-shutter"
          aria-label={t('photoShutter', lang)}
          disabled={busy}
          onClick={() => void take()}
        />
      </div>
      {hold && <HoldToSave image={hold} lang={lang} onClose={() => setHold(null)} />}
    </>
  )
}
