import { useEffect, useRef, useState } from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import { sendChai, type ChaiOutcome } from '../net/friends'
import type { Bench } from '../world/benches'
import type { Friends } from './useFriends'

interface Props {
  /** The bench the player sits at now. */
  bench: Bench
  friends: Friends
  lang: Lang
  token(): Promise<string | null>
}

/** How long "Invite sent" (or why not) stays up. */
const NOTE_MS = 4000

const NOTES: Record<ChaiOutcome, StringKey> = {
  sent: 'chaiSent',
  'not-seated': 'chaiNotSeated',
  rate: 'chaiRate',
  muted: 'benchMuted',
  failed: 'chaiFailed',
}

/**
 * "Chai pe bulao", in the bench panel: picks a friend and invites them to this bench. The server answers every
 * invite that gets past your own checks the same way ("Invite sent"), whether it reached them or not, so this
 * never says more than that.
 */
export function ChaiInvite({ bench, friends, lang, token }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<StringKey | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const { lists, refresh } = friends

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const invite = async (id: string) => {
    setBusy(true)
    const tok = await token().catch(() => null)
    const outcome = tok ? await sendChai(tok, id, bench.id, bench.kind) : 'failed'
    setBusy(false)
    if (outcome === 'sent') setOpen(false)
    setNote(NOTES[outcome])
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setNote(null), NOTE_MS)
  }

  return (
    <div className="chai-invite" data-open={open ? '' : undefined}>
      {open ? (
        <div className="chai-pick" role="group" aria-label={t('chaiPick', lang)}>
          <p>{t('chaiPick', lang)}</p>
          {lists && lists.friends.length === 0 && <p className="bench-footer">{t('chaiNoFriends', lang)}</p>}
          {lists && lists.friends.length > 0 && (
            <ul>
              {lists.friends.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="person-close"
                    disabled={busy}
                    aria-label={t('chaiInviteLabel', lang, { name: f.name })}
                    onClick={() => void invite(f.id)}
                  >
                    {f.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="person-close" onClick={() => setOpen(false)}>
            {t('chaiClose', lang)}
          </button>
        </div>
      ) : (
        <button type="button" className="person-close chai-button" onClick={() => setOpen(true)}>
          {t('chaiButton', lang)}
        </button>
      )}
      <span role="status" className="chai-note">
        {note ? t(note, lang) : ''}
      </span>
    </div>
  )
}
