import * as THREE from 'three'
import type { QualityTier, Stage } from '../engine/stage'
import type { Lang } from '../i18n/strings'
import { createFestivalFx, festivalSky } from '../live/festivalFx'
import { applySky, skyParams, type SkyParams } from '../live/sky'
import type { LiveCity } from '../live/useLiveCity'
import { createWeatherFx } from '../live/weatherFx'
import { getPosters } from '../net/api'
import { connectLive, type LiveConn, type LiveState } from '../net/live'
import type { ClientMsg, DistrictId, FestivalId, LivePerson, PosterView, ServerMsg } from '../net/protocol'
import { loadOrCreateLook } from '../player/avatar'
import { closeAudio } from '../audio/horn'
import type { Controls } from '../player/controls'
import { createPlayer } from '../player/player'
import { installTestHooks } from '../testHooks'
import { createSitting, type BenchHooks, type Sitting } from './benches'
import { loadDistrict, type District } from './district'
import { createDriving, type Driving, type DriveHooks } from './driving'
import { createBubbles } from './npcBubbles'
import { createNpcs, type Npcs } from './npcs'
import { createPeople, createPeopleLabels, type People } from './people'
import { createPosters, type Posters } from './posters'
import type { SessionPosterHooks } from './usePosters'
import type { AvatarLook, DistrictDef, LandmarkDef, NpcDef, Vec2 } from './types'

/** A hazy Jaipur blue, until the live sky (weather and time of day) paints it. */
const SKY = '#BFD6DE'
/** The sun moves slowly; the sky is recomputed from the clock this often. */
const SKY_REFRESH_MS = 30_000
/** A tap moves less than this many px and lasts less than this many ms. */
const TAP_SLOP = 10
const TAP_MS = 500
/**
 * Without a live socket for this long, the other people are taken off the street: they would only stand there
 * frozen. The next welcome brings back whoever is still about.
 */
const STALE_MS = 3000

export type Player = ReturnType<typeof createPlayer>

/**
 * One piece of a district's wiring. Created on enter, stepped every frame after the player (with where the
 * player now stands), and disposed on leave, in the reverse of the order the systems were created.
 */
export type DistrictSystem = { update?(dt: number, pos: Vec2): void; dispose(): void }

/**
 * What the session needs from React. Everything is read through a getter or called as a callback, so App
 * passes stable functions and nothing here re-runs the stage effect.
 */
export interface SessionHooks {
  /** The language the status bubbles are drawn in. */
  lang(): Lang
  /** Stamps: call every frame, `pressed` collects. Returns the landmark in reach. */
  track(pos: Vec2, landmarks: LandmarkDef[], pressed: boolean): LandmarkDef | null
  /** Metro: call every frame, `pressed` toggles the sheet. Returns whether the station is in reach. */
  trackStation(pos: Vec2, station: Vec2, pressed: boolean): boolean
  /** The character card (see useNpcCard). */
  npcCard: {
    step(pos: Vec2, npcs: Npcs, pressed: boolean, landmarkNear: boolean): void
    tap(npc: NpcDef, landmarkNear: boolean): void
    close(): void
    isOpen(): boolean
  }
  /** The person card (see usePersonCard); outranked by landmark and character cards. */
  personCard: {
    step(pos: Vec2, people: Pick<People, 'entries'>, pressed: boolean, landmarkNear: boolean): void
    tap(person: LivePerson, blocked: boolean): void
    close(): void
    isOpen(): boolean
  }
  /** The live city the sky is painted from; `patch` and `freeze` serve the test hooks. */
  live: Pick<LiveCity, 'current' | 'now' | 'patch' | 'freeze'>
  /** The festival in effect. */
  festival(): FestivalId | null
  /** The look the player wears, when the profile has one; otherwise the visitor's own saved look. */
  look?(): AvatarLook | null
  /** The place label: the district just entered, or null when the first one could not be opened. */
  place(def: DistrictDef | null): void
  /**
   * The live district: other people, and being seen by them. Without it the session stays offline.
   * `token` is read on every (re)connect: a resident's token, or null to come in as a ghost.
   * `replaced(true)` says another tab of the same person took over, and this one will not reconnect;
   * `replaced(false)` clears that once a socket is welcomed again.
   */
  presence?: {
    token(): Promise<string | null>
    replaced(on: boolean): void
    /** The socket was closed for a ban (4004): the page should ask the server who it is now. */
    banned?(): void
    /**
     * The line for room in a full city: on every welcome (`visible` as it says, `position` null unless this
     * resident waits as a ghost) and on every new position (see useQueue).
     */
    queued?(position: number | null, visible: boolean): void
  }
  /** Tapris and benches: what the sitting system tells React (see useBench). Needs `presence`. */
  bench?: BenchHooks
  /** The poster walls: what they tell React (see usePosters). Read with the presence token when there is one. */
  posters?: SessionPosterHooks
  /** Driving a parked auto: what it tells React (see useDrive). */
  drive?: DriveHooks
}

