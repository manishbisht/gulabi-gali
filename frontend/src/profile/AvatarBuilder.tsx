import { t, type Lang } from '../i18n/strings'
import type { AvatarLook } from '../world/types'
import { FlatFigure } from './FlatFigure'

interface Props {
  look: AvatarLook
  lang: Lang
  /** Opens the dressing room (`LookEditor`). */
  onEdit: () => void
}

/**
 * The profile sheet's avatar: a flat 2D swatch of the figure and the way into the dressing room. The swatch is
 * deliberately not a WebGL canvas: phones inside Instagram's browser can lose the one context they have; the
 * dressing room makes its own small one only while it is open.
 */
export function AvatarBuilder({ look, lang, onEdit }: Props) {
  return (
    <fieldset className="avatar-builder">
      <legend>{t('profileLook', lang)}</legend>
      <FlatFigure look={look} />
      <button type="button" className="look-open" onClick={onEdit}>
        {t('lookOpen', lang)}
      </button>
    </fieldset>
  )
}
