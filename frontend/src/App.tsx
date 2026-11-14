import { useEffect, useRef, useState } from 'react'
import { createStage, type Stage } from './engine/stage'
import { hasWebGL } from './engine/webgl'
import { useAuth } from './auth/useAuth'
import { ProfileSheet } from './profile/ProfileSheet'
import { useMe } from './profile/useMe'
import { VisibilityChip } from './ui/VisibilityChip'
import { loadOrCreateLook, lookFromWire } from './player/avatar'
import { useLang } from './i18n/lang'
import { t, type StringKey } from './i18n/strings'
import { cityLine } from './live/cityLine'
import { useLiveCity } from './live/useLiveCity'
import { createControls, type Controls } from './player/controls'
import { disposeAvatarCache } from './player/avatar'
import { createCitySession, type CitySession } from './world/session'
import { useNpcCard } from './world/useNpcCard'
import { TOTAL_STAMPS } from './world/stamps'
import { useStamps } from './world/useStamps'
import { DISTRICT_NAMES } from './world/districtNames'
import { savedDistrict, useTravel } from './world/useTravel'
import type { DistrictId, FestivalId } from './net/protocol'
import type { DistrictDef } from './world/types'
import { Hud } from './ui/Hud'
import { Intro } from './ui/Intro'
import { LandmarkCard } from './ui/LandmarkCard'
import { Joystick } from './ui/Joystick'
import { NpcCard } from './ui/NpcCard'
import { NoWebGL } from './ui/NoWebGL'
import { TravelSheet } from './ui/TravelSheet'

const FESTIVALS: Record<FestivalId, StringKey> = {
  sankranti: 'festivalSankranti',
  holi: 'festivalHoli',
  gangaur: 'festivalGangaur',
  teej: 'festivalTeej',
  diwali: 'festivalDiwali',
  jlf: 'festivalJlf',
}

/** `?gg-festival=<id>` stands in for the live festival, in test mode only. */
function festivalOverride(): FestivalId | null {
  const q = new URLSearchParams(location.search)
  const id = q.get('gg-festival')
  return q.get('gg-test') === '1' && id && Object.hasOwn(FESTIVALS, id) ? (id as FestivalId) : null
}