export interface CitySessionOptions {
  stage: Stage
  controls: Controls
  canvas: HTMLCanvasElement
  /** Where the status bubbles go. */
  bubbleHost: HTMLElement
  /** The district the city opens in. */
  start: DistrictId
  hooks: SessionHooks
  /** Tests hand in a fake socket. */
  WebSocketImpl?: typeof WebSocket
}

export interface CitySession {
  /** The district the player is in, once one has loaded. */
  district(): District | null
  player(): Player | null
  /** Swaps the player's avatar now, in the district it is in; later districts use `hooks.look`. */
  setLook(look: AvatarLook): void
  /**
   * Loads `id`, then (only once it is in) leaves the current district for it, standing the player at its
   * station. If it cannot be loaded, the current district carries on and this rejects.
   */
  travelTo(id: DistrictId, signal?: AbortSignal): Promise<void>
  /** After a district's systems are up and the player stands in it. Returns an unsubscribe. */
  onEnter(cb: (d: District) => void): () => void
  /** Before a district is torn down (by travel or dispose), while it is still standing. */
  onLeave(cb: (d: District) => void): () => void
  /** Every frame there is a district, after the player and the systems have stepped. */
  onFrame(cb: (dt: number, pos: Vec2) => void): () => void
  /** Re-paints the sky from the live city and clock now (e.g. when a new snapshot arrives). */
  repaint(): void
  /**
   * Drops the live socket and opens a fresh one, reading `hooks.presence.token` again: call it when who the
   * visitor is changes (sign-in, a finished profile, sign-out), so they appear or vanish without a reload.
   */
  reconnectLive(): void
  /** Asks to sit at the bench in reach ("Baitho"); the server's answer seats the player. */
  sit(): void
  /** Gets up from the bench ("Utho"). */
  stand(): void
  /** Says a line at the player's bench; false when not seated or the line is blank. */
  say(text: string): boolean
  /** Gets into the parked auto in reach ("Auto chalao"), standing up from a bench first. */
  mount(): void
  /** Gets out of the auto, at a clear spot beside it; with none, stays in and says so. */
  exitAuto(): void
  /** The horn: only while driving, at most twice a second, and only heard here. */
  honk(): void
  /** A poster this page just pinned goes up on its wall at once (the socket's word on it may lag). */
  pinned(p: PosterView): void
  /** One of this page's own posters came down. */
  unpinned(id: string): void
  /** Fetches the walls again (after a block, whose effect on them only the server knows). */
  refreshPosters(): void
  /** Leaves the district and stops; a district still loading is disposed when it arrives. */
  dispose(): void
}

