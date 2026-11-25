import { useEffect, useRef } from 'react'
import { t, type Lang } from '../i18n/strings'
import { useDialog } from './useDialog'

interface Props {
  /** The PNG to save. */
  image: Blob
  lang: Lang
  onClose: () => void
}

/**
 * The picture alone on the screen, for a browser that can neither share a file nor download one (Instagram's
 * in-app browser): pressing and holding it saves it, as the line under it says. Its object URL lives only as
 * long as this is open.
 */
export function HoldToSave({ image, lang, onClose }: Props) {
  const ref = useDialog<HTMLElement>(onClose)
  const img = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const el = img.current
    if (!el) return
    const url = URL.createObjectURL(image)
    el.src = url
    return () => {
      el.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [image])
  return (
    <div className="hold-scrim">
      <section
        ref={ref}
        className="hold-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('holdTitle', lang)}
      >
        <img ref={img} className="hold-image" alt={t('holdAlt', lang)} />
        <p className="hold-hint">{t('holdHint', lang)}</p>
        <button type="button" className="auth-close hold-close" onClick={onClose}>
          {t('holdClose', lang)}
        </button>
      </section>
    </div>
  )
}