export default function App() {
  const [lang, setLang] = useLang()
  const auth = useAuth()
  const [entered, setEntered] = useState(false)
  const [place, setPlace] = useState<DistrictDef['name'] | 'loading' | 'failed'>('loading')
  const [here, setHere] = useState<DistrictId>('walled-city')
  const [webgl] = useState(hasWebGL)
  /** The renderer could not start (WebGL2 missing or the context was refused). */
  const [stageFailed, setStageFailed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controlsRef = useRef<Controls | null>(null)
  const { near, have, toast, collectHere, track } = useStamps(lang)
  const { npc: talking, tap: tapNpc, close: closeNpc, isOpen: npcOpen, step: stepNpc } = useNpcCard()
  const {
    fading,
    failed: travelFailed,
    nearStation,
    sheetOpen,
    openSheet,
    closeSheet,
    travelTo,
    trackStation,
    bind: bindTravel,
  } = useTravel()
  const { me, save } = useMe()
  /** The look the profile gives the player; read by the session whenever a district opens. */
  const profileLook = (me?.complete && me.profile && lookFromWire(me.profile.look)) || null
  const profileLookRef = useRef(profileLook)
  /** The sheet opens by itself for an incomplete profile until the visitor says "not now". */
  const [profileOpen, setProfileOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const profileShown = !!me && (profileOpen || (!me.complete && !dismissed))
  const closeProfile = () => {
    setProfileOpen(false)
    setDismissed(true)
  }
  const bubbleHost = useRef<HTMLDivElement>(null)
  const langRef = useRef(lang)
  useEffect(() => {
    langRef.current = lang
  }, [lang])
  const { snapshot, current, now, patch, freeze } = useLiveCity()
  /** The city session, while the stage is up; it re-paints the sky when a new snapshot lands. */
  const session = useRef<CitySession | null>(null)
  useEffect(() => session.current?.repaint(), [snapshot])
  const lookKey = profileLook && `${profileLook.skin}|${profileLook.outfit}|${profileLook.head}`
  useEffect(() => {
    const had = profileLookRef.current
    profileLookRef.current = profileLook
    // signing out (or losing the profile) brings the visitor's own ghost look back at once
    if (profileLook) session.current?.setLook(profileLook)
    else if (had) session.current?.setLook(loadOrCreateLook())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the look's value, not its identity
  }, [lookKey])
  /**
   * Who the live socket connects as: a resident's token, or nobody (a ghost). Read by the session on every
   * connect; when it changes, the session reconnects so the visitor appears or vanishes without a reload.
   */
  const residentId = auth.signedIn && me?.complete ? me.id : null
  const liveToken = useRef<() => Promise<string | null>>(async () => null)
  const liveAs = useRef<string | null>(null)
  const [replaced, setReplaced] = useState(false)
  useEffect(() => {
    liveToken.current = residentId ? auth.token : async () => null
    if (liveAs.current === residentId) return
    liveAs.current = residentId
    session.current?.reconnectLive()
  }, [residentId, auth.token])
  const [override] = useState(festivalOverride)
  const festival = override ?? snapshot?.festival ?? null

  useEffect(() => {
    const canvas = canvasRef.current
    const bubbles = bubbleHost.current
    if (!entered || !canvas || !bubbles) return
    let stage: Stage
    try {
      stage = createStage(canvas)
    } catch {
      queueMicrotask(() => setStageFailed(true)) // not synchronously: this is an effect body
      return
    }
    const controls = createControls(window)
    controlsRef.current = controls
    const city = createCitySession({
      stage,
      controls,
      canvas,
      bubbleHost: bubbles,
      start: savedDistrict(),
      hooks: {
        lang: () => langRef.current,
        track,
        trackStation,
        npcCard: { step: stepNpc, tap: tapNpc, close: closeNpc, isOpen: npcOpen },
        live: { current, now, patch, freeze },
        look: () => profileLookRef.current,
        festival: () => override ?? current().festival,
        presence: { token: () => liveToken.current(), replaced: setReplaced },
        place: (def) => {
          setPlace(def ? def.name : 'failed')
          if (def) setHere(def.id)
        },
      },
    })
    session.current = city
    bindTravel(city.travelTo)

    return () => {
      bindTravel(null)
      session.current = null
      city.dispose()
      disposeAvatarCache() // after the last player and NPC, before the renderer that drew them goes
      controls.dispose()
      controlsRef.current = null
      stage.dispose()
    }
  }, [
    entered,
    track,
    tapNpc,
    closeNpc,
    npcOpen,
    stepNpc,
    trackStation,
    bindTravel,
    current,
    now,
    patch,
    freeze,
    override,
  ])

  const visibility =
    auth.mode === 'none' || !auth.ready ? undefined : !auth.signedIn ? (
      <VisibilityChip
        state="ghost"
        lang={lang}
        cta={{ label: t('signInButton', lang), onClick: auth.openSignIn }}
      />
    ) : me?.complete ? (
      <VisibilityChip state="resident" lang={lang} />
    ) : me ? (
      <VisibilityChip
        state="ghost"
        lang={lang}
        cta={{ label: t('visibilityFinish', lang), onClick: () => setProfileOpen(true) }}
      />
    ) : (
      // signed in, but /api/me is loading or failed: still say so, and never leave them stuck
      <VisibilityChip
        state="ghost"
        lang={lang}
        cta={{ label: t('profileSignOut', lang), onClick: () => void auth.signOut() }}
      />
    )

  if (!webgl || stageFailed) return <NoWebGL lang={lang} />
  if (!entered) return <Intro lang={lang} onLang={setLang} onEnter={() => setEntered(true)} />
  return (
    <>
      <canvas ref={canvasRef} className="stage" />
      <div ref={bubbleHost} className="npc-bubbles" aria-hidden="true" />
      <Hud
        place={
          typeof place === 'string' ? t(place === 'failed' ? 'loadFailed' : 'loading', lang) : place[lang]
        }
        snapshot={snapshot}
        line={snapshot && !snapshot.stale ? cityLine(snapshot, lang) : undefined}
        banner={festival ? t(FESTIVALS[festival], lang) : undefined}
        stamps={`${have.length}/${TOTAL_STAMPS}`}
        lang={lang}
        onLang={setLang}
        visibility={visibility}
        onProfile={auth.signedIn && me ? () => setProfileOpen(true) : undefined}
        top={
          <>
            {toast && (
              <div className="toast" role="status">
                {toast}
              </div>
            )}
            {replaced && (
              <div className="toast" role="status">
                {t('liveReplaced', lang)}
              </div>
            )}
            {travelFailed && (
              <div className="toast" role="status">
                {t('metroFailed', lang, { place: DISTRICT_NAMES[travelFailed][lang] })}
              </div>
            )}
          </>
        }
        bottom={
          <>
            <Joystick lang={lang} onChange={(v) => controlsRef.current?.setJoystick(v)} />
            {nearStation && !near && !sheetOpen && (
              <button type="button" className="metro-button" onClick={openSheet}>
                {t('metro', lang)}
              </button>
            )}
            {near ? (
              <LandmarkCard
                landmark={near}
                lang={lang}
                stamped={have.includes(near.id)}
                onCollect={collectHere}
              />
            ) : sheetOpen ? (
              <TravelSheet here={here} lang={lang} onPick={travelTo} onClose={closeSheet} />
            ) : (
              talking && <NpcCard npc={talking} lang={lang} onClose={closeNpc} />
            )}
          </>
        }
      />
      {profileShown && me && (
        <ProfileSheet
          me={me}
          lang={lang}
          onSave={save}
          onClose={closeProfile}
          onSignOut={() => {
            setDismissed(false)
            setProfileOpen(false)
            void auth.signOut()
          }}
        />
      )}
      <div className="fade" data-on={fading || undefined} aria-hidden="true" />
    </>
  )
}
