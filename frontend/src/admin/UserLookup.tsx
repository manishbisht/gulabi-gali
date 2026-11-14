import { useRef, useState, type FormEvent } from 'react'
import { t, type Lang } from '../i18n/strings'
import type { AdminUser } from '../net/protocol'
import { actOn, daysSince, findUsers, isMuted, when, type Token, type UserAction } from './adminApi'

/** Who someone is to the moderator: name and id, account age, who vouched for them, and their trust state. */
export function UserSummary({ user, lang }: { user: AdminUser; lang: Lang }) {
  const [now] = useState(Date.now)
  const muted = isMuted(user, now)
  return (
    <div className="admin-user">
      <p className="admin-name">
        <strong>{user.profile?.name ?? t('adminNoProfile', lang)}</strong> <code>{user.id}</code>
      </p>
      <p className="admin-meta">
        <span>
          {user.createdAt === null
            ? t('adminNoAccount', lang)
            : t('adminAge', lang, { days: daysSince(user.createdAt) })}
        </span>
        <span>
          {user.verified
            ? t('adminVerifiedBy', lang, { by: user.verifiedBy ?? '?' })
            : t('adminNotVerified', lang)}
        </span>
        {user.openReports > 0 && <span>{t('adminOpenAbout', lang, { n: user.openReports })}</span>}
        {user.banned && <span className="admin-flag">{t('adminBanned', lang)}</span>}
        {user.hidden && <span className="admin-flag">{t('adminHidden', lang)}</span>}
        {muted && (
          <span className="admin-flag">{t('adminMutedUntil', lang, { time: when(user.mutedUntil!) })}</span>
        )}
      </p>
    </div>
  )
}

/** The in-sheet "Ban them?" question: a ban is the one action that never happens on a single tap. */
export function ConfirmBan({
  name,
  lang,
  busy,
  onYes,
  onNo,
}: {
  name: string
  lang: Lang
  busy: boolean
  onYes(): void
  onNo(): void
}) {
  return (
    <div className="admin-confirm" role="alertdialog" aria-label={t('adminBan', lang)}>
      <p>{t('adminBanAsk', lang, { name })}</p>
      <div className="admin-actions">
        <button type="button" className="admin-danger" disabled={busy} onClick={onYes}>
          {t('adminBanYes', lang)}
        </button>
        <button type="button" disabled={busy} onClick={onNo}>
          {t('adminCancel', lang)}
        </button>
      </div>
    </div>
  )
}

/**
 * One-tap actions on a person (a ban asks first). Buttons stay disabled while a call is out, and every action
 * is idempotent on the server, so a slow network's double tap changes nothing. `onChange` gets the person as
 * the server now has them.
 */
export function UserActions({
  user,
  lang,
  token,
  onChange,
}: {
  user: AdminUser
  lang: Lang
  token: Token
  onChange(user: AdminUser): void
}) {
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState(false)
  /** Set at once on a tap (state is not, until the next render): a second tap meanwhile does nothing. */
  const inflight = useRef(false)
  // When this row was drawn: a mute that ran out since still shows until the next fetch.
  const [now] = useState(Date.now)
  if (user.createdAt === null) return null
  const run = async (action: UserAction) => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true)
    setFailed(false)
    const out = await actOn(token, user.id, action)
    inflight.current = false
    setBusy(false)
    setAsking(false)
    if (out.ok) onChange(out.value)
    else setFailed(true)
  }
  const muted = isMuted(user, now)
  const button = (label: Parameters<typeof t>[0], action: UserAction) => (
    <button type="button" disabled={busy} onClick={() => void run(action)}>
      {t(label, lang)}
    </button>
  )
  return (
    <>
      {asking ? (
        <ConfirmBan
          name={user.profile?.name ?? user.id}
          lang={lang}
          busy={busy}
          onYes={() => void run('ban')}
          onNo={() => setAsking(false)}
        />
      ) : (
        <div className="admin-actions">
          {user.banned ? (
            button('adminUnban', 'unban')
          ) : (
            <button type="button" className="admin-danger" disabled={busy} onClick={() => setAsking(true)}>
              {t('adminBan', lang)}
            </button>
          )}
          {muted ? button('adminUnmute', 'unmute') : button('adminMute', 'mute')}
          {!user.verified && button('adminVerify', 'verify')}
          {user.hidden && button('adminUnhide', 'unhide')}
        </div>
      )}
      {failed && (
        <p className="admin-error" role="alert">
          {t('adminFailed', lang)}
        </p>
      )}
    </>
  )
}

/** Find someone by the start of their name, or by their whole id, and act on them. */
export function UserLookup({ lang, token, onChanged }: { lang: Lang; token: Token; onChanged(): void }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<AdminUser[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const search = async (e: FormEvent) => {
    e.preventDefault()
    if (!q.trim() || busy) return
    setBusy(true)
    setFailed(false)
    const out = await findUsers(token, q.trim())
    setBusy(false)
    if (out.ok) setFound(out.value)
    else setFailed(true)
  }
  const replace = (next: AdminUser) => {
    setFound((was) => was && was.map((u) => (u.id === next.id ? next : u)))
    onChanged()
  }
  return (
    <section className="admin-section" aria-labelledby="admin-lookup">
      <h2 id="admin-lookup">{t('adminLookup', lang)}</h2>
      <form className="admin-search" onSubmit={(e) => void search(e)}>
        <label>
          {t('adminLookupLabel', lang)}
          <input value={q} maxLength={100} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="submit" disabled={busy}>
          {t('adminSearch', lang)}
        </button>
      </form>
      {failed && (
        <p className="admin-error" role="alert">
          {t('adminFailed', lang)}
        </p>
      )}
      {found && found.length === 0 && <p className="admin-empty">{t('adminNoResults', lang)}</p>}
      {found && found.length > 0 && (
        <ul className="admin-list">
          {found.map((u) => (
            <li key={u.id} className="admin-card">
              <UserSummary user={u} lang={lang} />
              <UserActions user={u} lang={lang} token={token} onChange={replace} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
