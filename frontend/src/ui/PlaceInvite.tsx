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
}

/** How long "Link copied" (or the failure) stays up. */
const NOTE_MS = 3000

/**
 * "Bulao": sends someone a link to this place (see `placeUrl`), with a short line naming it, through the phone's
 * share sheet or else the clipboard. The link names the place and nothing else: not who sent it.
 */
export function PlaceInvite({ district, place, lang, className }: Props) {
  const [note, setNote] = useState<StringKey | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const name = place.name[lang]
  const share = async () => {
    const text = t('placeShareText', lang, { place: name })
    const outcome = await shareLink(text, placeUrl(district, linkId(place)))
    const said = outcome === 'copied' ? 'placeCopied' : outcome === 'failed' ? 'placeShareFailed' : null
    setNote(said)
    clearTimeout(timer.current)
    if (said) timer.current = setTimeout(() => setNote(null), NOTE_MS)
  }
  return (
    <>
      <button
        type="button"
        className={className ? `place-invite ${className}` : 'place-invite'}
        aria-label={t('placeInviteLabel', lang, { place: name })}
        onClick={() => void share()}
      >
        {t('placeInvite', lang)}
      </button>
      {note && (
        <span role="status" className="place-invite-note">
          {t(note, lang)}
        </span>
      )}
    </>
  )
}
