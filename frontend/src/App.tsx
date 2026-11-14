import { useEffect, useRef, useState } from 'react'
import { createStage, type Stage } from './engine/stage'
import { hasWebGL } from './engine/webgl'
import { useAuth } from './auth/useAuth'
import { ProfileSheet } from './profile/ProfileSheet'
import { useMe } from './profile/useMe'
import { useRateNotice } from './net/useRateNotice'
import { useBlock } from './connections/useBlock'
import { useConnections } from './connections/useConnections'
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
import { usePersonCard } from './world/usePersonCard'
import { useBench, type BenchNotice } from './world/useBench'
import { useQueue } from './world/useQueue'
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
import { PersonCard, type Viewer } from './ui/PersonCard'
import { RequestComposer, type Sent } from './ui/RequestComposer'
import { NoWebGL } from './ui/NoWebGL'
import { TravelSheet } from './ui/TravelSheet'
import { BenchChat, BenchGhost } from './ui/BenchChat'
import { Connections } from './ui/Connections'
import { InviteSheet } from './ui/InviteSheet'
import { AccountClosed } from './ui/AccountClosed'
import { FullScreen } from './ui/FullScreen'

/**
 * The bench notices that are a passing toast (`ghost` is a card; `rate` and `muted` are lines in the bench
 * panel).
 */
