import { useEffect, useState, type FormEvent } from 'react'
import { WordsHint } from '../filter/WordsHint'
import { t, type Lang } from '../i18n/strings'
import { getBlocks, unblockPerson, type ProfileInput } from '../net/api'
import { HERE_FOR, type BlockListEntry, type HereFor, type HomeArea, type Me } from '../net/protocol'
import { loadOrCreateLook, lookFromWire, lookToWire } from '../player/avatar'
import type { AvatarLook } from '../world/types'
import { ReportSheet } from '../ui/ReportSheet'
import { DeleteAccount } from './DeleteAccount'
import { AvatarBuilder } from './AvatarBuilder'
import { areaLabel, HERE_FOR_LABEL, HOME_AREAS } from './homeAreas'
import { LIMITS } from './limits'
import type { SaveOutcome } from './useMe'

const count = (s: string) => [...s].length

/** An empty link, or an https one within the limit (the server has the last word). */
const linkAllowed = (s: string) =>
  s === '' || (s.length <= LIMITS.link && /^https:\/\/[^\s/]+/i.test(s) && !/[\p{Cc}\p{Cf}\s]/u.test(s))

interface Props {
  me: Me
  lang: Lang
  /** Lets the sheet list the people you blocked (first names), with Unblock and Report. */
  token?: () => Promise<string | null>
  onSave: (p: ProfileInput) => Promise<SaveOutcome>
  onClose: () => void
  onSignOut: () => void
  /** Opens the privacy note. */
  onPrivacy?: () => void
  /** Erases the account (true once gone). Without it the sheet has no delete button. */
  onDelete?: () => Promise<boolean>
}