/** The world for one visit to the city: the district the player is in, its systems, and travel. */
export function createCitySession(opts: CitySessionOptions): CitySession {
  const { stage, controls, canvas, bubbleHost, hooks } = opts
  stage.scene.background = new THREE.Color(SKY) // until the live sky takes over
  /** Listener lists are replaced, never mutated, so a listener may unsubscribe while they run. */
  let entered: ((d: District) => void)[] = []
  let left: ((d: District) => void)[] = []
  let frames: ((dt: number, pos: Vec2) => void)[] = []
  let here: {
    district: District
    player: Player
    systems: DistrictSystem[]
    presence: Presence | null
    sitting: Sitting | null
    posters: Posters | null
    driving: Driving
  } | null = null
  let repaint = () => {}
  let disposed = false

  const offFrame = stage.onFrame((dt) => {
    if (!here) return
    here.player.update(dt)
    const pos = here.player.position()
    const { systems } = here
    for (let i = 0; i < systems.length; i++) systems[i]!.update?.(dt, pos)
    const listeners = frames
    for (let i = 0; i < listeners.length; i++) listeners[i]!(dt, pos)
  })

  function leave() {
    const was = here
    if (!was) return
    here = null
    repaint = () => {}
    for (const cb of left) guard('onLeave', cb, was.district)
    for (let i = was.systems.length - 1; i >= 0; i--) was.systems[i]!.dispose()
    was.player.dispose()
    was.district.dispose()
  }

  async function enter(id: DistrictId, at: 'spawn' | 'station', signal?: AbortSignal): Promise<void> {
    const district = await loadDistrict(id).catch(() => null)
    if (disposed) return district?.dispose()
    if (signal?.aborted && district) {
      // the rider gave up waiting: the district they left stays
      district.dispose()
      throw new Error(`Trip to ${id} cancelled`)
    }
    if (!district) {
      if (at === 'spawn') hooks.place(null)
      throw new Error(`Could not load ${id}`)
    }
    leave()
    stage.scene.add(district.root)
    const player = createPlayer({
      scene: stage.scene,
      camera: stage.camera,
      controls,
      look: hooks.look?.() ?? loadOrCreateLook(),
      colliders: district.colliders,
      occluders: district.occluders,
    })
    const start = district.def[at]
    player.teleport(start.x, start.z)
    const npcs = createNpcs(district.def.npcs, stage.scene)
    const sky = createSky(stage, district, hooks)
    // made here, not in the presence, so taps and E can reach the people too
    const people = hooks.presence ? createPeople(stage.scene) : null
    // sits and lines go out on the live socket, which opens below
    let presence: Presence | null = null
    const sitting =
      hooks.presence && hooks.bench
        ? createSitting({ def: district.def, player, hooks: hooks.bench, send: (m) => presence?.send(m) })
        : null
    const posterHooks = hooks.posters
    const posters = posterHooks
      ? createPosters({
          scene: stage.scene,
          def: district.def,
          hooks: posterHooks,
          // the presence's token: a ghost's list is everyone's, a resident's leaves out their blocks
          load: async (signal) => getPosters(id, (await hooks.presence?.token()) ?? null, signal),
        })
      : null
    const driving = createDriving({
      autos: district.autos,
      player,
      stand: () => sitting?.stand(),
      hooks: hooks.drive ?? { near() {}, driving() {}, blocked() {}, rescued() {} },
    })
    const systems: DistrictSystem[] = [
      npcs,
      sky,
      createLights(stage, district),
      { update: (_dt, pos) => driving.update(pos), dispose: driving.dispose },
      createInteraction(canvas, stage, controls, district, npcs, people, sitting, posters, driving, hooks),
      createBubbleSystem(bubbleHost, stage, npcs, hooks),
    ]
    if (posters)
      systems.push({
        update: (_dt, pos) => posters.update(pos),
        dispose() {
          posters.dispose()
          posterHooks!.left()
        },
      })
    // one live socket per tab: `leave` above closed the last district's before this one opens
    presence =
      hooks.presence && people
        ? createPresence(
            stage,
            district,
            player,
            bubbleHost,
            people,
            sitting,
            posters,
            hooks.presence,
            opts.WebSocketImpl,
          )
        : null
    if (presence) systems.push(presence)
    // without a socket there is no welcome to fetch the walls on: fetch them now
    else posters?.refresh()
    // disposed first (systems go in reverse), so the bench chat closes before the socket does
    if (sitting) systems.push({ update: (_dt, pos) => sitting.update(pos), dispose: sitting.dispose })
    here = { district, player, systems, presence, sitting, posters, driving }
    repaint = sky.paint
    hooks.place(district.def)
    installTestHooks({
      quality: () => stage.quality,
      framesSinceRestore: stage.framesSinceRestore,
      position: player.position,
      teleport: player.teleport,
      district: () => district.def.id,
      npcs: () =>
        npcs.entries.map(({ def, body }) => {
          const p = body.position.clone().setY(1.2).project(stage.camera)
          return {
            id: def.id,
            x: body.position.x,
            z: body.position.z,
            sx: ((p.x + 1) / 2) * innerWidth,
            sy: ((1 - p.y) / 2) * innerHeight,
          }
        }),
      freezeNpcs: npcs.freeze,
      festival: hooks.festival,
      sky: sky.params,
      posters: () =>
        (posters?.all() ?? []).map(({ poster, at }) => {
          const p = at.clone().project(stage.camera)
          return {
            id: poster.id,
            wall: poster.wall,
            slot: poster.slot,
            text: poster.text,
            sx: ((p.x + 1) / 2) * innerWidth,
            sy: ((1 - p.y) / 2) * innerHeight,
          }
        }),
      setSnapshot: (partial) => {
        hooks.live.patch(partial)
        sky.paint()
      },
      setNow: (iso) => {
        hooks.live.freeze(iso)
        sky.paint()
      },
    })
    for (const cb of entered) guard('onEnter', cb, district)
  }

  enter(opts.start, 'spawn').catch(() => {}) // `hooks.place(null)` already said it failed

  return {
    district: () => here?.district ?? null,
    player: () => here?.player ?? null,
    setLook: (look) => here?.player.setLook(look),
    travelTo(id, signal) {
      // the metro takes a standing walker: get up from a bench, and out of an auto (a boxed-in second try
      // sets the driver down where the auto stands)
      here?.sitting?.stand()
      const driving = here?.driving
      if (driving?.driving()) {
        driving.exit()
        if (driving.driving()) driving.exit()
      }
      return enter(id, 'station', signal)
    },
    onEnter(cb) {
      entered = [...entered, cb]
      return () => void (entered = entered.filter((f) => f !== cb))
    },
    onLeave(cb) {
      left = [...left, cb]
      return () => void (left = left.filter((f) => f !== cb))
    },
    onFrame(cb) {
      frames = [...frames, cb]
      return () => void (frames = frames.filter((f) => f !== cb))
    },
    repaint: () => repaint(),
    reconnectLive: () => here?.presence?.reconnect(),
    sit: () => here?.sitting?.sit(),
    stand: () => here?.sitting?.stand(),
    say: (text) => here?.sitting?.say(text) ?? false,
    mount: () => here?.driving.mount(),
    exitAuto: () => here?.driving.exit(),
    honk: () => here?.driving.honk(),
    pinned: (p) => here?.posters?.upsert(p),
    unpinned: (id) => here?.posters?.remove(id),
    refreshPosters: () => here?.posters?.refresh(),
    dispose() {
      if (disposed) return
      disposed = true
      leave()
      closeAudio()
      offFrame()
      entered = []
      left = []
      frames = []
    },
  }
}

