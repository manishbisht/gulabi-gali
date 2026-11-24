import type { ReactNode } from 'react'
import { t, type Lang } from '../i18n/strings'
import type { CitySnapshot } from '../net/protocol'

interface Props {
  /** The district's name, already in the current language. */
  place: string
  /** What the place chip shows where the full name is too long for a small phone's row; the full name stays its accessible name. */
  placeShort?: string
  snapshot: CitySnapshot | null
  /** One line of city small talk, shown under the chips (in one card with the festival's lines). */
  line?: string
  /** A festival greeting, already in the current language. */
  banner?: string
  /** A line under the banner while a procession is on the street, already in the current language. */
  procession?: string
  /** Stamp progress as `N/total`; with every stamp the chip shows a shorter `✓ total`, its name the whole count. */
  stamps: string
  /** Opens the Jaipur Darshan list; the stamps chip is a button when present. */
  onStamps?: () => void
  lang: Lang
  onLang: (l: Lang) => void
  /** The sound switch (the horn, the metro's arrival chime and the "Wo kaata" chirp): whether it is on, and how to flip it. */
  sound?: { on: boolean; onToggle: () => void }
  /** The monkey's switch, a small chip for the Walled City only: whether the monkey is off, and how to flip it. */
  bandar?: { off: boolean; onToggle: () => void }
  /** The visibility chip; present only when sign-in exists. */
  visibility?: ReactNode
  /** Present only when a user is signed in. */
  onProfile?: () => void
  /** Present only for a resident: opens the invite code sheet (enter a code, or share your own). */
  onInvite?: () => void
  /** Present only for a resident: opens Connections, with the count of unread things on its badge. */
  onConnections?: () => void
  connectionsBadge?: number
  /** Opens (or closes) the city map from the place chip; present once a district is in. */
  onMap?: () => void
  /** Opens photo mode; while it is on (`photo`) the HUD draws nothing. */
  onPhoto?: () => void
  photo?: boolean
  /** Opens the dressing room on this device; present for anyone walking with this device's look (no finished profile). */
  onLook?: () => void
  /** Under the top row (toasts), and the bottom row (joystick, landmark card). */
  top?: ReactNode
  bottom?: ReactNode
}

export function Hud({
  place,
  placeShort,
  snapshot,
  line,
  banner,
  procession,
  stamps,
  onStamps,
  lang,
  onLang,
  sound,
  bandar,
  visibility,
  onProfile,
  onInvite,
  onConnections,
  connectionsBadge = 0,
  onMap,
  onPhoto,
  photo = false,
  onLook,
  top,
  bottom,
}: Props) {
  if (photo) return null
  const weather = weatherChip(snapshot) ?? t('weatherUnknown', lang)
  // every stamp: a short "✓ total", narrower than "total/total", so the row keeps its room on a phone
  const [got, all] = stamps.split('/')
  const done = !!got && got === all
  const shown = done ? `✓ ${all}` : stamps
  return (
    <div className="hud">
      <div className="hud-head">
        <div className="hud-stack">
          <div className="hud-top">
            {onMap ? (
              // the place opens its map
              <button
                type="button"
                className="hud-chip place-button"
                aria-keyshortcuts="M"
                aria-haspopup="dialog"
                aria-label={t('mapOpenPlace', lang, { place })}
                onClick={onMap}
              >
                {placeShort ?? place}
              </button>
            ) : (
              <span className="hud-chip">{place}</span>
            )}
            <span className="hud-chip">{weather}</span>
            {onStamps ? (
              <button
                type="button"
                className="hud-chip stamp-count"
                title={t('stampCount', lang)}
                aria-label={`${t('darshanOpen', lang)} (${stamps})`}
                data-done={done ? '' : undefined}
                onClick={onStamps}
              >
                {shown}
              </button>
            ) : (
              <span className="hud-chip stamp-count" title={`${t('stampCount', lang)}: ${stamps}`}>
                {shown}
              </span>
            )}
          </div>
          {(visibility || onProfile || onInvite || onConnections) && (
            <div className="hud-identity">
              {visibility}
              {onProfile && (
                <button type="button" className="hud-chip profile-button" onClick={onProfile}>
                  {t('profileOpen', lang)}
                </button>
              )}
              {onInvite && (
                <button type="button" className="hud-chip profile-button invite-button" onClick={onInvite}>
                  {t('inviteOpen', lang)}
                </button>
              )}
              {onConnections && (
                <button
                  type="button"
                  className="hud-chip profile-button conn-button"
                  aria-keyshortcuts="C"
                  onClick={onConnections}
                >
                  {t('connOpen', lang)}
                  {connectionsBadge > 0 && (
                    <span className="conn-badge" aria-label={t('connBadge', lang, { n: connectionsBadge })}>
                      {connectionsBadge}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}
          {(banner || procession || line) && (
            // the festival, its procession and the city's small talk share one card
            <div className="hud-news" data-festival={banner ? '' : undefined}>
              {banner && (
                <p className="festival-banner" role="status">
                  {banner}
                </p>
              )}
              {procession && (
                <p className="procession-line" role="status">
                  {procession}
                </p>
              )}
              {line && <p className="city-line">{line}</p>}
            </div>
          )}
        </div>
        <div className="hud-toggles" role="group" aria-label={t('hudSwitches', lang)}>
          <button
            type="button"
            className="hud-chip lang-toggle"
            aria-label={t('langToggleLabel', lang)}
            onClick={() => onLang(lang === 'hi' ? 'en' : 'hi')}
          >
            {t('langToggle', lang)}
          </button>
          {sound && (
            // one fixed name; whether it is on is aria-pressed's to say
            <button
              type="button"
              className="hud-chip sound-toggle"
              aria-label={t('soundToggleLabel', lang)}
              aria-pressed={sound.on}
              title={t(sound.on ? 'soundOn' : 'soundOff', lang)}
              onClick={sound.onToggle}
            >
              <span aria-hidden="true">{sound.on ? '🔊' : '🔇'}</span>
            </button>
          )}
          {onPhoto && (
            <button
              type="button"
              className="hud-chip photo-button"
              aria-label={t('photoOpenLabel', lang)}
              title={t('photoOpen', lang)}
              onClick={onPhoto}
            >
              <span aria-hidden="true">📷</span>
            </button>
          )}
          {onLook && (
            // the dressing room of anyone without a finished profile (a resident's is in the profile sheet)
            <button
              type="button"
              className="hud-chip look-button"
              aria-label={t('lookChip', lang)}
              aria-haspopup="dialog"
              title={t('lookOpen', lang)}
              onClick={onLook}
            >
              <span aria-hidden="true">👕</span>
            </button>
          )}
          {bandar && (
            // "Stop the monkey", pressed while it is stopped
            <button
              type="button"
              className="hud-chip bandar-toggle"
              aria-label={t('bandarStop', lang)}
              aria-pressed={bandar.off}
              title={t('bandarStop', lang)}
              onClick={bandar.onToggle}
            >
              <span aria-hidden="true">{bandar.off ? '🙈' : '🐒'}</span>
            </button>
          )}
        </div>
      </div>
      {top}
      <div className="hud-bottom">{bottom}</div>
    </div>
  )
}

/** `31° · AQI 162`, with whichever half is known; null when nothing is, or the data is stale. */
function weatherChip(s: CitySnapshot | null): string | null {
  if (!s || s.stale) return null
  const parts = []
  if (typeof s.tempC === 'number') parts.push(`${Math.round(s.tempC)}°`)
  if (typeof s.aqi === 'number') parts.push(`AQI ${Math.round(s.aqi)}`)
  return parts.length ? parts.join(' · ') : null
}
