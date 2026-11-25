import { useEffect, useRef, useState } from 'react'
import type { Stage } from '../engine/stage'
import { t, type Lang } from '../i18n/strings'
import { emitDeed } from '../world/deeds'
import { SEP } from './cardLayout'
import { HoldToSave } from './HoldToSave'
import { loadCards, preloadCards } from './loadCards'
import { capturePhoto, photoName, WORDMARK } from './photo'
import { pictureName, type ShareOutcome } from './share'
import { useShareFlow, type Picture } from './useShareFlow'

interface Props {
  stage: Pick<Stage, 'capture'>
  /** Where the postcard says it was taken: the landmark the player stands by, else the district. */
  place: string
  lang: Lang
  onExit: () => void
}

type Kind = 'photo' | 'postcard'

/**
 * Photo mode: the street with nothing over it but a frame, the wordmark, a shutter and a way back. The shutter
 * draws one frame (see `Stage.capture`) and hands the PNG on (see `shareImage`: the share sheet, a download, or
 * in Instagram's browser the picture alone to press and save). "Postcard" frames a 9:16 Story with a band naming
 * the place (see `cards.ts`, fetched, with its fonts, as soon as Postcard is picked).
 */
export function PhotoMode({ stage, place, lang, onExit }: Props) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>('photo')
  const shutter = useRef<HTMLButtonElement>(null)
  const flow = useShareFlow(shutter)
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

  const said = (outcome: ShareOutcome, picture: Picture) =>
    setNote(outcome === 'downloaded' ? t(picture.saved, lang) : null)

  const take = async () => {
    if (busy) return
    setBusy(true)
    setNote(null)
    flow.forget()
    try {
      const picture: Picture =
        kind === 'postcard'
          ? {
              blob: await (await loadCards()).composePostcard(stage, place),
              name: pictureName('postcard-'),
              saved: 'postcardDownloaded',
            }
          : { blob: await capturePhoto(stage), name: photoName(), saved: 'photoDownloaded' }
      emitDeed({ kind: 'photo' }) // taken, whether it is then shared, saved or the share sheet closed
      said(await flow.share(picture), picture)
    } catch {
      setNote(t('photoFailed', lang))
    } finally {
      setBusy(false)
    }
  }

  /** "Share" on a picture the share sheet refused (its tap was too long ago): this tap is fresh. */
  const again = async () => {
    const picture = flow.retry
    if (!picture) return
    try {
      said(await flow.share(picture), picture)
    } catch {
      setNote(t('photoFailed', lang))
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
                onChange={() => {
                  setKind(k)
                  if (k === 'postcard') preloadCards()
                }}
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
        {flow.retry && (
          <button type="button" className="photo-retry" onClick={() => void again()}>
            {t('shareAgain', lang)}
          </button>
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
      {flow.hold && (
        <HoldToSave image={flow.hold.blob} name={flow.hold.name} lang={lang} onClose={flow.closeHold} />
      )}
    </>
  )
}
