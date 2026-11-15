import { useEffect, useState } from 'react'
import { t, type Lang, type StringKey } from '../i18n/strings'
import { disablePush, enablePush, pushIsOn, pushSupport, type PushSupport } from './push'

/** Why push is not offered here, said instead of the switch. */
const WHY_NOT: Partial<Record<PushSupport, StringKey>> = {
  'in-app': 'pushInApp',
  'ios-browser': 'pushIos',
  unsupported: 'pushUnsupported',
}

interface Props {
  lang: Lang
  token: () => Promise<string | null>
  /** Where this runs; worked out from the browser when left out (tests pass it). */
  support?: PushSupport
}

/**
 * "Naye messages pe batao", in the profile sheet: push notifications for this device, on or off at once (not
 * with Save). Where a device cannot have them, it says why and how instead; a build without a VAPID key shows
 * nothing at all.
 */
export function PushToggle({ lang, token, support: given }: Props) {
  const [support] = useState(() => given ?? pushSupport())
  /** null while finding out. */
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<'pushDenied' | 'pushFailed' | null>(null)
  useEffect(() => {
    if (support !== 'ok') return
    let live = true
    void pushIsOn().then((v) => live && setOn(v))
    return () => {
      live = false
    }
  }, [support])

  if (support === 'off') return null
  const why = WHY_NOT[support]
  if (why)
    return (
      <div className="push-setting">
        <p>
          <strong>{t('pushToggle', lang)}</strong>
          <small>{t(why, lang)}</small>
        </p>
      </div>
    )

  const flip = async (want: boolean) => {
    setBusy(true)
    setNote(null)
    const tok = await token().catch(() => null)
    if (!want) {
      await disablePush(tok)
      setOn(false)
    } else {
      const outcome = tok ? await enablePush(tok, lang) : 'failed'
      setOn(outcome === 'on')
      if (outcome === 'denied') setNote('pushDenied')
      if (outcome === 'failed') setNote('pushFailed')
    }
    setBusy(false)
  }
  return (
    <div className="push-setting">
      <label className="check">
        <input
          data-field="push"
          type="checkbox"
          checked={on === true}
          disabled={on === null || busy}
          onChange={(e) => void flip(e.target.checked)}
        />
        <span>
          {t('pushToggle', lang)}
          <small>{t('pushHint', lang)}</small>
        </span>
      </label>
      {note && <p role="alert">{t(note, lang)}</p>}
    </div>
  )
}
