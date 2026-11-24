import { useEffect, useState } from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import type { FriendSettings } from '../net/protocol'
import { districtLabel } from './places'
import { FRIENDS_POLL_MS, type Friends } from './useFriends'

interface Props {
  friends: Friends
  lang: Lang
}

const SWITCHES: { key: keyof FriendSettings; label: StringKey; hint?: StringKey }[] = [
  { key: 'showPresence', label: 'friendShowPresence', hint: 'friendShowPresenceHint' },
  { key: 'chaiInvites', label: 'friendChaiInvites' },
]

/**
 * The profile sheet's friends: asks to answer, each friend (with "gali mein hai · <district>" only when the server
 * says so), asks still waiting, and the two switches. Open, it looks again every `FRIENDS_POLL_MS`.
 */
export function FriendsPanel({ friends, lang }: Props) {
  const { lists, failed, refresh } = friends
  const [note, setNote] = useState<StringKey | null>(null)
  /** The friend whose removal is being confirmed. */
  const [removing, setRemoving] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void refresh(true)
    const timer = setInterval(() => void refresh(true), FRIENDS_POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const act = async (key: string, fn: () => Promise<boolean>, failure: StringKey) => {
    setBusy(key)
    setNote(null)
    const ok = await fn()
    setBusy(null)
    if (!ok) setNote(failure)
    return ok
  }

  return (
    <section className="friends-panel" aria-label={t('friendsTitle', lang)}>
      <h3>{t('friendsTitle', lang)}</h3>
      {note && <p role="alert">{t(note, lang)}</p>}
      {!lists && failed && <p role="status">{t('friendsLoadFailed', lang)}</p>}
      {lists && (
        <>
          {lists.incoming.length > 0 && (
            <div className="friends-incoming">
              <h4>{t('friendsIncoming', lang)}</h4>
              <ul>
                {lists.incoming.map((a) => (
                  <li key={a.id}>
                    <span>{a.name}</span>
                    <button
                      type="button"
                      disabled={busy === a.id}
                      onClick={() => void act(a.id, () => friends.answer(a.id, true), 'friendAnswerFailed')}
                    >
                      {t('friendAccept', lang)}
                    </button>
                    <button
                      type="button"
                      disabled={busy === a.id}
                      onClick={() => void act(a.id, () => friends.answer(a.id, false), 'friendAnswerFailed')}
                    >
                      {t('friendDecline', lang)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lists.friends.length === 0 && lists.sent.length === 0 ? (
            <p>{t('friendsNone', lang)}</p>
          ) : (
            <ul className="friends-list">
              {lists.friends.map((f) => (
                <li key={f.id}>
                  <span className="friend-name">
                    {f.name}
                    {f.here && (
                      <small className="friend-here">
                        {t('friendHere', lang, { place: districtLabel(f.here, lang) })}
                      </small>
                    )}
                  </span>
                  {removing === f.id ? (
                    <button
                      type="button"
                      disabled={busy === f.id}
                      onClick={() =>
                        void act(f.id, () => friends.remove(f.id), 'friendRemoveFailed').then(
                          (ok) => ok && setRemoving(null),
                        )
                      }
                    >
                      {t('friendRemoveSure', lang)}
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={t('friendRemoveLabel', lang, { name: f.name })}
                      onClick={() => setRemoving(f.id)}
                    >
                      {t('friendRemove', lang)}
                    </button>
                  )}
                </li>
              ))}
              {lists.sent.map((a) => (
                <li key={`sent:${a.id}`} className="friend-waiting">
                  <span>{t('friendWaiting', lang, { name: a.name })}</span>
                </li>
              ))}
            </ul>
          )}
          {SWITCHES.map(({ key, label, hint }) => (
            <label className="check" key={key}>
              <input
                type="checkbox"
                data-field={key}
                checked={lists.settings[key]}
                disabled={busy === key}
                onChange={(e) =>
                  void act(
                    key,
                    () => friends.setSettings({ [key]: e.target.checked }),
                    'friendSettingsFailed',
                  )
                }
              />
              <span>
                {t(label, lang)}
                {hint && <small>{t(hint, lang)}</small>}
              </span>
            </label>
          ))}
        </>
      )}
    </section>
  )
}
