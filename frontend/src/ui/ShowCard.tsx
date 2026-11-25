import { t, type Lang } from '../i18n/strings'
import { SHOW_TEXT } from '../world/shows'
import type { ShowKind } from '../world/types'

interface Props {
  kind: ShowKind
  lang: Lang
  /** Whether the show is on (or just over): the card then carries "Taali bajao" itself. */
  clap: boolean
  onClap: () => void
  onClose: () => void
}

/**
 * A street show's card, the first time a visitor walks up to one: its name and two lines about the craft. The
 * same bottom card as a landmark's or a character's, and the lowest of them: any other card takes its place.
 * While it is up it holds the clap button too, since the row beside the joystick has no room for both on a phone.
 */
export function ShowCard({ kind, lang, clap, onClap, onClose }: Props) {
  const text = SHOW_TEXT[kind]
  return (
    <section className="landmark-card show-card" aria-label={t(text.name, lang)}>
      <h2>
        <span aria-hidden="true">🎭</span> {t(text.name, lang)}
      </h2>
      <p>{t(text.lines[0], lang)}</p>
      <p>{t(text.lines[1], lang)}</p>
      <div className="landmark-actions">
        {clap && (
          <button type="button" className="landmark-stamp" onClick={onClap}>
            {t('showClap', lang)}
          </button>
        )}
        <button type="button" className="place-invite" onClick={onClose}>
          {t('showClose', lang)}
        </button>
      </div>
    </section>
  )
}
