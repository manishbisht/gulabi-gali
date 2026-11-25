import { useEffect, useRef } from 'react'
import { t, type Lang } from '../i18n/strings'
import { useDialog } from './useDialog'

interface Props {
  /** The PNG to save. */
  image: Blob
  /** Its file name, for the download link. */
  name: string
  lang: Lang
  onClose: () => void
}

/**
 * The picture alone on the screen, for a browser that can neither share a file nor download one by itself
 * (Instagram's in-app browser): pressing and holding it saves it, as the line under it says. A small download
 * link to the same picture is there for a phone whose browser has no "save image" on a long press. Their
 * object URL lives only as long as this is open.
 */
export function HoldToSave({ image, name, lang, onClose }: Props) {
  const ref = useDialog<HTMLElement>(onClose)
  const img = useRef<HTMLImageElement>(null)
  const link = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    const el = img.current
    const a = link.current
    if (!el || !a) return
    const url = URL.createObjectURL(image)
    el.src = url
    a.href = url
    return () => {
      el.removeAttribute('src')
      a.removeAttribute('href')
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
        <a ref={link} className="hold-download" download={name}>
          {t('holdDownload', lang)}
        </a>
        <button type="button" className="auth-close hold-close" onClick={onClose}>
          {t('holdClose', lang)}
        </button>
      </section>
    </div>
  )
}