const BENCH_TOASTS: Partial<Record<BenchNotice, StringKey>> = {
  full: 'benchFull',
  far: 'benchFar',
  failed: 'benchFailed',
}

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
    open: meeting,
    tap: tapPerson,
    close: closePerson,
    isOpen: personOpen,
    step: stepPerson,
  } = usePersonCard()
  const bench = useBench()
  /** The line for room when the city is full (`MAX_LIVE`): this resident waits in it as a ghost. */
  const queue = useQueue()
  const { queued } = queue
  const { hooks: benchHooks, bind: bindBench } = bench
  /** The person whose request note is being written, and who has been asked this session. */
  const [composing, setComposing] = useState<string | null>(null)
  const [asked, setAsked] = useState<Record<string, Sent>>({})
  // however the card closes (its button, E, a landmark), the note does not wait for the next time
  const meetingId = meeting?.person.id ?? null
  if (!meetingId && composing) setComposing(null)
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
  const { me, banned, save, refresh } = useMe()
  /** Read by the live socket when it is closed for a ban: the stage is not rebuilt when `refresh` changes. */
  const refreshMe = useRef(refresh)
  useEffect(() => {
    refreshMe.current = refresh
  }, [refresh])
  const [inviteOpen, setInviteOpen] = useState(false)
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
   * connect. The district learns a resident's face (name, look, status) only when a socket opens, so when who
   * they are or that face changes (a sign-in, a sign-out, a saved profile) the session reconnects, and
   * everyone sees the change without a reload.
   */
  const residentId = auth.signedIn && me?.complete ? me.id : null
  const shown = residentId && me?.profile
  const liveKey = shown ? JSON.stringify([residentId, shown.name, lookKey, shown.status]) : null
  const liveToken = useRef<() => Promise<string | null>>(async () => null)
  const liveAs = useRef<string | null>(null)
  const [replaced, setReplaced] = useState(false)
  useEffect(() => {
    liveToken.current = liveKey ? auth.token : async () => null
    if (liveAs.current === liveKey) return
    liveAs.current = liveKey
    session.current?.reconnectLive()
  }, [liveKey, auth.token])
  const conn = useConnections({ user: residentId, token: auth.token, onBanned: refresh })
  const slowed = useRateNotice()
  const { block, toast: blockToast } = useBlock(auth.token, lang)
  const [connOpen, setConnOpen] = useState(false)
  // signing out shuts the sheet, so the next resident does not find it open
  if (!residentId && connOpen) setConnOpen(false)
  if (!residentId && inviteOpen) setInviteOpen(false)
  const connShown = connOpen && !!residentId
  // C opens and closes Connections, unless a text field has the keys
  useEffect(() => {
    if (!residentId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyC' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable]')) return
      setConnOpen((was) => !was)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [residentId])
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
        personCard: { step: stepPerson, tap: tapPerson, close: closePerson, isOpen: personOpen },
        live: { current, now, patch, freeze },
        look: () => profileLookRef.current,
        festival: () => override ?? current().festival,
        presence: {
          token: () => liveToken.current(),
          replaced: setReplaced,
          banned: () => void refreshMe.current(),
          queued,
        },
        bench: benchHooks,
        place: (def) => {
          setPlace(def ? def.name : 'failed')
          if (def) setHere(def.id)
        },
      },
    })
    session.current = city
    bindTravel(city.travelTo)
    bindBench(city)

    return () => {
      bindBench(null)
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
    tapPerson,
    closePerson,
    personOpen,
    stepPerson,
    trackStation,
    bindTravel,
    benchHooks,
    bindBench,
    current,
    now,
    patch,
    freeze,
    override,
    queued,
  ])

  const viewer: Viewer = !auth.signedIn
    ? 'ghost'
    : me?.complete
      ? me.verified
        ? 'verified'
        : 'resident'
      : 'incomplete'
  const openProfile = () => void (me && setProfileOpen(true))
  const onVisible = auth.signedIn ? openProfile : auth.openSignIn
  const benchToast = bench.notice && BENCH_TOASTS[bench.notice]
  /** A character's or a person's card, when one is up. */
  const card =
    (talking && <NpcCard npc={talking} lang={lang} onClose={closeNpc} />) ||
    (meeting && composing === meeting.person.id && (
      <RequestComposer
        person={meeting.person}
        lang={lang}
        token={auth.token}
        onDone={(result) => {
          setAsked((was) => ({ ...was, [meeting.person.id]: result }))
          setComposing(null)
        }}
        onClose={() => setComposing(null)}
      />
    )) ||
    (meeting && (
      <PersonCard
        person={meeting.person}
        gone={meeting.gone}
        viewer={viewer}
        sent={asked[meeting.person.id]}
        lang={lang}
        token={auth.token}
        onVisible={onVisible}
        onGetVerified={() => setInviteOpen(true)}
        onRequest={(person) => setComposing(person.id)}
        onBlock={async (person) => {
          const done = await block(person.id, person.name)
          if (done) closePerson()
          return done
        }}
        onClose={closePerson}
      />
    ))
  const visibility =
    auth.mode === 'none' || !auth.ready ? undefined : !auth.signedIn ? (
      <VisibilityChip
        state="ghost"
        lang={lang}
        cta={{ label: t('signInButton', lang), onClick: auth.openSignIn }}
      />
    ) : me?.complete ? (
      queue.position === null ? (
        <VisibilityChip state="resident" lang={lang} />
      ) : (
        // waiting for room: unseen until they get in, and the chip brings the card back
        <VisibilityChip
          state="ghost"
          lang={lang}
          cta={{ label: t('fullChip', lang, { n: queue.position }), onClick: queue.reopen }}
        />
      )
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

  /** A banned account: a plain screen over everything (the city behind it stays a ghost's). */
  const closed = banned && <AccountClosed lang={lang} onSignOut={() => void auth.signOut()} />
  if (!webgl || stageFailed) return closed || <NoWebGL lang={lang} />
  if (!entered) return closed || <Intro lang={lang} onLang={setLang} onEnter={() => setEntered(true)} />
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
        onInvite={residentId ? () => setInviteOpen(true) : undefined}
        onConnections={residentId ? () => setConnOpen((was) => !was) : undefined}
        connectionsBadge={conn.badge}
        top={
          <>
            {slowed && (
              <div className="toast" role="status">
                {t('slowDown', lang)}
              </div>
            )}
            {!slowed && blockToast && (
              <div className="toast" role="status">
                {blockToast}
              </div>
            )}
            {!slowed && !blockToast && (
              <>
                {toast && (
                  <div className="toast" role="status">
                    {toast}
                  </div>
                )}
                {queue.admitted && (
                  <div className="toast" role="status">
                    {t('fullAdmitted', lang)}
                  </div>
                )}
                {replaced && (
                  <div className="toast" role="status">
                    {t('liveReplaced', lang)}
                  </div>
                )}
                {benchToast && (
                  <div className="toast" role="status">
                    {t(benchToast, lang)}
                  </div>
                )}
                {travelFailed && (
                  <div className="toast" role="status">
                    {t('metroFailed', lang, { place: DISTRICT_NAMES[travelFailed][lang] })}
                  </div>
                )}
              </>
            )}
          </>
        }
        bottom={
          <>
            <Joystick lang={lang} onChange={(v) => controlsRef.current?.setJoystick(v)} />
            {nearStation && !near && !sheetOpen && !bench.seat && (
              <button type="button" className="metro-button" onClick={openSheet}>
                {t('metro', lang)}
              </button>
            )}
            {bench.near && !bench.seat && !near && !sheetOpen && (
              <button type="button" className="metro-button bench-button" onClick={bench.sit}>
                {t('benchSit', lang)}
              </button>
            )}
            {bench.seat ? (
              // seated, the bench panel holds the bottom; a tapped character or person shows over it
              card || (
                <BenchChat
                  seat={bench.seat}
                  lines={bench.lines}
                  me={me?.id ?? null}
                  notice={bench.notice}
                  lang={lang}
                  token={auth.token}
                  onSay={bench.say}
                  onStand={bench.stand}
                  onBlock={async (id, name) => {
                    const done = await block(id, name)
                    if (done) bench.forget(id)
                    return done
                  }}
                />
              )
            ) : near ? (
              <LandmarkCard
                landmark={near}
                lang={lang}
                stamped={have.includes(near.id)}
                onCollect={collectHere}
              />
            ) : sheetOpen ? (
              <TravelSheet here={here} lang={lang} onPick={travelTo} onClose={closeSheet} />
            ) : (
              card ||
              (bench.notice === 'ghost' && (
                <BenchGhost
                  lang={lang}
                  cta={t(viewer === 'incomplete' ? 'visibilityFinish' : 'signInButton', lang)}
                  onVisible={onVisible}
                  onClose={bench.dismiss}
                />
              )) ||
              (queue.card && queue.position !== null && (
                <FullScreen position={queue.position} lang={lang} onClose={queue.dismiss} />
              ))
            )}
          </>
        }
      />
      {profileShown && me && (
        <ProfileSheet
          me={me}
          lang={lang}
          token={auth.token}
          onSave={save}
          onClose={closeProfile}
          onSignOut={() => {
            setDismissed(false)
            setProfileOpen(false)
            void auth.signOut()
          }}
        />
      )}
      {inviteOpen && me && residentId && (
        <InviteSheet
          me={me}
          lang={lang}
          token={auth.token}
          onVerified={() => void refresh()}
          onClose={() => setInviteOpen(false)}
        />
      )}
      {connShown && (
        <Connections
          conn={conn}
          lang={lang}
          token={auth.token}
          onBlock={block}
          onClose={() => setConnOpen(false)}
        />
      )}
      <div className="fade" data-on={fading || undefined} aria-hidden="true" />
      {closed}
    </>
  )
}