/**
 * A listener that throws is logged and passed over: one broken listener must not skip a district's disposal,
 * starve the listeners after it, or make a travel that worked look failed.
 */
function guard(what: string, cb: (d: District) => void, d: District) {
  try {
    cb(d)
  } catch (err) {
    console.error(`session: an ${what} listener threw`, err)
  }
}

/** The live sky over a district: weather and festival effects, repainted from the clock now and then. */
function createSky(
  stage: Stage,
  district: District,
  hooks: SessionHooks,
): DistrictSystem & { paint(): void; params(): SkyParams } {
  const { current, now } = hooks.live
  const fx = createWeatherFx(stage)
  const festivalFx = createFestivalFx(stage, district)
  let sky: SkyParams | null = null
  const paint = () => {
    sky = festivalSky(skyParams(current(), now()), hooks.festival(), current().sunset, now())
    applySky(stage, district, sky)
    fx.set(sky)
    festivalFx.set(hooks.festival(), stage.quality)
  }
  paint()
  const timer = setInterval(paint, SKY_REFRESH_MS)
  const offQuality = stage.onQuality((q) => festivalFx.set(hooks.festival(), q))
  return {
    paint,
    params: () => sky!,
    update(dt: number) {
      fx.update(dt)
      festivalFx.update(dt)
    },
    dispose() {
      clearInterval(timer)
      offQuality()
      fx.dispose()
      festivalFx.dispose()
    },
  }
}

