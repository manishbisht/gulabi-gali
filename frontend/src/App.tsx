import { useEffect, useRef, useState } from 'react'
import { createStage, type Stage } from './engine/stage'
import { hasWebGL } from './engine/webgl'
import { useAuth } from './auth/useAuth'
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
  const bubbleHost = useRef<HTMLDivElement>(null)
  const langRef = useRef(lang)
  useEffect(() => {
    langRef.current = lang
  }, [lang])
  const { snapshot, current, now, patch, freeze } = useLiveCity()
  /** The city session, while the stage is up; it re-paints the sky when a new snapshot lands. */
  const session = useRef<CitySession | null>(null)
  useEffect(() => session.current?.repaint(), [snapshot])
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
        festival: () => override ?? current().festival,
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
        onSignIn={auth.mode !== 'none' && auth.ready && !auth.signedIn ? auth.openSignIn : undefined}
        top={
          <>
            {toast && (
              <div className="toast" role="status">
                {toast}
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
      <div className="fade" data-on={fading || undefined} aria-hidden="true" />
    </>
  )
}
