import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { useLang } from '../i18n/lang'
import { t, type Lang } from '../i18n/strings'
import type { AdminHidden, AdminStats } from '../net/protocol'
import { DISTRICT_NAMES } from '../world/districtNames'
import './admin.css'
import {
  actOn,
  daysSince,
  downloadWaitlist,
  getHidden,
  getStats,
  KINDS,
  REASONS,
  STATS_MS,
  when,
  type Token,
} from './adminApi'
import { ReportQueue } from './ReportQueue'
import { UserLookup, UserSummary } from './UserLookup'

function Stats({ stats, lang }: { stats: AdminStats; lang: Lang }) {
  return (
    <section className="admin-stats" aria-label={t('adminLive', lang)}>
      <ul>
        {stats.districts.map((d) => (
          <li key={d.id}>
            <strong>{DISTRICT_NAMES[d.id][lang]}</strong>{' '}
            {d.residents === null || d.ghosts === null
              ? t('adminUnknown', lang)
              : t('adminLiveLine', lang, { residents: d.residents, ghosts: d.ghosts })}
          </li>
        ))}
      </ul>
      <p>
        <span>{t('adminOpenReports', lang, { n: stats.openReports })}</span>
        <span>{t('adminHiddenCount', lang, { n: stats.hidden })}</span>
        {stats.live !== null && <span>{t('adminLiveTotal', lang, { n: stats.live })}</span>}
        {stats.queue !== null && <span>{t('adminWaiting', lang, { n: stats.queue })}</span>}
      </p>
    </section>
  )
}

/**
 * Everyone hidden, first on the page: auto-hide can be gamed by a few verified accounts made for it, so the
 * owner sees each hidden person with the reports that hid them, every reporter's account age and who vouched
 * for them, and a one-tap Unhide. No evidence here: that is only in the report card.
 */