/** The sun's shadows (the first thing a slow phone gives up), kept centred on the player. */
function createLights(stage: Stage, district: District): DistrictSystem {
  const shadows = (q: QualityTier) => void (district.lights.sun.castShadow = q === 2)
  shadows(stage.quality)
  const offQuality = stage.onQuality(shadows)
  return { update: (_dt, pos) => district.focus(pos), dispose: offQuality }
}

/**
 * E and taps: a landmark's stamp, the metro, a bench, the character card and the person card, in that order
 * of priority, one card at a time; an open card keeps E to close itself. Seated, E stands the player up, and
 * the landmark and metro wait until they do. A tap, not a drag: the pointer barely moved. Taps that start on the joystick, card or HUD buttons never reach the
 * canvas, since those capture their own pointers.
 */
function createInteraction(
  canvas: HTMLCanvasElement,
  stage: Stage,
  controls: Controls,
  district: District,
  npcs: Npcs,
  people: People | null,
  sitting: Sitting | null,
  posters: Posters | null,
  drive: Driving,
  hooks: SessionHooks,
): DistrictSystem {
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let landmarkNear = false
  let down: { x: number; y: number; at: number } | null = null
  const onDown = (e: PointerEvent) => void (down = { x: e.clientX, y: e.clientY, at: e.timeStamp })
  const onUp = (e: PointerEvent) => {
    const d = down
    down = null
    // at the wheel nothing opens: not a character, a person or a poster
    if (drive.driving()) return
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP || e.timeStamp - d.at > TAP_MS) return
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, stage.camera)
    const hit = npcs.pick(ray)
    if (hit) {
      if (!landmarkNear) hooks.personCard.close() // a character outranks a person
      return hooks.npcCard.tap(hit, landmarkNear)
    }
    const who = people?.pick(ray)
    if (who) return hooks.personCard.tap(who, landmarkNear || hooks.npcCard.isOpen())
    const poster = posters?.pick(ray)
    if (poster && !landmarkNear) {
      hooks.npcCard.close()
      hooks.personCard.close()
      hooks.posters?.tap(poster)
    }
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)
  return {
    update(_dt, pos) {
      const key = controls.interact()
      // at the wheel E means get out, and nothing else hears it; Space is the horn
      const driving = drive.driving()
      if (controls.horn()) drive.honk()
      if (driving && key) drive.exit()
      const pressed = key && !driving
      const chatting = hooks.npcCard.isOpen()
      const meeting = hooks.personCard.isOpen()
      const card = chatting || meeting
      const seated = sitting?.seated() ?? false
      landmarkNear = hooks.track(pos, district.def.landmarks, pressed && !card && !seated) !== null
      // E by the station opens the metro, unless a landmark's or a character's card has it
      const metro = hooks.trackStation(
        pos,
        district.def.station,
        pressed && !landmarkNear && !card && !seated,
      )
      // E by a bench sits there (seated, it stands up), unless a card or the metro has it
      const bench = !!sitting && pressed && !card && (seated || (!landmarkNear && !metro && sitting.near()))
      if (bench) sitting.toggle()
      // E by a poster wall opens the composer, unless anything above has it or a poster's own UI is up
      const wall =
        pressed &&
        !card &&
        !seated &&
        !landmarkNear &&
        !metro &&
        !bench &&
        posters?.near() != null &&
        !hooks.posters!.isOpen()
      if (wall) hooks.posters!.compose()
      // E by a parked auto drives it, unless anything above has the key
      const auto = pressed && !card && !seated && !landmarkNear && !metro && !bench && !wall && drive.near()
      if (auto) drive.mount()
      hooks.npcCard.step(
        pos,
        npcs,
        pressed && !meeting && !bench && !wall && !auto && (chatting || !metro),
        landmarkNear,
      )
      // a character that just opened (or closed on this very E) keeps the key from the person card
      if (people)
        hooks.personCard.step(
          pos,
          people,
          pressed &&
            !chatting &&
            !bench &&
            !wall &&
            !auto &&
            (meeting || (!metro && !hooks.npcCard.isOpen())),
          landmarkNear,
        )
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      hooks.npcCard.close()
      hooks.personCard.close()
    },
  }
}

