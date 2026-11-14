import { useCallback, useEffect, useRef, useState } from 'react'
import { t, type Lang } from '../i18n/strings'
import type { AdminEvidence, AdminReport, AdminUser } from '../net/protocol'
import { actOn, closeReport, getReports, KINDS, REASONS, when, type Token } from './adminApi'
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
}: {
  report: AdminReport
  lang: Lang
  token: Token
  onClosed(id: string): void
  onTarget(user: AdminUser): void
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
  const { target, reporter } = report
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
      {asking ? (
        <ConfirmBan
          name={target.profile?.name ?? target.id}
          lang={lang}
          busy={busy}
          onYes={() => void close('action', 'ban')}
          onNo={() => setAsking(false)}
        />
      ) : (
        <div className="admin-actions">
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

/** The open reports, oldest first, 20 at a time. `onChanged`: something the stats and hidden list show moved. */
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
    setReports((was) => [...(more ? (was ?? []) : []), ...out.value.reports])
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
  const target = (user: AdminUser) => {
    setReports(
      (was) =>
        was &&
        was.map((r) => ({
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
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} lang={lang} token={token} onClosed={closed} onTarget={target} />
          ))}
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
