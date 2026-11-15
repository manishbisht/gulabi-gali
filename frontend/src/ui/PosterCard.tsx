import { useEffect, useState } from 'react'
import type { BlockOutcome } from '../connections/useBlock'
import { t, type Lang } from '../i18n/strings'
import { getGoing, setGoing, takeDownPoster } from '../net/api'
import type { GoingView, PosterView } from '../net/protocol'
import { posterWhen } from '../world/posters'
import { BlockConfirm } from './BlockConfirm'
import type { Viewer } from './PersonCard'
import { ReportSheet } from './ReportSheet'

interface Props {
  poster: PosterView
  /**
   * It came off the wall while the card was up (taken down, hidden, its owner blocked): the card closes, though
   * not under a block question or a report form still being filled in (it closes once they are done).
   */
  gone?: boolean
  viewer: Viewer
  lang: Lang
  token(): Promise<string | null>
  /**
   * Blocks the poster's owner; true once done (`gone`: the poster came down long enough ago that its owner is no
   * longer known). The parent then closes the card, unless `stay`: they also want to report, and the card stays
   * up for the form (it closes when the form does).
   */
  onBlock(poster: PosterView, stay?: boolean): Promise<BlockOutcome>
  /** Your own poster came down. */
  onTakenDown(id: string): void
  /** "Main aaunga/aaungi" said or taken back: the poster as it now stands, for the wall. */
  onChanged?(poster: PosterView): void
  onClose(): void
}

/**
 * A tapped poster: its text (plain text, whatever was typed), its time in Jaipur, and who pinned it, by first
 * name. A resident can report it or block its owner (the block asked first, then the report if they want);
 * your own you can take down, a hidden one too (only you see it, and it still counts toward your two).
 *
 * Milte hain: everyone sees how many are coming; a verified member taps "Main aaunga/aaungi" (or takes it back); the
 * owner alone is sent the first names of those coming, asked for when their card opens.
 */
export function PosterCard({
  poster,
  gone,
  viewer,
  lang,
  token,
  onBlock,
  onTakenDown,
  onChanged,
  onClose,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const [reporting, setReporting] = useState(false)
  /** Blocked from this card with "Also report?": the form offers no block, and closing it closes the card. */
  const [blocked, setBlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (gone && !confirming && !reporting) onClose()
  }, [gone, confirming, reporting, onClose])
  const resident = viewer === 'resident' || viewer === 'verified'
  const mine = poster.mine === true
  /** What the server last said of this poster's meet-up (the card may be handed another poster). */
  const [said, setSaid] = useState<{ id: string; view: GoingView } | null>(null)
  const going: GoingView =
    said?.id === poster.id ? said.view : { going: poster.going ?? 0, coming: poster.coming === true }
  const [goingBusy, setGoingBusy] = useState(false)
  const [goingError, setGoingError] = useState<'rate' | 'past' | 'failed' | null>(null)
  const canGo = viewer === 'verified' && !mine && !poster.hidden
  const asked = mine && !poster.hidden

  useEffect(() => {
    if (!asked) return
    const ctl = new AbortController()
    void (async () => {
      const tok = await token().catch(() => null)
      const view = tok ? await getGoing(tok, poster.id, ctl.signal) : null
      if (view && !ctl.signal.aborted) setSaid({ id: poster.id, view })
    })()
    return () => ctl.abort()
  }, [asked, poster.id, token])

  const toggleGoing = async () => {
    setGoingBusy(true)
    setGoingError(null)
    const tok = await token().catch(() => null)
    const out = tok ? await setGoing(tok, poster.id, !going.coming) : null
    setGoingBusy(false)
    if (!out?.ok) {
      const error = out?.ok === false ? out.error : 'failed'
      setGoingError(error === 'rate' || error === 'past' ? error : 'failed')
      return
    }
    setSaid({ id: poster.id, view: out.view })
    const next: PosterView = { ...poster }
    delete next.going
    delete next.coming
    if (out.view.going > 0) next.going = out.view.going
    if (out.view.coming) next.coming = true
    onChanged?.(next)
  }

  const takeDown = async () => {
    setBusy(true)
    setFailed(false)
    const tok = await token().catch(() => null)
    const done = tok ? await takeDownPoster(tok, poster.id) : false
    setBusy(false)
    if (done) onTakenDown(poster.id)
    else setFailed(true)
  }

  return (
    <section className="landmark-card poster-card" aria-label={t('posterCard', lang)}>
      <h2>{t('posterCard', lang)}</h2>
      <p className="poster-text">{poster.text}</p>
      {poster.when !== null && <p>{t('posterWhenLine', lang, { when: posterWhen(poster.when) })}</p>}
      <p className="person-note">{t('posterBy', lang, { name: poster.name })}</p>
      {going.going > 0 && <p className="person-note">{t('posterGoing', lang, { n: going.going })}</p>}
      {mine && going.names && (
        <p className="person-note">
          {going.names.length
            ? t('posterWho', lang, { names: going.names.join(', ') })
            : t('posterWhoNone', lang)}
        </p>
      )}
      {canGo && going.coming && (
        <p className="person-note" role="status">
          {t('posterComingNote', lang)}
        </p>
      )}
      {canGo && <p className="person-note">{t('posterGoingPrivacy', lang)}</p>}
      {viewer === 'resident' && !mine && <p className="person-note">{t('posterComingVerifiedOnly', lang)}</p>}
      {goingError && (
        <p className="person-note" role="alert">
          {t(
            goingError === 'rate'
              ? 'posterGoingRate'
              : goingError === 'past'
                ? 'posterGoingPast'
                : 'posterGoingFailed',
            lang,
          )}
        </p>
      )}
      {mine && <p className="person-note">{t('posterMine', lang)}</p>}
      {mine && poster.hidden && (
        <p className="person-note" role="status">
          {t('posterHiddenNote', lang)}
        </p>
      )}
      {failed && (
        <p className="person-note" role="alert">
          {t('posterTakeDownFailed', lang)}
        </p>
      )}
      {confirming && (
        <BlockConfirm
          name={poster.name}
          lang={lang}
          onConfirm={(stay) => onBlock(poster, stay)}
          onCancel={() => setConfirming(false)}
          onReport={() => {
            setConfirming(false)
            setBlocked(true)
            setReporting(true)
          }}
        />
      )}
      {reporting && (
        <ReportSheet
          kind="poster"
          targetId={poster.id}
          name={poster.name}
          lang={lang}
          token={token}
          onBlock={blocked ? undefined : () => onBlock(poster)}
          onClose={blocked ? onClose : () => setReporting(false)}
        />
      )}
      <div className="person-actions">
        {mine && (
          <button type="button" className="landmark-stamp" disabled={busy} onClick={() => void takeDown()}>
            {t('posterTakeDown', lang)}
          </button>
        )}
        {canGo && !confirming && !reporting && (
          <button
            type="button"
            className={going.coming ? 'person-close' : 'landmark-stamp'}
            disabled={goingBusy}
            aria-pressed={going.coming}
            onClick={() => void toggleGoing()}
          >
            {t(going.coming ? 'posterNotComing' : 'posterComing', lang)}
          </button>
        )}
        {resident && !mine && !confirming && !reporting && (
          <>
            <button type="button" className="person-close" onClick={() => setConfirming(true)}>
              {t('blockButton', lang)}
            </button>
            <button type="button" className="person-close" onClick={() => setReporting(true)}>
              {t('reportButton', lang)}
            </button>
          </>
        )}
        <button type="button" className="person-close" onClick={onClose}>
          {t('personClose', lang)}
        </button>
      </div>
    </section>
  )
}
