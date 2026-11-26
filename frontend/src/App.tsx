import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createStage, type Stage } from './engine/stage'
import { patangAvailable } from './games/patang'
import { hasWebGL } from './engine/webgl'
import { useAuth } from './auth/useAuth'
import { ProfileSheet } from './profile/ProfileSheet'
import { LookEditor } from './profile/lazyLookEditor'
import { useMe } from './profile/useMe'
import { deleteMyAccount } from './net/api'
import { noteDistrict } from './net/errorBeacon'
import { useRateNotice } from './net/useRateNotice'
import { useBlock } from './connections/useBlock'
import { useConnections } from './connections/useConnections'
import { ChaiInvite } from './friends/ChaiInvite'
import { useFriends } from './friends/useFriends'
import { usePush } from './push/usePush'
import { VisibilityChip } from './ui/VisibilityChip'
import { loadOrCreateLook, lookFromWire, lookKey as figureKey, saveLocalLook } from './player/avatar'
import { useLang } from './i18n/lang'
import { t, type StringKey } from './i18n/strings'
import { cityLine } from './live/cityLine'
import { useLiveCity } from './live/useLiveCity'
import { setAmbienceDuck } from './audio/ambience'
import { setSoundOn, soundOn } from './audio/horn'
import { createControls, type Controls } from './player/controls'
import { disposeAvatarCache } from './player/avatar'
import { createCitySession, type CitySession } from './world/session'
import { useNpcCard } from './world/useNpcCard'
import { usePersonCard } from './world/usePersonCard'
import { useReactions } from './world/useReactions'
import { useEmotes } from './world/useEmotes'
import { EmoteWheel } from './ui/EmoteWheel'
import { useBench, type BenchNotice } from './world/useBench'
import { useAnimals } from './world/useAnimals'
import { hasBandar } from './world/bandar'
import { bandarText, useBandar } from './world/useBandar'
import { useDrive } from './world/useDrive'
import { useTaxi } from './world/useTaxi'
import { taxiAvailable } from './world/taxi'
import { useRooftop } from './world/useRooftop'
import { useQueue } from './world/useQueue'
import { usePosters } from './world/usePosters'
import { TOTAL_STAMPS } from './world/stamps'
import { useStamps } from './world/useStamps'
import { goalFor, istDay } from './world/today'
import { festivalOverride, todayOverride } from './overrides'
import { goalText } from './world/todayText'
import { useToday } from './world/useToday'
import { TodayChip, TodaySheet } from './ui/Today'
import { useCityMap } from './world/useCityMap'
import { processionLine } from './live/procession'
import { DISTRICT_NAMES, DISTRICT_SHORT_NAMES } from './world/districtNames'
import { byBus } from './world/metroRide'
import { rememberDistrict, savedDistrict, useTravel } from './world/useTravel'
import { dropPlaceLink, linkId, readPlaceLink } from './world/placeLink'
import { mapItems } from './world/cityMap'
import type { ChaiInviteView, DistrictId, EmoteKind, FestivalId } from './net/protocol'
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
import { InstallHint } from './pwa/InstallHint'
import { CityMap } from './ui/CityMap'
import { Compass } from './ui/Compass'
import { RoofButton, RoofNotice } from './ui/RoofButton'
import { ReactionToast } from './ui/ReactionToast'

/**
 * The bench notices that are a passing toast (`ghost` is a card; `rate` and `muted` are lines in the bench
 * panel).
 */
const BENCH_TOASTS: Partial<Record<BenchNotice, StringKey>> = {
  full: 'benchFull',
  far: 'benchFar',
  failed: 'benchFailed',
}

/** The look a card is opened with for someone no longer drawn: the card shows their name, never their body. */
const UNSEEN_LOOK = { skin: 2, outfit: 'sandstone', head: 'none' } as const

const FESTIVALS: Record<FestivalId, StringKey> = {
  sankranti: 'festivalSankranti',
  holi: 'festivalHoli',
  gangaur: 'festivalGangaur',
  teej: 'festivalTeej',
  diwali: 'festivalDiwali',
  jlf: 'festivalJlf',
  newyear: 'festivalNewYear',
}

