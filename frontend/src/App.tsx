import { useEffect, useRef, useState } from 'react'
import { createStage, type Stage } from './engine/stage'
import { patangAvailable } from './games/patang'
import { hasWebGL } from './engine/webgl'
import { useAuth } from './auth/useAuth'
import { ProfileSheet } from './profile/ProfileSheet'
import { useMe } from './profile/useMe'
import { deleteMyAccount } from './net/api'
import { noteDistrict } from './net/errorBeacon'
import { useRateNotice } from './net/useRateNotice'
import { useBlock } from './connections/useBlock'
import { useConnections } from './connections/useConnections'
import { VisibilityChip } from './ui/VisibilityChip'
import { loadOrCreateLook, lookFromWire } from './player/avatar'
import { useLang } from './i18n/lang'
import { t, type StringKey } from './i18n/strings'
import { cityLine } from './live/cityLine'
import { useLiveCity } from './live/useLiveCity'
import { setSoundOn, soundOn } from './audio/horn'
import { createControls, type Controls } from './player/controls'
import { disposeAvatarCache } from './player/avatar'
import { createCitySession, type CitySession } from './world/session'
import { useNpcCard } from './world/useNpcCard'
import { usePersonCard } from './world/usePersonCard'
import { useBench, type BenchNotice } from './world/useBench'
import { useAnimals } from './world/useAnimals'
import { bandarText, useBandar } from './world/useBandar'
import { useDrive } from './world/useDrive'
import { useTaxi } from './world/useTaxi'
import { taxiAvailable } from './world/taxi'
import { useRooftop } from './world/useRooftop'
import { useQueue } from './world/useQueue'
import { usePosters } from './world/usePosters'
import { TOTAL_STAMPS } from './world/stamps'
import { useStamps } from './world/useStamps'
import { useCityMap } from './world/useCityMap'
import { processionLine } from './live/procession'
import { DISTRICT_NAMES } from './world/districtNames'
import { rememberDistrict, savedDistrict, useTravel } from './world/useTravel'
import { dropPlaceLink, readPlaceLink } from './world/placeLink'
import { mapItems } from './world/cityMap'
import type { DistrictId, FestivalId } from './net/protocol'
import type { DistrictDef, Vec2 } from './world/types'
import { Hud } from './ui/Hud'
import { PhotoMode } from './ui/PhotoMode'
import { Intro } from './ui/Intro'
import { LandmarkCard } from './ui/LandmarkCard'
import { PlaceInvite } from './ui/PlaceInvite'
import { DriveButtons } from './ui/DriveButtons'
import { Joystick } from './ui/Joystick'
import { Patang } from './ui/Patang'
import { NpcCard } from './ui/NpcCard'
import { PersonCard, type Viewer } from './ui/PersonCard'
import { PosterCard } from './ui/PosterCard'
import { PosterComposer } from './ui/PosterComposer'
import { RequestComposer, type Sent } from './ui/RequestComposer'
import { NoWebGL } from './ui/NoWebGL'
import { MetroRide } from './ui/MetroRide'
import { TaxiRide } from './ui/TaxiRide'
import { TaxiSheet } from './ui/TaxiSheet'
import { TravelSheet } from './ui/TravelSheet'
import { BenchChat, BenchGhost } from './ui/BenchChat'
import { Connections } from './ui/Connections'
import { InviteSheet } from './ui/InviteSheet'
import { PrivacySheet } from './ui/PrivacySheet'
import { DarshanList } from './ui/DarshanList'
import { AccountClosed } from './ui/AccountClosed'
import { FullScreen } from './ui/FullScreen'
import { FirstHint } from './ui/FirstHint'
import { CityMap } from './ui/CityMap'
import { Compass } from './ui/Compass'
import { RoofButton, RoofNotice } from './ui/RoofButton'

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
  /** A link to a place (`?at=`, see placeLink): the city opens there once "Padharo" is pressed. */
  const [link] = useState(() => readPlaceLink(location.search))
  const [place, setPlace] = useState<DistrictDef['name'] | 'loading' | 'failed'>('loading')
  const [here, setHere] = useState<DistrictId>('walled-city')
  // an error report says which district it happened in (none before the city opens)
  useEffect(() => noteDistrict(entered ? here : null), [entered, here])
  const [webgl] = useState(hasWebGL)
  /** The renderer could not start (WebGL2 missing or the context was refused). */
  const [stageFailed, setStageFailed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controlsRef = useRef<Controls | null>(null)
  const stageRef = useRef<Stage | null>(null)
  /** Photo mode: the stage it takes pictures with, while it is on. */
  const [photo, setPhoto] = useState<Stage | null>(null)
  const wasPhoto = useRef(false)
  useEffect(() => {
    // back from photo mode, focus returns to the camera chip that opened it
    if (wasPhoto.current && !photo) document.querySelector<HTMLElement>('.photo-button')?.focus()
    wasPhoto.current = !!photo
  }, [photo])
  /** The kite fight, while one runs: where the player stood, and the stage and controls it borrows. */
  const [kiteFrom, setKiteFrom] = useState<{ at: Vec2; stage: Stage; controls: Controls } | null>(null)
  const { npc: talking, tap: tapNpc, close: closeNpc, isOpen: npcOpen, step: stepNpc } = useNpcCard()
  const {
    open: meeting,
    tap: tapPerson,
    close: closePerson,
    isOpen: personOpen,
    step: stepPerson,
  } = usePersonCard()
  const bench = useBench()
  /** Driving a parked auto: one in reach, at the wheel, and "no room to get out". */
  const drive = useDrive()
  const { hooks: driveHooks, bind: bindDrive } = drive
  /** The auto-taxi: an auto at its stand in reach, the "Le chalo" list, and the ride. */
  const taxi = useTaxi()
  const { hooks: taxiHooks, bind: bindTaxi } = taxi
  /** The rooftop viewpoint: its stair in reach, being up there, and the fade between. */
  const roof = useRooftop()
  const { hooks: roofHooks, bind: bindRoof } = roof
  /** The street animals: the one in reach, the one following, and their passing lines. */
  const animals = useAnimals()
  const { hooks: animalHooks, bind: bindAnimals } = animals
  /** The Galta bandar: its passing line and its switch. */
  const bandar = useBandar()
  const { hooks: bandarHooks } = bandar
  const [sound, setSound] = useState(soundOn)
  /** The line for room when the city is full (`MAX_LIVE`): this resident waits in it as a ghost. */
  const queue = useQueue()
  const { queued } = queue
  const { hooks: benchHooks, bind: bindBench } = bench
  /** The poster walls: the one in reach, the composer, a tapped poster's card. */
  const posters = usePosters()
  const { hooks: posterHooks, bind: bindPosters } = posters
  /** The person whose request note is being written, and who has been asked this session. */
  const [composing, setComposing] = useState<string | null>(null)
  const [asked, setAsked] = useState<Record<string, Sent>>({})
  // however the card closes (its button, E, a landmark), the note does not wait for the next time
  const meetingId = meeting?.person.id ?? null
  if (!meetingId && composing) setComposing(null)
  const {
    fading,
    failed: travelFailed,
    ride,
    skipRide,
    cancelRide,
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
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [darshanOpen, setDarshanOpen] = useState(false)
  /** The look the profile gives the player; read by the session whenever a district opens. */
  const profileLook = (me?.complete && me.profile && lookFromWire(me.profile.look)) || null
  const profileLookRef = useRef(profileLook)
  /** The sheet opens by itself for an incomplete profile until the visitor says "not now". */
  const [profileOpen, setProfileOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const profileShown = !!me && (profileOpen || (!me.complete && !dismissed))
  /** Closes the profile sheet and signs out (also what a deleted account does). */
  const leave = () => {
    setDismissed(false)
    setProfileOpen(false)
    void auth.signOut()
  }
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
  /** A resident's stamps are kept on the server too (a ghost's only here). */
  const { near, have, toast, collectHere, track } = useStamps(
    lang,
    shown ? { id: residentId, token: auth.token, stamps: shown.stamps ?? [] } : null,
  )
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
  const { block, blockPoster, toast: blockToast } = useBlock(auth.token, lang)
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
  const processionKey = processionLine(festival, here)
  /** The city map (M, the place chip) and the compass to the place picked on it; not in a ride, kite fight or photo. */
  const map = useCityMap(entered && !ride && !taxi.riding && !kiteFrom && !photo)
  const { bind: bindMap, hide: hideMapPillar, blockedRef: mapBlockedRef } = map
  // in photo mode the pillar keeps out of the view (and out of every capture, see `Stage.capture`)
  useEffect(() => hideMapPillar(!!photo), [photo, hideMapPillar])
  // the kite fight is Sankranti's: if the festival goes (the snapshot changes mid-round), so does it
  if (kiteFrom && festival !== 'sankranti') setKiteFrom(null)

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
    stageRef.current = stage
    const city = createCitySession({
      stage,
      controls,
      canvas,
      bubbleHost: bubbles,
      start: link?.district ?? savedDistrict(),
      startAt: link?.place,
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
        posters: posterHooks,
        drive: driveHooks,
        taxi: taxiHooks,
        animals: animalHooks,
        bandar: bandarHooks,
        roof: roofHooks,
        place: (def) => {
          setPlace(def ? def.name : 'failed')
          if (def) setHere(def.id)
        },
      },
    })
    session.current = city
    bindTravel(city.travelTo)
    bindBench(city)
    bindPosters(city)
    bindDrive(city)
    bindTaxi(city)
    bindAnimals(city)
    bindRoof(city)
    bindMap({ session: city, stage })

    return () => {
      bindMap(null)
      bindRoof(null)
      bindAnimals(null)
      bindTaxi(null)
      bindDrive(null)
      bindPosters(null)
      bindBench(null)
      bindTravel(null)
      session.current = null
      city.dispose()
      disposeAvatarCache() // after the last player and NPC, before the renderer that drew them goes
      controls.dispose()
      controlsRef.current = null
      stageRef.current = null
      setKiteFrom(null) // a kite fight borrows this stage and these controls, and ends with them
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
    posterHooks,
    bindPosters,
    driveHooks,
    bindDrive,
    taxiHooks,
    bindTaxi,
    animalHooks,
    bindAnimals,
    bindMap,
    roofHooks,
    bindRoof,
    bandarHooks,
    current,
    now,
    patch,
    freeze,
    override,
    queued,
    link,
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
        onBlock={async (person, stay) => {
          const done = await block(person.id, person.name)
          // `stay`: they also want to report; the card closes when the report form does
          if (done && !stay) closePerson()
          return done
        }}
        onClose={closePerson}
      />
    )) ||
    (posters.composing && posters.near && (
      <PosterComposer
        district={here}
        wall={posters.near.wall.index}
        viewer={viewer}
        empty={posters.near.empty}
        lang={lang}
        token={auth.token}
        onPinned={posters.pinned}
        onVisible={onVisible}
        onGetVerified={() => setInviteOpen(true)}
        onClose={posters.closeComposer}
      />
    )) ||
    (posters.open && (
      <PosterCard
        poster={posters.open.poster}
        gone={posters.open.gone}
        viewer={viewer}
        lang={lang}
        token={auth.token}
        onBlock={async (p, stay) => {
          const done = await blockPoster(p.id, p.name)
          if (done === true) posters.blocked()
          if (done === true && !stay) posters.close()
          return done
        }}
        onTakenDown={posters.takenDown}
        onClose={posters.close}
      />
    ))
  /** A card, sheet or dialog is up: M does not open the map over it. */
  const sheetUp =
    !!card ||
    sheetOpen ||
    taxi.sheetOpen ||
    profileShown ||
    connShown ||
    inviteOpen ||
    privacyOpen ||
    darshanOpen ||
    !!queue.card
  useEffect(() => {
    mapBlockedRef.current = sheetUp
  }, [sheetUp, mapBlockedRef])
  // the monkey keeps off the street while anything is over it
  const bandarBlocked =
    sheetUp || !!near || !!ride || taxi.riding || !!kiteFrom || !!bench.seat || map.open || roof.up
  const { blockedRef: bandarBlockedRef } = bandar
  useEffect(() => {
    bandarBlockedRef.current = bandarBlocked
  }, [bandarBlocked, bandarBlockedRef])
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

  /** "Bulao" for a place in the district the player is in (its map's id), once it has loaded. */
  const invite = (id: string) => {
    const place = map.def && mapItems(map.def, []).find((i) => i.id === id)
    return place && <PlaceInvite district={map.def!.id} place={place} lang={lang} />
  }

  /** A banned account: a plain screen over everything (the city behind it stays a ghost's). */
  const closed = banned && <AccountClosed lang={lang} onSignOut={() => void auth.signOut()} />
  if (!webgl || stageFailed) return closed || <NoWebGL lang={lang} />
  if (!entered)
    return (
      closed || (
        <>
          <Intro
            lang={lang}
            onLang={setLang}
            onEnter={() => {
              // followed: this district from now on, and the link out of the address bar
              if (link) {
                rememberDistrict(link.district)
                dropPlaceLink()
              }
              setEntered(true)
            }}
            onPrivacy={() => setPrivacyOpen(true)}
          />
          {privacyOpen && <PrivacySheet lang={lang} onClose={() => setPrivacyOpen(false)} />}
        </>
      )
    )
  return (
    <>
      <canvas ref={canvasRef} className="stage" />
      <div ref={bubbleHost} className="npc-bubbles" aria-hidden="true" hidden={!!photo} />
      <Hud
        place={
          typeof place === 'string' ? t(place === 'failed' ? 'loadFailed' : 'loading', lang) : place[lang]
        }
        snapshot={snapshot}
        line={snapshot && !snapshot.stale ? cityLine(snapshot, lang) : undefined}
        banner={festival ? t(FESTIVALS[festival], lang) : undefined}
        procession={processionKey && t(processionKey, lang)}
        stamps={`${have.length}/${TOTAL_STAMPS}`}
        onStamps={() => setDarshanOpen(true)}
        lang={lang}
        onLang={setLang}
        bandar={here === 'walled-city' ? { off: bandar.off, onToggle: bandar.toggle } : undefined}
        sound={{
          on: sound,
          onToggle: () => {
            setSoundOn(!sound)
            setSound(!sound)
          },
        }}
        visibility={visibility}
        onProfile={auth.signedIn && me ? () => setProfileOpen(true) : undefined}
        onInvite={residentId ? () => setInviteOpen(true) : undefined}
        onConnections={residentId ? () => setConnOpen((was) => !was) : undefined}
        connectionsBadge={conn.badge}
        onMap={map.def ? map.toggle : undefined}
        // the taxi ride shows the street clear, as photo mode does; the HUD is back on arrival
        photo={!!photo || taxi.riding}
        onPhoto={
          kiteFrom || drive.driving
            ? undefined
            : () => {
                controlsRef.current?.setJoystick({ x: 0, z: 0 }) // the joystick goes with the HUD
                setPhoto(stageRef.current)
              }
        }
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
                {drive.stuck && (
                  <div className="toast" role="status">
                    {t('driveStuck', lang)}
                  </div>
                )}
                {drive.rescued && (
                  <div className="toast" role="status">
                    {t('driveRescued', lang)}
                  </div>
                )}
                {taxi.refused && (
                  <div className="toast" role="status">
                    {t('taxiRefused', lang)}
                  </div>
                )}
                {animals.notice && (
                  <div className="toast" role="status">
                    {t(animals.notice.key, lang, animals.notice.vars)}
                  </div>
                )}
                {bandar.notice && (
                  <div className="toast" role="status">
                    {bandarText(bandar.notice, lang)}
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
            {map.target && (
              <Compass name={map.target.name[lang]} watch={map.watch} lang={lang} onClear={map.clear} />
            )}
            {/* a first visit's three steps, once the street is there to try them on */}
            {typeof place !== 'string' && <FirstHint lang={lang} />}
          </>
        }
        bottom={
          <>
            {!kiteFrom && (
              <Joystick
                lang={lang}
                jogs={!drive.driving}
                onChange={(v) => controlsRef.current?.setJoystick(v)}
              />
            )}
            {drive.driving ? (
              // at the wheel the stick drives; nothing else opens until the player gets out
              <DriveButtons lang={lang} onHorn={drive.honk} onExit={drive.exit} />
            ) : (
              <>
                {/* the street's actions: beside the joystick, they stack upward when a small phone has no room
                    (the "Le chalo" list has the row to itself) */}
                <div className="hud-actions" hidden={taxi.sheetOpen}>
                  {drive.near && !near && !sheetOpen && !card && (bench.seat || !bench.near) && (
                    <button type="button" className="metro-button drive-button" onClick={drive.mount}>
                      {t('driveMount', lang)}
                    </button>
                  )}
                  {taxiAvailable({
                    near: taxi.near,
                    seated: !!bench.seat,
                    driving: drive.driving,
                    card: !!card || !!near || sheetOpen || taxi.sheetOpen,
                    kite: !!kiteFrom,
                    metro: !!ride || fading,
                    roof: roof.up || roof.fading,
                  }) && (
                    <button type="button" className="metro-button taxi-button" onClick={taxi.open}>
                      {t('taxiOpen', lang)}
                    </button>
                  )}
                  {!near && !sheetOpen && !card && !bench.seat && (
                    <RoofButton
                      near={roof.near}
                      up={roof.up}
                      fading={roof.fading}
                      lang={lang}
                      onClimb={roof.climb}
                    />
                  )}
                  {patangAvailable({
                    festival,
                    driving: drive.driving,
                    seated: !!bench.seat,
                    card: !!card,
                  }) &&
                    !roof.up &&
                    !near &&
                    !sheetOpen && (
                      <button
                        type="button"
                        className="metro-button patang-button"
                        onClick={() => {
                          const at = session.current?.player()?.position()
                          const stage = stageRef.current
                          const controls = controlsRef.current
                          if (at && stage && controls) setKiteFrom({ at, stage, controls })
                        }}
                      >
                        {t('patangStart', lang)}
                      </button>
                    )}
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
                  {posters.near && !bench.near && !bench.seat && !near && !sheetOpen && !card && (
                    <button type="button" className="metro-button poster-button" onClick={posters.compose}>
                      {t('posterPin', lang)}
                    </button>
                  )}
                  {animals.near &&
                    !drive.near &&
                    !nearStation &&
                    !bench.near &&
                    !bench.seat &&
                    !posters.near &&
                    !near &&
                    !sheetOpen &&
                    !card && (
                      <button type="button" className="metro-button animal-button" onClick={animals.call}>
                        {t(animals.near.kind === 'cow' ? 'animalGreetCow' : 'animalCall', lang)}
                      </button>
                    )}
                  {animals.following && !bench.seat && !near && !sheetOpen && !card && (
                    <button type="button" className="metro-button animal-button" onClick={animals.home}>
                      {t('animalHome', lang)}
                    </button>
                  )}
                </div>
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
                      invite={invite(bench.seat.bench.id)}
                    />
                  )
                ) : near ? (
                  <LandmarkCard
                    landmark={near}
                    lang={lang}
                    stamped={have.includes(near.id)}
                    onCollect={collectHere}
                    invite={invite(near.id)}
                  />
                ) : sheetOpen ? (
                  <TravelSheet
                    here={here}
                    lang={lang}
                    onPick={(id) => void travelTo(id, here)}
                    onClose={closeSheet}
                  />
                ) : taxi.sheetOpen ? (
                  <TaxiSheet
                    stops={taxi.stops}
                    lang={lang}
                    onPick={(stop) => {
                      controlsRef.current?.setJoystick({ x: 0, z: 0 }) // the joystick goes with the HUD
                      taxi.go(stop)
                    }}
                    onClose={taxi.close}
                  />
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
            )}
          </>
        }
      />
      {profileShown && me && (
        <ProfileSheet
          me={me}
          lang={lang}
          stamps={have}
          token={auth.token}
          onSave={save}
          onClose={closeProfile}
          onSignOut={leave}
          onPrivacy={() => setPrivacyOpen(true)}
          onDelete={async () => {
            const tok = await auth.token().catch(() => null)
            if (!tok || !(await deleteMyAccount(tok))) return false
            leave()
            return true
          }}
        />
      )}
      {privacyOpen && <PrivacySheet lang={lang} onClose={() => setPrivacyOpen(false)} />}
      {map.open && map.def && (
        <CityMap
          def={map.def}
          stamped={have}
          read={map.read}
          target={map.target?.id}
          lang={lang}
          onPick={map.pick}
          onClose={map.close}
        />
      )}
      {darshanOpen && <DarshanList ids={have} lang={lang} onClose={() => setDarshanOpen(false)} />}
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
      {photo && <PhotoMode stage={photo} lang={lang} onExit={() => setPhoto(null)} />}
      <div className="fade" data-on={fading || roof.fading || taxi.dark || undefined} aria-hidden="true" />
      <RoofNotice notice={roof.notice} lang={lang} />
      {kiteFrom && (
        <Patang
          lang={lang}
          stage={kiteFrom.stage}
          controls={kiteFrom.controls}
          at={kiteFrom.at}
          onExit={() => setKiteFrom(null)}
        />
      )}
      {ride && <MetroRide {...ride} lang={lang} onSkip={skipRide} onBack={cancelRide} />}
      {taxi.riding && taxi.place && <TaxiRide place={taxi.place[lang]} lang={lang} onSkip={taxi.skip} />}
      {closed}
    </>
  )
}
