import { useEffect, useState } from 'react'
import { getProfile } from '../net/api'
import type { FullProfile, LivePerson } from '../net/protocol'
import { t, type Lang } from '../i18n/strings'
import { BlockConfirm } from './BlockConfirm'
import { ReportSheet } from './ReportSheet'
import type { Sent } from './RequestComposer'
import { areaLabel, HERE_FOR_LABEL } from '../profile/homeAreas'

/**
 * Who is looking: nobody visible yet, signed in without a finished profile, a resident, or a verified resident
 * (the only one who can start a request, and who sees links).
 */
export type Viewer = 'ghost' | 'incomplete' | 'resident' | 'verified'

interface Props {
  person: LivePerson
  /** They left the district while the card was up: it keeps what it showed, and cannot start a request. */
  gone: boolean
  viewer: Viewer
  /** A request already sent to this person this session: confirmed in the card, and "Milna hai" is off. */
  sent?: Sent
  lang: Lang
  token(): Promise<string | null>
  /** The ghost's CTA: sign in, or finish the profile. */
  onVisible(): void
  /** A resident who is not verified yet: opens the invite code sheet. */
  onGetVerified(): void
  onRequest(person: LivePerson): void
  /** Blocks them; true once done (the parent then closes the card). */
  onBlock?(person: LivePerson): Promise<boolean>
  onClose(): void
}

type Loaded = { id: string; profile: FullProfile | null } | null

/**
 * The bottom card for another person. A ghost sees only the live name and status (no profile is fetched for
 * them); a resident also gets the full profile, and a failed or missing one never leaves the card blank.
 */
export function PersonCard({
  person,
  gone,
  viewer,
  sent,
  lang,
  token,
  onVisible,
  onGetVerified,
  onRequest,
  onBlock,
  onClose,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const [reporting, setReporting] = useState(false)
  const resident = viewer === 'resident' || viewer === 'verified'
  const [loaded, setLoaded] = useState<Loaded>(null)
  useEffect(() => {
    if (!resident) return
    const ctl = new AbortController()
    void (async () => {
      let profile: FullProfile | null = null
      try {
        const tok = await token()
        if (tok) profile = await getProfile(tok, person.id, ctl.signal)
      } catch {
        // offline, 401 or the like: the live name and status carry the card
      }
      if (!ctl.signal.aborted) setLoaded({ id: person.id, profile })
    })()
    return () => ctl.abort()
  }, [resident, person.id, token])

  const done = loaded?.id === person.id
  const profile = done ? loaded.profile : null
  const name = profile?.name ?? person.name
  const status = profile?.status ?? person.status

  return (
    <section className="landmark-card person-card" aria-label={name}>
      <h2>{name}</h2>
      {status && <p>“{status}”</p>}
      {profile && (
        <>
          <p className="person-area">
            {areaLabel(profile.homeArea, lang)}
            {profile.hereFor &&
              ` · ${t('personHereFor', lang, { what: t(HERE_FOR_LABEL[profile.hereFor], lang) })}`}
          </p>
          {profile.about && <p>{profile.about}</p>}
          {profile.link && (
            <p className="person-link">
              {t('personLink', lang)}:{' '}
              <a href={profile.link} target="_blank" rel="noopener noreferrer nofollow ugc">
                {profile.link}
              </a>
            </p>
          )}
        </>
      )}
      {resident && !done && <p className="person-note">{t('personLoading', lang)}</p>}
      {resident && done && !profile && <p className="person-note">{t('personNoProfile', lang)}</p>}
      {sent && <p className="person-note">{t(sent === 'sent' ? 'requestSent' : 'requestMatched', lang)}</p>}
      {gone && <p className="person-note">{t('personGone', lang)}</p>}
      {confirming && onBlock && (
        <BlockConfirm
          name={name}
          lang={lang}
          onConfirm={() => onBlock(person)}
          onCancel={() => setConfirming(false)}
        />
      )}
      {reporting && (
        <ReportSheet
          kind="person"
          targetId={person.id}
          name={name}
          lang={lang}
          token={token}
          onBlock={onBlock && (() => onBlock(person))}
          onClose={() => setReporting(false)}
        />
      )}
      <div className="person-actions">
        {resident ? (
          <>
            <button
              type="button"
              className="landmark-stamp"
              disabled={gone || !!sent || viewer !== 'verified'}
              onClick={() => onRequest(person)}
            >
              {t('personMeet', lang)}
            </button>
            {viewer !== 'verified' && (
              <button type="button" className="landmark-stamp" onClick={onGetVerified}>
                {t('personGetVerified', lang)}
              </button>
            )}
          </>
        ) : (
          <button type="button" className="landmark-stamp" onClick={onVisible}>
            {t('personGhostCta', lang)}
          </button>
        )}
        {resident && onBlock && !confirming && !reporting && (
          <button type="button" className="person-close" onClick={() => setConfirming(true)}>
            {t('blockButton', lang)}
          </button>
        )}
        {resident && !confirming && !reporting && (
          <button type="button" className="person-close" onClick={() => setReporting(true)}>
            {t('reportButton', lang)}
          </button>
        )}
        <button type="button" className="person-close" onClick={onClose}>
          {t('personClose', lang)}
        </button>
      </div>
    </section>
  )
}
