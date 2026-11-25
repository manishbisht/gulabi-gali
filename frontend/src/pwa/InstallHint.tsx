import { useEffect, useRef, useState } from 'react'
import { isInAppBrowser } from '../auth/inApp'
import { HINTED_KEY } from '../ui/FirstHint'
import { t, type Lang } from '../i18n/strings'
import { storage } from '../storage'
import { isStandalone } from './device'
import {
  cityTime,
  countCityTime,
  hintDue,
  INSTALL_HINT_DELAY_MS,
  INSTALL_HINT_KEY,
  INSTALL_HINT_SEEN_MS,
  installWay,
  markHintShown,
  onInstallChange,
  promptInstall,
  thisInstallDevice,
  type InstallWay,
} from './install'

/** How often the time on screen is counted. */
const TICK_MS = 1000
/** A hint nobody answers goes away by itself after this long on screen: it asked once, and that is enough. */
const SHOWN_MS = 30_000

interface Props {
  lang: Lang
  /**
   * Something is over the street (a sheet, a card, a ride, the kite game, a bench, the roof, photo mode): the hint
   * neither counts the time nor shows, and one already up steps aside until the street is clear again.
   */
  busy?: boolean
}

/**
 * "Home screen pe rakho": one quiet line under the HUD, after `INSTALL_HINT_DELAY_MS` of the city on screen with
 * nothing over it (and the first visit's steps closed), where this browser can install the city. With Chrome's offer
 * it has a button that opens Chrome's own dialog; in Safari on an iPhone it says where Safari keeps "Add to Home
 * Screen". It counts as asked only once it has been in view, uncovered, for `INSTALL_HINT_SEEN_MS` (or was answered):
 * then it rests a month (see `hintDue`). It closes by itself if left alone. Not a dialog: the street stays walkable
 * under it, and nothing takes focus.
 */
export function InstallHint({ lang, busy = false }: Props) {
  const [way, setWay] = useState<InstallWay | null>(null)
  const busyRef = useRef(busy)
  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    // nothing to count where it can never show: inside an app, opened from the home screen, or resting
    if (isInAppBrowser() || isStandalone()) return
    if (!hintDue(storage.get(INSTALL_HINT_KEY), Date.now())) return
    let tick = 0
    const tryShow = () => {
      if (busyRef.current || cityTime() < INSTALL_HINT_DELAY_MS || storage.get(HINTED_KEY) !== '1') return
      // asked again now, not at the start: Chrome's offer can come late, or be withdrawn
      const next = installWay(thisInstallDevice())
      if (!next || !hintDue(storage.get(INSTALL_HINT_KEY), Date.now())) return
      clearInterval(tick) // nothing more to count on this page
      setWay(next)
    }
    tick = window.setInterval(() => {
      if (!document.hidden && !busyRef.current) countCityTime(TICK_MS)
      tryShow()
    }, TICK_MS)
    const off = onInstallChange(() => {
      // installed while waiting (from Chrome's menu): never ask; a fresh offer: maybe now
      if (storage.get(INSTALL_HINT_KEY) === 'installed') setWay(null)
      else tryShow()
    })
    return () => {
      clearInterval(tick)
      off()
    }
  }, [])

  const visible = !!way && !busy
  useEffect(() => {
    if (!visible) return
    // seen once it has been in view a moment; covered or gone sooner, it may ask again
    const seen = window.setTimeout(() => markHintShown(), INSTALL_HINT_SEEN_MS)
    const done = window.setTimeout(() => setWay(null), SHOWN_MS)
    return () => {
      clearTimeout(seen)
      clearTimeout(done)
    }
  }, [visible])

  if (!visible) return null
  const close = () => {
    markHintShown()
    setWay(null)
  }
  return (
    <div className="install-hint" role="status">
      <span>{t(way === 'ios' ? 'installHintIos' : 'installHint', lang)}</span>
      {way === 'prompt' && (
        <button
          type="button"
          className="install-hint-go"
          onClick={() => {
            close()
            void promptInstall()
          }}
        >
          {t('installHintGo', lang)}
        </button>
      )}
      <button
        type="button"
        className="install-hint-close"
        aria-label={t('installHintDismiss', lang)}
        onClick={close}
      >
        ×
      </button>
    </div>
  )
}
