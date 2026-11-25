import { useEffect, useState } from 'react'
import { HINTED_KEY } from '../ui/FirstHint'
import { t, type Lang } from '../i18n/strings'
import { storage } from '../storage'
import {
  hintDue,
  INSTALL_HINT_DELAY_MS,
  INSTALL_HINT_KEY,
  installWay,
  markHintShown,
  onInstallChange,
  promptInstall,
  thisInstallDevice,
  type InstallWay,
} from './install'

/** How often the time on screen is counted. */
const TICK_MS = 1000
/** A hint nobody answers goes away by itself after this long: it asked once, and that is enough. */
const SHOWN_MS = 30_000

/**
 * "Home screen pe rakho": one quiet line under the HUD, after `INSTALL_HINT_DELAY_MS` of the city on screen (and the
 * first visit's steps closed), where this browser can install the city. With Chrome's offer it has a button that
 * opens Chrome's own dialog; in Safari on an iPhone it says where Safari keeps "Add to Home Screen". It shows once:
 * it remembers that it did (see `hintDue`), and closes by itself if left alone. Not a dialog: the street stays
 * walkable under it, and nothing takes focus.
 */
export function InstallHint({ lang }: { lang: Lang }) {
  const [way, setWay] = useState<InstallWay | null>(null)

  useEffect(() => {
    if (!hintDue(storage.get(INSTALL_HINT_KEY), Date.now())) return
    let onScreen = 0
    let shown = false
    let tick = 0
    const tryShow = () => {
      if (shown || onScreen < INSTALL_HINT_DELAY_MS || storage.get(HINTED_KEY) !== '1') return
      // asked again now, not at the start: Chrome's offer can come late, or be withdrawn
      const next = installWay(thisInstallDevice())
      if (!next || !hintDue(storage.get(INSTALL_HINT_KEY), Date.now())) return
      shown = true
      clearInterval(tick) // once a visit: nothing more to count
      markHintShown()
      setWay(next)
    }
    tick = window.setInterval(() => {
      if (!document.hidden) onScreen += TICK_MS
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

  useEffect(() => {
    if (!way) return
    const done = window.setTimeout(() => setWay(null), SHOWN_MS)
    return () => clearTimeout(done)
  }, [way])

  if (!way) return null
  return (
    <div className="install-hint" role="status">
      <span>{t(way === 'ios' ? 'installHintIos' : 'installHint', lang)}</span>
      {way === 'prompt' && (
        <button
          type="button"
          className="install-hint-go"
          onClick={() => {
            setWay(null)
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
        onClick={() => setWay(null)}
      >
        ×
      </button>
    </div>
  )
}