export default function App() {
  const [lang, setLang] = useLang()
  const auth = useAuth()
  const [entered, setEntered] = useState(false)
  /** A link to a place (`?at=`, see placeLink): the city opens there once "Padharo" is pressed. */
  const [link] = useState(() => readPlaceLink(location.search))
  const [place, setPlace] = useState<DistrictDef['name'] | 'loading' | 'failed'>('loading')
  const [here, setHere] = useState<DistrictId>('walled-city')
  /** The district the session stands the player in now (its `place` hook says), for "Bulao" on its cards. */
  const [hereDef, setHereDef] = useState<DistrictDef | null>(null)
  /** Its places by map id, worked out once per district. */
  const places = useMemo(() => hereDef && new Map(mapItems(hereDef, []).map((i) => [i.id, i])), [hereDef])
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
  /**
   * The kite fight, while one runs: where the player stood (and how high: up on a roof, the game looks up
   * from there), and the stage and controls it borrows.
   */
  const [kiteFrom, setKiteFrom] = useState<{ at: Vec2; y: number; stage: Stage; controls: Controls } | null>(
    null,
  )
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
  /** Reactions: a namaste or a wave from the person card, and the toast when one reaches the player. */
  const reactions = useReactions()
  const { hooks: reactionHooks, bind: bindReactions } = reactions
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
  /**
   * Whose card opened straight to "Block them?" (from a reaction toast), and how many times it was asked (each
   * ask is a fresh question, even after a "never mind"); forgotten once the card is not theirs.
   */
  const [blockAsk, setBlockAsk] = useState<{ id: string; n: number } | null>(null)
  if (blockAsk && meetingId !== blockAsk.id) setBlockAsk(null)
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
  /** The "Aaj ka Darshan" sheet, from its chip. */
  const [todayOpen, setTodayOpen] = useState(false)
  const [todayGoal] = useState(todayOverride)
  /** The goal the welcome screen names: the day's when the page opened (the street's chip keeps up after). */
  const [introGoal] = useState(() => todayGoal ?? goalFor(istDay(Date.now())))
  /** A guest's dressing room (a resident's opens from the profile sheet). */
  const [lookOpen, setLookOpen] = useState(false)
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
  const playEmote = useCallback((kind: EmoteKind) => session.current?.emote(kind) ?? false, [])
  /** Whether something the session cannot see has the player (see `emoteBusy` below, where it is decided). */
  const emoteBusyRef = useRef(false)
  useEffect(() => session.current?.repaint(), [snapshot])
  const lookKey = profileLook && figureKey(profileLook)
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
  /** "Aaj ka Darshan": a resident's record is the server's (a ghost's only here); its toast waits for the HUD. */
  const today = useToday(
    shown ? { id: residentId, token: auth.token, ...(me?.today ? { today: me.today } : {}) } : null,
    !photo && !taxi.riding,
    todayGoal,
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
  const friends = useFriends({ user: residentId, token: auth.token, tick: conn.friendTick })
  // each time the inbox comes (back) up, a look at the friend asks too, so one made while away shows on Profile
  const refreshFriends = friends.refresh
  useEffect(() => {
    if (conn.reconnects > 0) void refreshFriends()
  }, [conn.reconnects, refreshFriends])
  const slowed = useRateNotice()
  const { block, blockPoster, toast: blockToast } = useBlock(auth.token, lang)
  const [connOpen, setConnOpen] = useState(false)
  // signing out shuts the sheet, so the next resident does not find it open
  if (!residentId && connOpen) setConnOpen(false)
  if (!residentId && inviteOpen) setInviteOpen(false)
  // a finished profile takes the device's dressing room away: the profile sheet has the resident's
  if (profileLook && lookOpen) setLookOpen(false)
  const connShown = connOpen && !!residentId
  /** Push notifications: a tapped one opens the inbox (once there is a resident), and each visit refreshes it. */
  const push = usePush({
    ready: auth.ready,
    signedIn: auth.signedIn,
    resident: !!residentId,
    token: auth.token,
    lang,
  })
  if (push.inboxAsked && residentId) {
    push.inboxDone()
    setConnOpen(true)
  }
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
  const [override] = useState(() => festivalOverride(FESTIVALS))
  const festival = override ?? snapshot?.festival ?? null
  // the line under the greeting: a procession on the street, or on Sankranti the day's game (up on the roof)
  const processionKey =
    processionLine(festival, here) ?? (festival === 'sankranti' ? 'festivalSankrantiLine' : undefined)
  /** The city map (M, the place chip) and the compass to the place picked on it; not in a ride, kite fight or photo. */
  const map = useCityMap(entered && !ride && !taxi.riding && !kiteFrom && !photo)
  const { bind: bindMap, hide: hideMapPillar, blockedRef: mapBlockedRef } = map
  // in photo mode the pillar keeps out of the view (and out of every capture, see `Stage.capture`)
  useEffect(() => hideMapPillar(!!photo), [photo, hideMapPillar])
  // photo mode and the taxi ride duck the city sounds to half (see setAmbienceDuck); a city that goes undoes it
  const ducked = !!photo || taxi.riding
  useEffect(() => {
    setAmbienceDuck(ducked)
    return () => setAmbienceDuck(false)
  }, [ducked])
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
        reactions: reactionHooks,
        emotes: { busy: () => emoteBusyRef.current },
        place: (def) => {
          setPlace(def ? def.name : 'failed')
          if (def) setHere(def.id)
          if (def) setHereDef(def)
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
    bindReactions(city)
    bindMap({ session: city, stage })

    return () => {
      bindMap(null)
      bindReactions(null)
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
    reactionHooks,
    bindReactions,
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
        // asked to block from elsewhere: a fresh card, with the question already up
        key={blockAsk ? `${blockAsk.id}:block:${blockAsk.n}` : meeting.person.id}
        askBlock={!!blockAsk}
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
          // a block offered on their reaction toast is done with: the toast goes too
          if (done && reactions.notice?.t === 'got' && reactions.notice.id === person.id) reactions.dismiss()
          // `stay`: they also want to report; the card closes when the report form does
          if (done && !stay) closePerson()
          return done
        }}
        reacted={reactions.sent[meeting.person.id]}
        onReact={(person, kind) => reactions.react(person.id, kind)}
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
        onChanged={posters.changed}
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
    todayOpen ||
    lookOpen ||
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

  /**
   * EMOTES: BUSY. The one place that says a game or a ride has the player: add any new one here (a cricket
   * round, say) with `||`. While it is true no emote begins, and one that is playing ends: on this page at
   * once, and for everyone watching as soon as the street's `stop` reaches them (the session sends it when an
   * emote it told the street of ends early). The session reads this through `emoteBusyRef` and adds what it
   * sees itself (a bench seat, the wheel, the taxi). Photo mode is deliberately not here: a pose holds for the
   * picture.
   */
  const emoteBusy = !!kiteFrom || !!ride || fading || roof.fading
  useEffect(() => {
    emoteBusyRef.current = emoteBusy
  }, [emoteBusy])
  /**
   * The chip over the joystick, and G: wherever the session lets an emote begin (not busy, not seated, not at
   * the wheel or in a taxi), and not in photo mode, which has no HUD (a pose already held stays for the photo).
   */
  const canEmote =
    entered && typeof place !== 'string' && !emoteBusy && !drive.driving && !bench.seat && !taxi.riding && !photo
  const emotes = useEmotes(canEmote, playEmote)

  /** "Bulao" (as an icon: the cards' rows are full) for a place in the district the player is in, by its map id. */
  /**
   * "Chalo" on a friend's invite for chai: in this district, the compass points at their bench (as a map pick
   * does); in another, the metro (or bus) takes you there and stands you by it (a place link's spot).
   */
  const chalo = async (c: ChaiInviteView): Promise<boolean> => {
    setConnOpen(false)
    if (!entered) return false
    if (c.district !== here) return travelTo(c.district, here, linkId({ id: c.bench, kind: c.kind }))
    const place = places?.get(c.bench)
    if (place) map.pick(place)
    return !!place
  }

  const invite = (id: string) => {
    const place = places?.get(id)
    return hereDef && place && <PlaceInvite district={hereDef.id} place={place} lang={lang} compact />
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
            today={goalText(introGoal, lang).goal}
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
        placeShort={typeof place === 'string' ? undefined : DISTRICT_SHORT_NAMES[here][lang]}
        snapshot={snapshot}
        line={snapshot && !snapshot.stale ? cityLine(snapshot, lang, now()) : undefined}
        banner={festival ? t(FESTIVALS[festival], lang) : undefined}
        procession={processionKey && t(processionKey, lang)}
        stamps={`${have.length}/${TOTAL_STAMPS}`}
        onStamps={() => setDarshanOpen(true)}
        lang={lang}
        onLang={setLang}
        bandar={hasBandar(here) ? { off: bandar.off, onToggle: bandar.toggle } : undefined}
        sound={{
          on: sound,
          onToggle: () => {
            setSoundOn(!sound)
            setSound(!sound)
          },
        }}
        visibility={visibility}
        onProfile={auth.signedIn && me ? () => setProfileOpen(true) : undefined}
        profileBadge={residentId ? (friends.lists?.incoming.length ?? 0) : 0}
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
        onLook={profileLook ? undefined : () => setLookOpen(true)}
        today={
          <TodayChip goal={today.goal} done={today.done} lang={lang} onOpen={() => setTodayOpen(true)} />
        }
        streak={today.streak}
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
                {today.toast !== null && (
                  <div className="toast today-toast" role="status">
                    {today.toast > 1 ? t('todayToast', lang, { n: today.toast }) : t('todayToastFirst', lang)}
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
                {/* while the card it opened asks "Block them?", the toast keeps out of the way (a small phone
                    has room for one); closed with nothing blocked, the offer is back while its time lasts */}
                {reactions.notice && !(blockAsk && meetingId === blockAsk.id) && (
                  <ReactionToast
                    notice={reactions.notice}
                    lang={lang}
                    onBlock={(id, name) => {
                      // the same "Block them?" as anywhere else (a failure said, "also report" offered), in
                      // their card: as drawn, or (gone off the street) by name, which the card notes
                      const drawn = session.current?.people().find((r) => r.person.id === id)?.person
                      closeNpc()
                      setComposing(null)
                      tapPerson(
                        drawn ?? { id, name, look: UNSEEN_LOOK, status: '', x: 0, z: 0, ry: 0 },
                        false,
                      )
                      setBlockAsk((was) => ({ id, n: (was?.n ?? 0) + 1 }))
                      // the toast is only hidden, not dismissed, until the block is done (see above)
                    }}
                  />
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
            {/* "Home screen pe rakho": once, after a couple of minutes in the city, where the browser can. Mounted
                for the whole visit (a district loading is only busy), so its clock is not restarted by travel; it
                waits, and does not count, while anything is over the street */}
            <InstallHint
              lang={lang}
              busy={
                typeof place === 'string' || bandarBlocked || !!photo || fading || roof.fading || taxi.dark
              }
            />
          </>
        }
        bottom={
          <>
            {!kiteFrom && (
              // the stick's column: the emote chip hangs over its corner, out of the row's layout
              <div className="stick-column">
                <Joystick
                  lang={lang}
                  jogs={!drive.driving}
                  onChange={(v) => controlsRef.current?.setJoystick(v)}
                />
                {canEmote && (
                  <EmoteWheel open={emotes.open} lang={lang} onToggle={emotes.toggle} onPick={emotes.pick} />
                )}
              </div>
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
                    // on the street, and on Sankranti up on the rooftop viewpoint too (never mid-fade)
                    !roof.fading &&
                    !near &&
                    !sheetOpen && (
                      <button
                        type="button"
                        className="metro-button patang-button"
                        onClick={() => {
                          const player = session.current?.player()
                          const at = player?.position()
                          const stage = stageRef.current
                          const controls = controlsRef.current
                          if (at && stage && controls)
                            setKiteFrom({ at, y: player!.elevation(), stage, controls })
                        }}
                      >
                        {t('patangStart', lang)}
                      </button>
                    )}
                  {nearStation && !near && !sheetOpen && !bench.seat && (
                    // Amer has a bus stand, not a metro: the same sheet, by bus
                    <button
                      type="button"
                      className={byBus(here) ? 'metro-button bus-button' : 'metro-button'}
                      onClick={openSheet}
                    >
                      {t(byBus(here) ? 'bus' : 'metro', lang)}
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
                      chai={
                        residentId ? (
                          <ChaiInvite
                            bench={bench.seat.bench}
                            friends={friends}
                            lang={lang}
                            token={auth.token}
                          />
                        ) : undefined
                      }
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
          friends={residentId ? friends : undefined}
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
      {darshanOpen && (
        <DarshanList
          ids={have}
          lang={lang}
          // only a resident's own name, and the card prints only its first word when they tick "naam dikhao"
          name={shown ? shown.name : undefined}
          streak={today.streak}
          onClose={() => setDarshanOpen(false)}
        />
      )}
      {todayOpen && (
        <TodaySheet
          goal={today.goal}
          done={today.done}
          streak={today.streak}
          best={today.best}
          local={!residentId}
          lang={lang}
          onClose={() => setTodayOpen(false)}
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
          friends={friends}
          onChalo={chalo}
        />
      )}
      {photo && (
        <PhotoMode
          stage={photo}
          // the postcard's place: the landmark the player stands by (inside its ring), else the district
          place={near ? near.name[lang] : DISTRICT_NAMES[here][lang]}
          lang={lang}
          onExit={() => setPhoto(null)}
        />
      )}
      {lookOpen && (
        <LookEditor
          look={loadOrCreateLook()}
          lang={lang}
          mode="local"
          onSave={(next) => {
            // a guest's look lives on this device only, and the street shows it at once
            saveLocalLook(next)
            session.current?.setLook(next)
            setLookOpen(false)
            return true
          }}
          onCancel={() => setLookOpen(false)}
        />
      )}
      <div className="fade" data-on={fading || roof.fading || taxi.dark || undefined} aria-hidden="true" />
      <RoofNotice notice={roof.notice} lang={lang} />
      {kiteFrom && (
        <Patang
          lang={lang}
          stage={kiteFrom.stage}
          controls={kiteFrom.controls}
          at={kiteFrom.at}
          y={kiteFrom.y}
          onExit={() => setKiteFrom(null)}
        />
      )}
      {ride && <MetroRide {...ride} lang={lang} onSkip={skipRide} onBack={cancelRide} />}
      {taxi.riding && taxi.place && <TaxiRide place={taxi.place[lang]} lang={lang} onSkip={taxi.skip} />}
      {closed}
    </>
  )
}