export function ProfileSheet({ me, lang, token, onSave, onClose, onSignOut, onPrivacy, onDelete }: Props) {
  const p = me.profile
  const [name, setName] = useState(p?.name ?? '')
  const [look, setLook] = useState<AvatarLook>(() => (p && lookFromWire(p.look)) || loadOrCreateLook())
  const [area, setArea] = useState<HomeArea | ''>(p?.homeArea ?? '')
  const [status, setStatus] = useState(p?.status ?? '')
  const [hereFor, setHereFor] = useState<HereFor | null>(p?.hereFor ?? null)
  const [about, setAbout] = useState(p?.about ?? '')
  const [link, setLink] = useState(p?.link ?? '')
  /** Until the link field is touched the save leaves `link` out, so the stored one stays. */
  const [linkTouched, setLinkTouched] = useState(false)
  const [adult, setAdult] = useState(me.complete)
  const [pledge, setPledge] = useState(me.complete)
  const [paused, setPaused] = useState(p?.pauseRequests ?? false)
  const [busy, setBusy] = useState(false)
  const [bad, setBad] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  const [wordsRefused, setWordsRefused] = useState(false)

  /** Whom you blocked: null while loading or when it could not load. */
  const [blocked, setBlocked] = useState<BlockListEntry[] | null>(null)
  const [blockedNote, setBlockedNote] = useState<'load' | 'unblock' | null>(null)
  /** Someone blocked, being reported: a block alone tells the moderator nothing. */
  const [reporting, setReporting] = useState<BlockListEntry | null>(null)
  useEffect(() => {
    if (!token || !me.complete) return
    const ctl = new AbortController()
    void (async () => {
      try {
        const tok = await token()
        if (tok) setBlocked(await getBlocks(tok, ctl.signal))
      } catch {
        if (!ctl.signal.aborted) setBlockedNote('load')
      }
    })()
    return () => ctl.abort()
  }, [token, me.complete])
  const unblock = async (handle: string) => {
    setBlockedNote(null)
    const tok = token ? await token().catch(() => null) : null
    if (tok && (await unblockPerson(tok, handle)))
      setBlocked((was) => was && was.filter((b) => b.handle !== handle))
    else setBlockedNote('unblock')
  }

  const trimmed = name.trim()
  const nameOk = count(trimmed) >= LIMITS.name.min && count(trimmed) <= LIMITS.name.max
  const lengthsOk = count(status.trim()) <= LIMITS.status && count(about.trim()) <= LIMITS.about
  const linkOk = !linkTouched || linkAllowed(link.trim())
  const ready = nameOk && lengthsOk && linkOk && area !== '' && adult && pledge && !busy

  /** Editing a field clears the server's complaint about it. */
  const edit =
    <T,>(field: string, set: (v: T) => void) =>
    (v: T) => {
      setBad((b) => b.filter((f) => f !== field))
      setWordsRefused(false)
      set(v)
    }
  const invalid = (field: string) => (bad.includes(field) ? true : undefined)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setFailed(false)
    setWordsRefused(false)
    const result = await onSave({
      name: trimmed,
      look: lookToWire(look),
      status: status.trim(),
      homeArea: area,
      hereFor,
      about: about.trim(),
      ...(linkTouched ? { link: link.trim() === '' ? null : link.trim() } : {}),
      adult,
      pledge,
      pauseRequests: paused,
    })
    setBusy(false)
    if (result.ok) return onClose()
    setBad(result.fields)
    setWordsRefused(result.words === true)
    setFailed(result.fields.length === 0)
  }

  return (
    <div className="auth-scrim">
      <section
        className="auth-sheet profile-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('profileTitle', lang)}
      >
        <h2>{t('profileTitle', lang)}</h2>
        <form className="auth-form" onSubmit={submit}>
          <label>
            {t('profileName', lang)}
            <input
              data-field="name"
              value={name}
              autoComplete="off"
              aria-invalid={invalid('name')}
              onChange={(e) => edit('name', setName)(e.target.value)}
            />
            <small>
              {count(name)}/{LIMITS.name.max}
            </small>
            <WordsHint text={name} lang={lang} />
          </label>
          <AvatarBuilder look={look} lang={lang} onChange={setLook} />
          <label>
            {t('profileArea', lang)}
            <select
              data-field="homeArea"
              value={area}
              aria-invalid={invalid('homeArea')}
              onChange={(e) => edit('homeArea', setArea)(e.target.value as HomeArea | '')}
            >
              <option value="">{t('profileAreaPick', lang)}</option>
              {HOME_AREAS.map((a) => (
                <option key={a} value={a}>
                  {areaLabel(a, lang)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('profileStatus', lang)}
            <input
              data-field="status"
              value={status}
              placeholder={t('profileStatusHint', lang)}
              aria-invalid={invalid('status')}
              onChange={(e) => edit('status', setStatus)(e.target.value)}
            />
            <small>
              {count(status)}/{LIMITS.status}
            </small>
            <WordsHint text={status} lang={lang} />
          </label>
          <div className="pick-row" role="group" aria-label={t('profileHereFor', lang)}>
            <span>{t('profileHereFor', lang)}</span>
            {HERE_FOR.map((h) => (
              <button
                key={h}
                type="button"
                className="pick pick-text"
                aria-pressed={hereFor === h}
                onClick={() => setHereFor(hereFor === h ? null : h)}
              >
                {t(HERE_FOR_LABEL[h], lang)}
              </button>
            ))}
          </div>
          <label>
            {t('profileAbout', lang)}
            <textarea
              data-field="about"
              rows={3}
              value={about}
              aria-invalid={invalid('about')}
              onChange={(e) => edit('about', setAbout)(e.target.value)}
            />
            <small>
              {count(about)}/{LIMITS.about}
            </small>
            <WordsHint text={about} lang={lang} />
          </label>
          <label>
            {t('profileLink', lang)}
            <input
              data-field="link"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={link}
              placeholder="https://"
              aria-invalid={!linkOk || invalid('link')}
              onChange={(e) => {
                setLinkTouched(true)
                edit('link', setLink)(e.target.value)
              }}
            />
            <small>{t('profileLinkHint', lang)}</small>
          </label>
          <label className="check">
            <input
              data-field="adult"
              type="checkbox"
              checked={adult}
              onChange={(e) => setAdult(e.target.checked)}
            />
            {t('profileAdult', lang)}
          </label>
          <label className="check">
            <input
              data-field="pledge"
              type="checkbox"
              checked={pledge}
              onChange={(e) => setPledge(e.target.checked)}
            />
            {t('profilePledge', lang)}
          </label>
          <p className="profile-privacy">{t('profilePrivacy', lang)}</p>
          <label className="check">
            <input
              data-field="pauseRequests"
              type="checkbox"
              checked={paused}
              onChange={(e) => setPaused(e.target.checked)}
            />
            <span>
              {t('profilePause', lang)}
              <small>{t('profilePauseHint', lang)}</small>
            </span>
          </label>
          {bad.length > 0 && (
            <p role="alert">{t(wordsRefused ? 'wordsHint' : 'profileFieldsFailed', lang)}</p>
          )}
          {failed && <p role="alert">{t('profileSaveFailed', lang)}</p>}
          <button type="submit" disabled={!ready}>
            {t(busy ? 'profileSaving' : 'profileSave', lang)}
          </button>
        </form>
        {token && me.complete && (blocked || blockedNote) && (
          <div className="blocked-list">
            <h3>{t('blockedTitle', lang)}</h3>
            {blockedNote && (
              <p role="alert">{t(blockedNote === 'load' ? 'blockedLoadFailed' : 'unblockFailed', lang)}</p>
            )}
            {reporting && (
              <ReportSheet
                key={reporting.handle}
                kind="person"
                targetId={reporting.handle}
                fromBlockList
                name={reporting.name ?? t('blockedSomeone', lang)}
                lang={lang}
                token={token}
                onClose={() => setReporting(null)}
              />
            )}
            {blocked &&
              (blocked.length === 0 ? (
                <p>{t('blockedNone', lang)}</p>
              ) : (
                <ul>
                  {blocked.map((b) => (
                    <li key={b.handle}>
                      <span>{b.name ?? t('blockedSomeone', lang)}</span>
                      <button type="button" onClick={() => void unblock(b.handle)}>
                        {t('unblockButton', lang)}
                      </button>
                      <button type="button" disabled={reporting !== null} onClick={() => setReporting(b)}>
                        {t('reportButton', lang)}
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        )}
        <button type="button" className="auth-close" onClick={onClose}>
          {t('profileNotNow', lang)}
        </button>
        <button type="button" className="auth-close" onClick={onSignOut}>
          {t('profileSignOut', lang)}
        </button>
        {onPrivacy && (
          <button type="button" className="auth-close" onClick={onPrivacy}>
            {t('privacyLink', lang)}
          </button>
        )}
        {onDelete && me.profile && <DeleteAccount lang={lang} onDelete={onDelete} />}
      </section>
    </div>
  )
}
