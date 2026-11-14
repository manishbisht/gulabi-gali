import { t, type Lang } from '../i18n/strings'

interface Props {
  lang: Lang
  onHorn: () => void
  onExit: () => void
}

/** At the wheel: the horn (also Space) and the way out (also E), beside the joystick that drives. */
export function DriveButtons({ lang, onHorn, onExit }: Props) {
  return (
    <div className="drive-buttons">
      <button
        type="button"
        className="metro-button horn-button"
        aria-label={t('driveHorn', lang)}
        aria-keyshortcuts="Space"
        onClick={onHorn}
      >
        ⤒
      </button>
      <button type="button" className="metro-button exit-button" aria-keyshortcuts="E" onClick={onExit}>
        {t('driveExit', lang)}
      </button>
    </div>
  )
}