/** The characters' status bubbles, over their heads. */
function createBubbleSystem(
  host: HTMLElement,
  stage: Stage,
  npcs: Npcs,
  hooks: SessionHooks,
): DistrictSystem {
  const bubbles = createBubbles(host)
  return {
    update: (_dt, pos) => bubbles.update(stage.camera, npcs, pos, hooks.lang()),
    dispose: bubbles.dispose,
  }
}

type Presence = DistrictSystem & { reconnect(): void; send(m: ClientMsg): void }

/**
 * The district's live socket and the people it brings: their bodies, their labels, and the test hooks that
 * read them. The player's own position goes out every frame (the socket throttles it), and straight after
 * every welcome, since a socket that has not said where it stands hears nobody move. People last heard of on
 * a socket that is gone do not linger: replaced by another tab, the street empties at once; reconnecting,
 * after `STALE_MS`.
 */
function createPresence(
  stage: Stage,
  district: District,
  player: Player,
  host: HTMLElement,
  people: People,
  sitting: Sitting | null,
  posters: Posters | null,
  hooks: NonNullable<SessionHooks['presence']>,
  WebSocketImpl?: typeof WebSocket,
): Presence {
  const labels = createPeopleLabels(host)
  const shadows = (q: QualityTier) => people.setShadows(q === 2)
  shadows(stage.quality)
  const offQuality = stage.onQuality(shadows)
  /** Reused for every frame's move: the socket copies what it sends. */
  const move: Extract<ClientMsg, { t: 'move' }> = { t: 'move', x: 0, z: 0, ry: 0 }
  const sendMove = (pos: Vec2) => {
    move.x = pos.x
    move.z = pos.z
    move.ry = player.heading()
    // at the wheel the others draw an auto under us, and the server allows the faster pace
    move.v = player.driving() ? 'auto' : undefined
    conn.send(move)
  }
  const onMsg = (m: ServerMsg) => {
    if (m.t === 'error' && m.code === 'too-fast') return player.teleport(m.x, m.z, m.ry)
    if (m.t === 'queued') return hooks.queued?.(m.position, false)
    if (m.t === 'poster' || m.t === 'posters') return posters?.apply(m)
    people.apply(m)
    sitting?.apply(m)
    if (m.t === 'welcome') {
      hooks.queued?.(m.you.queued ?? null, m.you.visible)
      hooks.replaced(false)
      sitting?.reset() // a new socket: the server stood the old one up
      sendMove(player.position())
      // who this socket is may have changed (signed in or out), and news may have been missed while away
      posters?.refresh()
    }
  }
  let stale: ReturnType<typeof setTimeout> | null = null
  const onState = (s: LiveState) => {
    if (stale) clearTimeout(stale)
    stale = s === 'connecting' ? setTimeout(() => people.clear(), STALE_MS) : null
  }
  const connect = (): LiveConn => {
    const c = connectLive({
      district: district.def.id,
      token: hooks.token,
      onMsg,
      onReplaced: () => {
        people.clear()
        hooks.replaced(true)
      },
      onBanned: () => hooks.banned?.(),
      onState,
      WebSocketImpl,
    })
    onState('connecting') // where every socket starts
    return c
  }
  let conn = connect()
  installTestHooks({
    liveState: () => conn.state(),
    people: () =>
      people.entries().map(({ person, body }) => {
        const p = body.position.clone().setY(1.2).project(stage.camera)
        return {
          id: person.id,
          x: body.position.x,
          z: body.position.z,
          sx: ((p.x + 1) / 2) * innerWidth,
          sy: ((1 - p.y) / 2) * innerHeight,
        }
      }),
  })
  return {
    update(dt, pos) {
      sendMove(pos)
      people.update(dt, pos)
      labels.update(stage.camera, people, pos)
    },
    reconnect() {
      conn.close()
      sitting?.reset() // the closed socket's seat goes with it
      conn = connect()
    },
    send: (m) => conn.send(m),
    dispose() {
      conn.close() // its 'closed' stops the stale timer
      offQuality()
      labels.dispose()
      people.dispose()
    },
  }
}
