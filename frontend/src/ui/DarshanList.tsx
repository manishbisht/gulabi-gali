import { useEffect, useRef, useState } from 'react'
import { t, type Lang } from '../i18n/strings'
import { darshanComplete, darshanEntries } from '../world/darshan'
import { DISTRICT_NAMES } from '../world/districtNames'
import { TOTAL_STAMPS } from '../world/stamps'
import { cardName } from './cardLayout'
import { HoldToSave } from './HoldToSave'
import { loadCards, preloadCards } from './loadCards'
import { pictureName, type ShareOutcome } from './share'
import { DarshanBadge } from './StampsLine'
import { useDialog } from './useDialog'
import { useShareFlow } from './useShareFlow'

interface Props {
  /** The landmark ids stamped so far. */
  ids: readonly string[]
  lang: Lang
  /** A resident's name (their own): only they get "naam dikhao", and the card prints only its first word. */
  name?: string
  /** Days in a row of "Aaj ka Darshan", for the card. */
  streak?: number
  onClose: () => void
}

/**
 * Every Jaipur Darshan landmark: the stamped ones by name, the rest as a short riddle (so there is something
 * to look for), each with its district. Opens from the stamps chip.
 */
export function DarshanList({ ids, lang, name, streak = 0, onClose }: Props) {
  const ref = useDialog<HTMLElement>(onClose)
  /** Off each time the sheet opens: a name goes on a card only when asked for, that time. */
  const [showName, setShowName] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const make = useRef<HTMLButtonElement>(null)
  const flow = useShareFlow(make)
  // the card is likely next: its composer and fonts come now, so the tap's share sheet is not kept waiting
  useEffect(preloadCards, [])

  const said = (outcome: ShareOutcome) => setNote(outcome === 'downloaded' ? t('cardDownloaded', lang) : null)

  const makeCard = async () => {
    if (busy) return
    setBusy(true)
    setNote(t('cardMaking', lang))
    flow.forget()
    try {
      const { composeDarshanCard } = await loadCards()
      const blob = await composeDarshanCard({ ids, lang, name: cardName(name, showName), streak })
      said(await flow.share({ blob, name: pictureName('darshan-'), saved: 'cardDownloaded' }))
    } catch {
      setNote(t('cardFailed', lang))
    } finally {
      setBusy(false)
    }
  }

  /** "Share" on a card the share sheet refused (its tap was too long ago): this tap is fresh. */
  const again = async () => {
    if (!flow.retry) return
    try {
      said(await flow.share(flow.retry, true))
    } catch {
      setNote(t('cardFailed', lang))
    }
  }

  return (
    <>
      <div className="auth-scrim">
        <section
          ref={ref}
          className="auth-sheet darshan-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t('darshanTitle', lang)}
        >
          <div className="darshan-head">
            <h2>{t('stampsLine', lang, { n: ids.length, total: TOTAL_STAMPS })}</h2>
            <button
              type="button"
              className="darshan-x"
              aria-label={t('darshanClose', lang)}
              onClick={onClose}
            >
              ×
            </button>
          </div>
          {darshanComplete(ids) && <DarshanBadge lang={lang} />}
          <div className="darshan-card">
            <button
              ref={make}
              type="button"
              className="darshan-card-make"
              disabled={busy}
              onClick={() => void makeCard()}
            >
              {t('cardMake', lang)}
            </button>
            {flow.retry && (
              <button
                type="button"
                className="darshan-card-make darshan-card-share"
                onClick={() => void again()}
              >
                {t('shareAgain', lang)}
              </button>
            )}
            {name && (
              <label>
                <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
                {t('cardShowName', lang)}
              </label>
            )}
            {/* in the page from the start, so a screen reader hears its line change */}
            <p className="darshan-card-note" role="status">
              {note}
            </p>
          </div>
          <ul className="darshan-list" aria-label={t('darshanListLabel', lang)}>
            {darshanEntries(ids, lang).map((e) => (
              <li key={e.id} data-id={e.id} data-got={e.got}>
                <strong>{e.got ? e.name : t('darshanLocked', lang)}</strong>
                <span className="darshan-district">{DISTRICT_NAMES[e.district][lang]}</span>
                {!e.got && <em>{e.riddle}</em>}
              </li>
            ))}
          </ul>
          <button type="button" className="auth-close" onClick={onClose}>
            {t('darshanClose', lang)}
          </button>
        </section>
      </div>
      {flow.hold && (
        <HoldToSave image={flow.hold.blob} name={flow.hold.name} lang={lang} onClose={flow.closeHold} />
      )}
    </>
  )
}
