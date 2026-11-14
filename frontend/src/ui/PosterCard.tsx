import { useEffect, useState } from 'react'
import { t, type Lang } from '../i18n/strings'
import { takeDownPoster } from '../net/api'
import type { PosterView } from '../net/protocol'
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
   * Blocks the poster's owner; true once done. The parent then closes the card, unless `stay`: they also want
   * to report, and the card stays up for the form (it closes when the form does).
   */
  onBlock(poster: PosterView, stay?: boolean): Promise<boolean>
  /** Your own poster came down. */
  onTakenDown(id: string): void
  onClose(): void
}

/**
 * A tapped poster: its text (plain text, whatever was typed), its time in Jaipur, and who pinned it, by first
 * name. A resident can report it or block its owner (the block asked first, then the report if they want);
 * your own you can take down.
 */
export function PosterCard({ poster, gone, viewer, lang, token, onBlock, onTakenDown, onClose }: Props) {
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
      {mine && <p className="person-note">{t('posterMine', lang)}</p>}
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
