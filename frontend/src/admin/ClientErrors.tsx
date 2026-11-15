import { useEffect, useState } from 'react'
import { t, type Lang } from '../i18n/strings'
import type { AdminErrorGroup } from '../net/protocol'
import { DISTRICT_NAMES } from '../world/districtNames'
import { getErrors, when, type Token } from './adminApi'

/**
 * What broke on people's phones (the error beacon, kept 14 days): the most frequent errors first, each with
 * how often and when it was last seen, the kinds of browser it came from and its latest stack. Asked for once,
 * and again on Refresh: it is for a look now and then, not a live feed. Everything is shown as text.
 */
export function ClientErrors({ lang, token }: { lang: Lang; token: Token }) {
  const [groups, setGroups] = useState<AdminErrorGroup[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let alive = true
    void getErrors(token).then((out) => {
      if (!alive) return
      if (out.ok) setGroups(out.value)
      setFailed(!out.ok)
    })
    return () => {
      alive = false
    }
  }, [token, version])
  return (
    <section className="admin-section admin-errors" aria-labelledby="admin-errors">
      <h2 id="admin-errors">{t('adminErrors', lang)}</h2>
      <p className="admin-help">{t('adminErrorsHelp', lang)}</p>
      {groups && groups.length === 0 && <p className="admin-empty">{t('adminErrorsNone', lang)}</p>}
      {groups && groups.length > 0 && (
        <ul className="admin-list">
          {groups.map((g) => (
            <li key={g.fingerprint} className="admin-card">
              <p className="admin-head">
                <code>{g.where}</code> {g.msg}
              </p>
              <p className="admin-meta">
                <span>{t('adminErrorsLine', lang, { n: g.count, when: when(g.lastSeen) })}</span>
                <span>
                  {Object.entries(g.ua)
                    .map(([ua, n]) => `${ua} ${n}`)
                    .join(' · ')}
                </span>
                {g.sample.district && <span>{DISTRICT_NAMES[g.sample.district][lang]}</span>}
                <span>
                  <code>{g.sample.build}</code>
                </span>
              </p>
              {g.sample.stack && (
                <details>
                  <summary>{t('adminErrorsStack', lang)}</summary>
                  <pre className="admin-stack">{g.sample.stack}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p className="admin-error" role="alert">
          {t('adminFailed', lang)}
        </p>
      )}
      <button type="button" onClick={() => setVersion((v) => v + 1)}>
        {t('adminErrorsRefresh', lang)}
      </button>
    </section>
  )
}
