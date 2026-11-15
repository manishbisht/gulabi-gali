import { useEffect, useRef, useState } from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import type { DistrictId } from '../net/protocol'
import type { MapTarget } from '../world/cityMap'
import { linkId, placeUrl } from '../world/placeLink'
import { shareLink } from './inviteShare'

interface Props {
  district: DistrictId
  place: Pick<MapTarget, 'id' | 'kind' | 'name'>
  lang: Lang
  className?: string
  /** An icon instead of the word, for a card's crowded row; the accessible name (and title) stay the same. */
  compact?: boolean
}

/** How long "Link copied" (or the failure) stays up. */
const NOTE_MS = 3000

/** The usual "share" mark: three joined dots. Drawn in the button's own colour. */
const SHARE_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
    </g>
  </svg>
)

/**
 * "Bulao": sends someone a link to this place (see `placeUrl`), with a short line naming it, through the phone's
 * share sheet or else the clipboard. The link names the place and nothing else: not who sent it. Its status line
 * is always mounted (a live region has to be there before it speaks) and empty while there is nothing to say;
 * when there is, it floats over the button, so it never moves the row it sits in.
 */
export function PlaceInvite({ district, place, lang, className, compact }: Props) {
  const [note, setNote] = useState<StringKey | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const name = place.name[lang]
  const label = t('placeInviteLabel', lang, { place: name })
  const share = async () => {
    const text = t('placeShareText', lang, { place: name })
    const outcome = await shareLink(text, placeUrl(district, linkId(place)))
    const said = outcome === 'copied' ? 'placeCopied' : outcome === 'failed' ? 'placeShareFailed' : null
    setNote(said)
    clearTimeout(timer.current)
    if (said) timer.current = setTimeout(() => setNote(null), NOTE_MS)
  }
  const classes = ['place-invite', compact && 'place-invite-icon', className].filter(Boolean).join(' ')
  return (
    <span className="place-invite-wrap">
      <button
        type="button"
        className={classes}
        aria-label={label}
        title={compact ? label : undefined}
        onClick={() => void share()}
      >
        {compact ? SHARE_ICON : t('placeInvite', lang)}
      </button>
      <span role="status" className="place-invite-note">
        {note ? t(note, lang) : ''}
      </span>
    </span>
  )
}