function AutoHidden({
  lang,
  token,
  version,
  onChanged,
  onUnhidden,
}: {
  lang: Lang
  token: Token
  version: number
  onChanged(): void
  /** Someone was unhidden: their reports stay open, but the queue's cards show them as hidden. */
  onUnhidden(): void
}) {
  const [list, setList] = useState<AdminHidden[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    void getHidden(token).then((out) => {
      if (!alive) return
      if (out.ok) setList(out.value)
      setFailed(!out.ok)
    })
    return () => {
      alive = false
    }
  }, [token, version])
  const inflight = useRef(false)
  const unhide = async (id: string) => {
    if (inflight.current) return
    inflight.current = true
    setBusy(id)
    setFailed(false)
    const out = await actOn(token, id, 'unhide')
    inflight.current = false
    setBusy(null)
    if (!out.ok) return setFailed(true)
    setList((was) => was && was.filter((h) => h.user.id !== id))
    onChanged()
    onUnhidden()
  }
  return (
    <section className="admin-section admin-hidden" aria-labelledby="admin-hidden">
      <h2 id="admin-hidden">{t('adminAutoHidden', lang)}</h2>
      <p className="admin-help">{t('adminAutoHiddenHelp', lang)}</p>
      <p className="admin-help">{t('adminUnhideNote', lang)}</p>
      {list && list.length === 0 && <p className="admin-empty">{t('adminAutoHiddenNone', lang)}</p>}
      {list && list.length > 0 && (
        <ul className="admin-list">
          {list.map(({ user, reports }) => (
            <li key={user.id} className="admin-card">
              <UserSummary user={user} lang={lang} />
              <div className="admin-actions">
                <button type="button" disabled={busy !== null} onClick={() => void unhide(user.id)}>
                  {t('adminUnhide', lang)}
                </button>
              </div>
              <ul className="admin-reporters">
                {reports.map((r) => (
                  <li key={r.id}>
                    <p className="admin-head">
                      {t(KINDS[r.kind], lang)} · {t(REASONS[r.reason], lang)} · {when(r.createdAt)}
                      {r.unconfirmed && <span className="admin-flag"> {t('adminUnconfirmed', lang)}</span>}
                    </p>
                    <p className="admin-meta">
                      <span>
                        {r.reporter.profile?.name ?? t('adminNoProfile', lang)} <code>{r.reporter.id}</code>
                      </span>
                      <span>
                        {r.reporter.createdAt === null
                          ? t('adminNoAccount', lang)
                          : t('adminAge', lang, { days: daysSince(r.reporter.createdAt) })}
                      </span>
                      <span>
                        {r.reporter.verified
                          ? t('adminVerifiedBy', lang, { by: r.reporter.verifiedBy ?? '?' })
                          : t('adminNotVerified', lang)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p className="admin-error" role="alert">
          {t('adminFailed', lang)}
        </p>
      )}
    </section>
  )
}

/**
 * The console, once signed in. The live counts are asked for every `STATS_MS` only while the tab is in view
 * (a hidden tab asks nothing), and again whenever an action changes something. A 404 for them means this
 * account is not an admin: the page then says only that there is nothing here.
 */
function Console({ lang, token }: { lang: Lang; token: Token }) {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [version, setVersion] = useState(0)
  const [csvFailed, setCsvFailed] = useState(false)
  const changed = useCallback(() => setVersion((v) => v + 1), [])
  /** Bumped by an unhide: the queue starts over from its first page, its cards showing people as they now are. */
  const [queue, setQueue] = useState(0)
  const unhidden = useCallback(() => setQueue((q) => q + 1), [])
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    const tick = async () => {
      const out = await getStats(token)
      if (!alive) return
      if (out.ok) {
        setStats(out.value)
        setAllowed(true)
      } else if (out.error === 'missing') setAllowed(false)
    }
    const start = () => {
      if (timer !== null || document.visibilityState !== 'visible') return
      void tick()
      timer = setInterval(() => void tick(), STATS_MS)
    }
    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop())
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [token, version])

  if (allowed === false) return <p className="admin-empty">{t('adminNotFound', lang)}</p>
  if (allowed === null) return <p className="admin-empty">{t('adminLoading', lang)}</p>
  return (
    <>
      {stats && <Stats stats={stats} lang={lang} />}
      <AutoHidden lang={lang} token={token} version={version} onChanged={changed} onUnhidden={unhidden} />
      <ReportQueue key={queue} lang={lang} token={token} onChanged={changed} />
      <UserLookup lang={lang} token={token} onChanged={changed} />
      <section className="admin-section">
        <button
          type="button"
          className="admin-wide"
          onClick={() => void downloadWaitlist(token).then((ok) => setCsvFailed(!ok))}
        >
          {t('adminWaitlist', lang)}
        </button>
        {csvFailed && (
          <p className="admin-error" role="alert">
            {t('adminFailed', lang)}
          </p>
        )}
      </section>
    </>
  )
}

/**
 * `#/admin`: the owner's moderation page, loaded only on this route (its own chunk, never in the city's).
 * It never opens the sign-in sheet: whoever is signed out is sent to the city page to sign in there.
 */
export default function AdminPage() {
  const [lang, setLang] = useLang()
  const auth = useAuth()
  return (
    <main className="admin">
      <header className="admin-top">
        <h1>{t('adminTitle', lang)}</h1>
        <a href="#/">{t('adminToCity', lang)}</a>
        <button
          type="button"
          aria-label={t('langToggleLabel', lang)}
          onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')}
        >
          {t('langToggle', lang)}
        </button>
      </header>
      {!auth.ready ? (
        <p className="admin-empty">{t('adminLoading', lang)}</p>
      ) : !auth.signedIn ? (
        <p className="admin-empty">
          {t('adminSignInFirst', lang)} · <a href="#/">{t('adminToCity', lang)}</a>
        </p>
      ) : (
        <Console lang={lang} token={auth.token} />
      )}
    </main>
  )
}
