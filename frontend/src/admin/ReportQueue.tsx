import { useCallback, useEffect, useRef, useState } from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import type { AdminEvidence, AdminReport, AdminUser } from '../net/protocol'
import { DISTRICT_NAMES } from '../world/districtNames'
import { actOn, closeReport, getReports, KINDS, REASONS, removePoster, when, type Token } from './adminApi'
import { ConfirmBan, UserSummary } from './UserLookup'

/**
 * What a report carried, as plain text only: every value goes in as a React text child, never as markup, so
 * whatever someone typed (tags included) shows exactly as typed. Lines carry the sender's first name and time.
 */
function Evidence({ evidence, lang }: { evidence: AdminEvidence | null; lang: Lang }) {
  if (!evidence) return <p className="admin-empty">{t('adminEvidenceCleared', lang)}</p>
  if (evidence.kind === 'profile')
    return (
      <dl className="admin-snapshot" aria-label={t('adminSnapshot', lang)}>
        <dt>{t('adminSnapshot', lang)}</dt>
        <dd>{evidence.name}</dd>
        <dd>{evidence.status}</dd>
        <dd>{evidence.homeArea}</dd>
        <dd className="admin-about">{evidence.about}</dd>
      </dl>
    )
  if (evidence.kind === 'poster')
    return (
      <dl className="admin-snapshot" aria-label={t('adminKindPoster', lang)}>
        <dt>
          {t('adminPosterAt', lang, {
            place: DISTRICT_NAMES[evidence.district]?.[lang] ?? evidence.district,
            n: evidence.wall + 1,
          })}
        </dt>
        <dd className="admin-about">{evidence.text}</dd>
        {evidence.when !== null && <dd>{t('adminPosterWhen', lang, { when: when(evidence.when) })}</dd>}
      </dl>
    )
  return (
    <>
      {evidence.missing && <p className="admin-empty">{t('adminEvidenceMissing', lang)}</p>}
      {evidence.lines.length === 0 && !evidence.missing && (
        <p className="admin-empty">{t('adminEvidenceEmpty', lang)}</p>
      )}
      {evidence.lines.length > 0 && (
        <ol className="admin-transcript">
          {evidence.lines.map((l, i) => (
            <li key={i}>
              <span className="admin-who">{l.name}</span>{' '}
              <time dateTime={new Date(l.at).toISOString()}>{when(l.at)}</time>
              <span className="admin-said">{l.text}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

/** How a reported poster stands now: so the admin knows what dismissing (or taking it down) will do. */
const POSTER_STATE = {
  hidden: 'adminPosterHidden',
  up: 'adminPosterUp',
  gone: 'adminPosterGone',
} as const satisfies Record<NonNullable<AdminReport['posterState']>, StringKey>

/**
 * One report: who filed it, who it is about (as they are now), the note and the evidence, then its actions.
 * Closing (dismiss, or actioned) takes it off the queue; "Close + mute" and "Close + ban" also act on the
 * person (the ban asks first). Anything else on the person (unmute, verify…) is in Find someone.
 */
function ReportCard({
  report,
  lang,
  token,
  onClosed,
  onTarget,
  onPosterGone,
}: {
  report: AdminReport
  lang: Lang
  token: Token
  onClosed(id: string): void
  onTarget(user: AdminUser): void
  /** A poster came down: the server closed every open report about it. */
  onPosterGone(posterId: string): void
}) {
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState(false)
  /** Set at once on a tap (state is not, until the next render): a second tap meanwhile does nothing. */
  const inflight = useRef(false)
  const fail = () => {
    inflight.current = false
    setBusy(false)
    setAsking(false)
    setFailed(true)
  }
  const close = async (how: 'dismiss' | 'action', then?: 'ban' | 'mute') => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true)
    setFailed(false)
    // The person first: if the close then fails, the report is still open to try again (both are idempotent).
    if (then) {
      const acted = await actOn(token, report.target.id, then)
      if (acted.ok) onTarget(acted.value)
      else return fail()
    }
    const closed = await closeReport(token, report.id, how)
    if (!closed.ok) return fail()
    inflight.current = false
    setBusy(false)
    onClosed(report.id)
  }
  const takeDown = async (posterId: string) => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true)
    setFailed(false)
    const out = await removePoster(token, posterId)
    // `missing`: it had already come down and nothing about it was open: the queue is done with it either way.
    if (!out.ok && out.error !== 'missing') return fail()
    inflight.current = false
    setBusy(false)
    onPosterGone(posterId)
  }
  const { target, reporter } = report
  const poster = report.evidence?.kind === 'poster' ? report.evidence.posterId : null
  return (
    <li className="admin-card" data-report={report.id}>
      <p className="admin-head">
        <strong>{t(KINDS[report.kind], lang)}</strong> · {t(REASONS[report.reason], lang)} ·{' '}
        <time dateTime={new Date(report.createdAt).toISOString()}>{when(report.createdAt)}</time>
      </p>
      {report.unconfirmed && <p className="admin-flag admin-unconfirmed">{t('adminUnconfirmed', lang)}</p>}
      <h3>{t('adminAbout', lang)}</h3>
      <UserSummary user={target} lang={lang} />
      {target.profile && (
        <p className="admin-about">
          {[target.profile.status, target.profile.homeArea, target.profile.about].filter(Boolean).join(' · ')}
        </p>
      )}
      <h3>{t('adminReportedBy', lang)}</h3>
      <UserSummary user={reporter} lang={lang} />
      {report.note && (
        <>
          <h3>{t('adminNote', lang)}</h3>
          <p className="admin-about">{report.note}</p>
        </>
      )}
      <h3>{t('adminEvidence', lang)}</h3>
      <Evidence evidence={report.evidence} lang={lang} />
      {report.posterState && (
        <p className={report.posterState === 'hidden' ? 'admin-flag' : 'admin-empty'}>
          {t(POSTER_STATE[report.posterState], lang)}
        </p>
      )}
      {asking ? (
        <ConfirmBan
          name={target.profile?.name ?? target.id}
          openReports={target.openReports}
          lang={lang}
          busy={busy}
          onYes={() => void close('action', 'ban')}
          onNo={() => setAsking(false)}
        />
      ) : (
        <div className="admin-actions">
          {poster && (
            <button
              type="button"
              className="admin-danger"
              disabled={busy}
              onClick={() => void takeDown(poster)}
            >
              {t('adminPosterRemove', lang)}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void close('dismiss')}>
            {t('adminDismiss', lang)}
          </button>
          <button type="button" disabled={busy} onClick={() => void close('action')}>
            {t('adminAction', lang)}
          </button>
          <button type="button" disabled={busy} onClick={() => void close('action', 'mute')}>
            {t('adminCloseMute', lang)}
          </button>
          <button type="button" className="admin-danger" disabled={busy} onClick={() => setAsking(true)}>
            {t('adminCloseBan', lang)}
          </button>
        </div>
      )}
      {failed && (
        <p className="admin-error" role="alert">
          {t('adminFailed', lang)}
        </p>
      )}
    </li>
  )
}

/** Consecutive reports about one person, as the server sends the queue: grouped, most urgent first. */
function byTarget(reports: AdminReport[]): AdminReport[][] {
  const groups: AdminReport[][] = []
  for (const r of reports) {
    const last = groups.at(-1)
    if (last && last[0]!.target.id === r.target.id) last.push(r)
    else groups.push([r])
  }
  return groups
}

/**
 * The open reports, 20 at a time, grouped by the person they are about (the server puts the people with an
 * underage or harassment report first), each group saying how many open reports there are about them. A ban
 * closes every report about the person, so their whole group leaves the page. `onChanged`: something the
 * stats and hidden list show moved.
 */
export function ReportQueue({ lang, token, onChanged }: { lang: Lang; token: Token; onChanged(): void }) {
  const [reports, setReports] = useState<AdminReport[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const alive = useRef(true)
  /** A page as it arrives: the first replaces what is shown, a later one (`more`) adds to it. */
  const take = useCallback((out: Awaited<ReturnType<typeof getReports>>, more: boolean) => {
    setBusy(false)
    if (!out.ok) return setFailed(true)
    // A page can repeat a card the last one showed (the queue's order moves as reports close): once each.
    setReports((was) => {
      const kept = more ? (was ?? []) : []
      const shown = new Set(kept.map((r) => r.id))
      return [...kept, ...out.value.reports.filter((r) => !shown.has(r.id))]
    })
    setNext(out.value.next)
  }, [])
  useEffect(() => {
    alive.current = true
    void getReports(token, 'open', null).then((out) => alive.current && take(out, false))
    return () => {
      alive.current = false
    }
  }, [token, take])
  const loadMore = async (cursor: string) => {
    setBusy(true)
    setFailed(false)
    const out = await getReports(token, 'open', cursor)
    if (alive.current) take(out, true)
  }
  const closed = (id: string) => {
    setReports((was) => was && was.filter((r) => r.id !== id))
    onChanged()
  }
  const posterGone = (posterId: string) => {
    setReports(
      (was) => was && was.filter((r) => !(r.evidence?.kind === 'poster' && r.evidence.posterId === posterId)),
    )
    onChanged()
  }
  const target = (user: AdminUser) => {
    setReports(
      (was) =>
        was &&
        was
          // A ban closed every open report about them on the server.
          .filter((r) => !(user.banned && r.target.id === user.id))
          .map((r) => ({
            ...r,
            target: r.target.id === user.id ? user : r.target,
            reporter: r.reporter.id === user.id ? user : r.reporter,
          })),
    )
    onChanged()
  }
  return (
    <section className="admin-section" aria-labelledby="admin-reports">
      <h2 id="admin-reports">{t('adminReports', lang)}</h2>
      {reports === null && !failed && <p className="admin-empty">{t('adminLoading', lang)}</p>}
      {reports && reports.length === 0 && <p className="admin-empty">{t('adminQueueEmpty', lang)}</p>}
      {reports && reports.length > 0 && (
        <ul className="admin-list">
          {byTarget(reports).map((group) => {
            const { target: who } = group[0]!
            return (
              <li key={`${who.id}:${group[0]!.id}`} className="admin-group">
                <h3>{t('adminGroup', lang, { name: who.profile?.name ?? who.id, n: who.openReports })}</h3>
                <ul className="admin-list">
                  {group.map((r) => (
                    <ReportCard
                      key={r.id}
                      report={r}
                      lang={lang}
                      token={token}
                      onClosed={closed}
                      onTarget={target}
                      onPosterGone={posterGone}
                    />
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
      {failed && (
        <p className="admin-error" role="alert">
          {t('adminFailed', lang)}
        </p>
      )}
      {next && (
        <button type="button" className="admin-wide" disabled={busy} onClick={() => void loadMore(next)}>
          {t('adminMore', lang)}
        </button>
      )}
    </section>
  )
}
