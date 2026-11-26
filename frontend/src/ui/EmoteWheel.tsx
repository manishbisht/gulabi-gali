import { t, type Lang, type StringKey } from '../i18n/strings'
import { EMOTE_KINDS, type EmoteKind } from '../net/protocol'
import { EMOTE_MARKS } from '../world/emoting'

const NAMES: Record<EmoteKind, StringKey> = {
  dance: 'emoteDance',
  clap: 'emoteClap',
  sit: 'emoteSit',
  selfie: 'emoteSelfie',
  wave: 'emoteWave',
}

interface Props {
  open: boolean
  lang: Lang
  onToggle: () => void
  onPick: (kind: EmoteKind) => void
}

/**
 * The emote chip and its five: one small button over the joystick's corner, which opens two short rows above
 * the stick (never wider than its column, so nothing beside the joystick is covered, and nothing is added to
 * the HUD's top). Each is a thumb-sized button named in words; the mark on it is decoration.
 */
export function EmoteWheel({ open, lang, onToggle, onPick }: Props) {
  return (
    <div className="emote-wheel">
      <button
        type="button"
        className="emote-chip"
        aria-label={t('emoteOpen', lang)}
        aria-expanded={open}
        aria-keyshortcuts="G"
        title={t('emoteOpen', lang)}
        onClick={onToggle}
      >
        <span aria-hidden="true">{open ? '✕' : '🙌'}</span>
      </button>
      {open && (
        <div className="emote-kinds" role="group" aria-label={t('emoteOpen', lang)}>
          {EMOTE_KINDS.map((kind, i) => (
            <button
              key={kind}
              type="button"
              className="emote-kind"
              aria-label={t(NAMES[kind], lang)}
              aria-keyshortcuts={String(i + 1)}
              title={t(NAMES[kind], lang)}
              onClick={() => onPick(kind)}
            >
              <span aria-hidden="true">{EMOTE_MARKS[kind]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
