import * as THREE from 'three'
import type { QualityTier, Stage } from '../engine/stage'
import type { Lang } from '../i18n/strings'
import { createFestivalFx, festivalSky } from '../live/festivalFx'
import type { ProcessionKind } from '../live/procession'
import { applySky, skyParams, type SkyParams } from '../live/sky'
import type { LiveCity } from '../live/useLiveCity'
import { createWeatherFx } from '../live/weatherFx'
import { getPosters } from '../net/api'
import { connectLive, type LiveConn, type LiveState } from '../net/live'
import {
  REACT_RANGE_M,
  type ClientMsg,
  type DistrictId,
  type FestivalId,
  type LivePerson,
  type PosterView,
  type Reaction,
  type ServerMsg,
} from '../net/protocol'
import { loadOrCreateLook } from '../player/avatar'
import { createAmbience } from '../audio/ambience'
import { closeAudio } from '../audio/horn'
import { DRAG_TURN } from '../player/camera'
import type { Controls } from '../player/controls'
import { createPlayer } from '../player/player'
import { installTestHooks } from '../testHooks'
import { createBandar, createBandarMemory, type BandarEvent } from './bandar'
import { createAnimals, createStationMemory, type AnimalHooks, type Animals } from './animals'
import { createSitting, type BenchHooks, type Sitting } from './benches'
import { loadDistrict, type District } from './district'
import { createDriving, type Driving, type DriveHooks } from './driving'
import { createEmotes } from './emotes'
import { createBubbles } from './npcBubbles'
import { createNpcs, type Npcs } from './npcs'
import { placeSpot } from './placeLink'
import { createPeople, createPeopleLabels, type People, type Remote } from './people'
import { createPosters, type Posters } from './posters'
import { createRooftop, roofHeight, type RoofHooks, type Rooftop } from './rooftop'
import { createTaxi, type Taxi, type TaxiHooks } from './taxi'
import type { SessionPosterHooks } from './usePosters'
import type { ReactionHooks, ReactionRefusal } from './useReactions'
import type { AvatarLook, DistrictDef, LandmarkDef, NpcDef, Vec2 } from './types'
import { createZoomGestures } from './zoomGestures'

/** A hazy Jaipur blue, until the live sky (weather and time of day) paints it. */
const SKY = '#BFD6DE'
/** The sun moves slowly; the sky is recomputed from the clock this often. */
const SKY_REFRESH_MS = 30_000
/** A tap moves less than this many px and lasts less than this many ms. */
const TAP_SLOP = 10
const TAP_MS = 500
/** A vertical drag tilts the view this fraction of what the same drag across would turn it: a sideways swipe's drift barely tips it. */
const DRAG_TILT = 0.5
/**
 * Without a live socket for this long, the other people are taken off the street: they would only stand there
 * frozen. The next welcome brings back whoever is still about.
 */
const STALE_MS = 3000
/** An angle brought into [-π, π]. */
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

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
  /** The auto-taxi ("Le chalo"): what it tells React (see useTaxi). */
  taxi?: TaxiHooks
  /** The street animals: the one in reach, the one following, and their passing lines (see useAnimals). */
  animals?: AnimalHooks
  /** The Galta bandar (Walled City): `blocked` while a card, sheet, bench, kite game or metro ride is up. */
  bandar?: { blocked(): boolean; event(e: BandarEvent): void }
  /** The rooftop viewpoint: its stair in reach, being up there, and the fade between (see useRooftop). */
  roof?: RoofHooks
  /** Greetings: one that reached the player, one of theirs that went, or one refused (see useReactions). Needs `presence`. */
  reactions?: ReactionHooks
}

export interface CitySessionOptions {
  stage: Stage
  controls: Controls
  canvas: HTMLCanvasElement
  /** Where the status bubbles go. */
  bubbleHost: HTMLElement
  /** The district the city opens in. */
  start: DistrictId
  /**
   * A place in `start` to stand at instead of its spawn, from a link (see `placeSpot`); the first district only.
   * One it does not have is the spawn.
   */
  startAt?: string
  hooks: SessionHooks
  /** Tests hand in a fake socket. */
  WebSocketImpl?: typeof WebSocket
}

export interface CitySession {
  /** The district the player is in, once one has loaded. */
  district(): District | null
  player(): Player | null
  /** The other people in the district, as the street draws them (none offline). See `mapPeople`. */
  people(): readonly Remote[]
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
  /** "Le chalo": the auto-taxi from the parked auto in reach to landmark `to`; false when it may not go now. */
  taxi(to: string): boolean
  /** Cuts the taxi ride short: on foot beside the landmark at once. */
  skipTaxi(): void
  /** At the rooftop stair's foot, climbs ("Chhat pe chalo"); up there, comes down. Not seated or at the wheel. */
  climb(): void
  /** "Saath chalo": calls the animal in reach (the cow answers with a line instead). */
  callAnimal(): void
  /** "Ghar jao": the follower goes back to where it lives. */
  animalHome(): void
  /** A poster this page just pinned goes up on its wall at once (the socket's word on it may lag). */
  pinned(p: PosterView): void
  /** One of this page's own posters came down. */
  unpinned(id: string): void
  /** Fetches the walls again (after a block, whose effect on them only the server knows). */
  refreshPosters(): void
  /**
   * Greets `to` ("Namaste", "Haath hilao"): null once it went out on the socket (the server's answer follows,
   * see `hooks.reactions`), or why it could not go: no open socket, they are not drawn, or more than
   * `REACT_RANGE_M` away.
   */
  react(to: string, kind: Reaction): ReactionRefusal | null
  /** Leaves the district and stops; a district still loading is disposed when it arrives. */
  dispose(): void
}

/** The world for one visit to the city: the district the player is in, its systems, and travel. */
export function createCitySession(opts: CitySessionOptions): CitySession {
  const { stage, controls, canvas, bubbleHost, hooks } = opts
  let startAt = opts.startAt
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
    people: People | null
    sitting: Sitting | null
    posters: Posters | null
    driving: Driving
    taxi: Taxi
    animals: Animals
    roof: Rooftop | null
  } | null = null
  /** An animal left at a station by a metro ride waits here (not saved: a reload forgets it). */
  const stationMemory = createStationMemory()
  /** The monkey's last raid, so leaving and coming back does not reset its 10 minutes. */
  const bandarMemory = createBandarMemory()
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
    // the follower waits at this district's station; the toast says so
    if (at === 'station') here?.animals.beginTravel()
    leave()
    stage.scene.add(district.root)
    stage.settle() // its first frames compile shaders and upload textures: not a slow phone
    const player = createPlayer({
      scene: stage.scene,
      camera: stage.camera,
      controls,
      look: hooks.look?.() ?? loadOrCreateLook(),
      colliders: district.colliders,
      occluders: district.occluders,
    })
    // opened from a link to a place: there, facing it, the first time only
    const spot = at === 'spawn' && startAt ? placeSpot(district, startAt) : null
    startAt = undefined
    if (spot) {
      player.lookAlong(spot.ry)
      player.teleport(spot.x, spot.z, spot.ry)
    } else {
      const start = district.def[at]
      player.teleport(start.x, start.z)
    }
    const npcs = createNpcs(district.def.npcs, stage.scene)
    const animals = createAnimals(district.def, stage.scene, {
      colliders: district.colliders,
      memory: stationMemory,
      hooks: hooks.animals,
      quality: stage.quality,
    })
    const offAnimalQuality = stage.onQuality(animals.setQuality)
    const bandar = createBandar(district.def, stage.scene, Math.random, {
      look: () => hooks.look?.() ?? loadOrCreateLook(),
      colliders: district.colliders,
      blocked: () => (hooks.bandar?.blocked() ?? false) || !!here?.sitting?.seated(),
      memory: bandarMemory,
    })
    const sky = createSky(stage, district, hooks)
    // made here, not in the presence, so taps and E can reach the people too
    // someone inside the rooftop strip is up on the roof (nobody on the street can stand there)
    const roofDef = district.def.roof
    const people = hooks.presence ? createPeople(stage.scene, (x, z) => roofHeight(roofDef, x, z)) : null
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
      // up on the roof the autos below are out of reach, and in the taxi the wheel is the taxi's (both are made
      // just after this)
      away: () => (roof?.up() ?? false) || taxi.riding(),
      hooks: {
        ...(hooks.drive ?? { near() {}, driving() {}, blocked() {}, rescued() {} }),
        driving(on) {
          // at the wheel Space is the horn's alone
          controls.holdSpace(on)
          hooks.drive?.driving(on)
        },
      },
    })
    const roof = roofDef
      ? createRooftop({
          roof: roofDef,
          player,
          hooks: hooks.roof ?? { near() {}, up() {}, fade() {} },
          // the view swings round to look out from the roof (eased, under the fade)
          face: (yaw) => controls.addLook(wrapAngle(yaw - player.view().yaw), 0),
        })
      : null
    // a ride goes out on the live socket, which opens below
    const taxi = createTaxi({
      def: district.def,
      autos: district.autos,
      player,
      send: (m) => presence?.send(m),
      blocked: () =>
        !!sitting?.seated() ||
        hooks.npcCard.isOpen() ||
        hooks.personCard.isOpen() ||
        (hooks.posters?.isOpen() ?? false),
      // up on the roof the autos below are out of reach, as they are for "Auto chalao"
      away: () => roof?.up() ?? false,
      // the server must hear of the ride, or the step out after it would be refused as a jump
      online: () => presence?.open() ?? true,
      hooks: hooks.taxi ?? { near() {}, riding() {}, dark() {}, refused() {} },
    })
    const systems: DistrictSystem[] = [
      npcs,
      {
        update: animals.update,
        dispose() {
          offAnimalQuality()
          animals.dispose()
        },
      },
      {
        update: (dt) => {
          const e = bandar.update(dt, player)
          if (e) hooks.bandar?.event(e)
        },
        dispose: bandar.dispose,
      },
      sky,
      createAmbience({
        district: district.def.id,
        sky: sky.params,
        festival: hooks.festival,
        quality: () => stage.quality,
        onQuality: stage.onQuality,
      }),
      createLights(stage, district),
      { update: (_dt, pos) => driving.update(pos), dispose: driving.dispose },
      taxi,
      ...(roof ? [{ update: (_dt: number, pos: Vec2) => roof.update(pos), dispose: roof.dispose }] : []),
      createInteraction(
        canvas,
        stage,
        controls,
        district,
        npcs,
        people,
        sitting,
        posters,
        driving,
        animals,
        roof,
        hooks,
      ),
      createBubbleSystem(bubbleHost, stage, npcs, hooks),
      createZoomGestures(canvas, controls),
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
            taxi,
            hooks.presence,
            hooks.reactions,
            opts.WebSocketImpl,
          )
        : null
    if (presence) systems.push(presence)
    // without a socket there is no welcome to fetch the walls on: fetch them now
    else posters?.refresh()
    // disposed first (systems go in reverse), so the bench chat closes before the socket does
    if (sitting) systems.push({ update: (_dt, pos) => sitting.update(pos), dispose: sitting.dispose })
    here = { district, player, systems, presence, people, sitting, posters, driving, taxi, animals, roof }
    repaint = sky.paint
    hooks.place(district.def)
    installTestHooks({
      quality: () => stage.quality,
      framesSinceRestore: stage.framesSinceRestore,
      gameTime: stage.gameTime,
      position: player.position,
      view: player.view,
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
      animals: () =>
        animals.list().map((a) => {
          const p = new THREE.Vector3(a.x, 0.5, a.z).project(stage.camera)
          return {
            id: a.id,
            kind: a.kind,
            x: a.x,
            z: a.z,
            following: a.following,
            sx: ((p.x + 1) / 2) * innerWidth,
            sy: ((1 - p.y) / 2) * innerHeight,
          }
        }),
      freezeAnimals: animals.freeze,
      roof: () =>
        roofDef ? { up: roof!.up(), y: player.elevation(), stair: roofDef.stair, area: roofDef.area } : null,
      signposts: () => district.def.signposts ?? [],
      festival: hooks.festival,
      sky: sky.params,
      procession: () => ({ count: sky.procession() }),
      forceProcession: sky.forceProcession,
      renderInfo: () => {
        const { render, memory, programs } = stage.renderer.info
        return {
          calls: render.calls,
          triangles: render.triangles,
          geometries: memory.geometries,
          textures: memory.textures,
          programs: programs?.length ?? 0,
        }
      },
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
    people: () => here?.people?.entries() ?? [],
    setLook: (look) => here?.player.setLook(look),
    travelTo(id, signal) {
      // the metro takes a standing walker: get up from a bench, and out of an auto (boxed in, where the auto
      // stands), with no toast about it
      here?.sitting?.stand()
      here?.driving.forceExit()
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
    mount() {
      if (!here?.taxi.riding()) here?.driving.mount()
    },
    exitAuto: () => here?.driving.exit(),
    honk: () => here?.driving.honk(),
    taxi: (to) => here?.taxi.go(to) ?? false,
    skipTaxi: () => here?.taxi.skip(),
    climb() {
      if (!here?.roof || here.player.driving() || here.sitting?.seated()) return
      here.roof.toggle()
    },
    callAnimal() {
      if (here) here.animals.call(here.player.position())
    },
    animalHome: () => here?.animals.sendHome(),
    pinned: (p) => here?.posters?.upsert(p),
    unpinned: (id) => here?.posters?.remove(id),
    refreshPosters: () => here?.posters?.refresh(),
    // null is "it went": only a missing socket is offline
    react: (to, kind) => (here?.presence ? here.presence.react(to, kind) : 'offline'),
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
): DistrictSystem & {
  paint(): void
  params(): SkyParams
  procession(): number
  forceProcession(kind: ProcessionKind | null): void
} {
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
    procession: festivalFx.processionCount,
    forceProcession: (kind) => festivalFx.forceProcession?.(kind, stage.quality),
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
 * E and taps: a landmark's stamp, the metro, a bench, a poster wall, an auto, the rooftop stair, the character
 * card and the person card, and last a street animal, in that order of priority, one card at a time; an open card keeps E to close itself. Seated, E stands the player up, and
 * the landmark and metro wait until they do; up on the roof, E comes down (a card that is up closes first). A tap, not a drag: the pointer barely moved. Taps that start on the joystick, card or HUD buttons never reach the
 * canvas, since those capture their own pointers.
 *
 * A drag is the look: the first pointer down on the canvas (a mouse's main button, or one finger) that moves past
 * TAP_SLOP turns the view (`controls.addLook`) until it lifts, and is never a tap. Right turns right, up tilts up,
 * and the stage's full width is DRAG_TURN. The joystick's thumb is on its own element, so the other thumb can look
 * while it walks. While dragging the canvas has `data-looking` (the grabbing cursor) and `controls.holdLook` is on.
 * A mouse let go of off the canvas is noticed at its next hover there (no main button held).
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
  animals: Animals,
  roof: Rooftop | null,
  hooks: SessionHooks,
): DistrictSystem {
  /** Where the player stands, for a tap on an animal. */
  const at: Vec2 = { x: 0, z: 0 }
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  let landmarkNear = false
  let down: { x: number; y: number; at: number } | null = null
  /** The pointers down on the canvas itself: the joystick's thumb, on its own element, is not one of them. */
  const touching = new Set<number>()
  /**
   * The pointer that may look: where it last was, radians per px (from the canvas's width when it went down),
   * and whether it has moved past the slop yet (a drag, then, not a tap).
   */
  const look = { id: -1, x: 0, y: 0, perPx: 0, dragging: false }
  const stopLook = () => {
    if (look.dragging) controls.holdLook(false)
    look.id = -1
    look.dragging = false
    canvas.removeAttribute('data-looking')
  }
  const onDown = (e: PointerEvent) => {
    touching.add(e.pointerId)
    // A second finger on the canvas (a pinch) or a right or middle click is not a tap, and spoils the one in progress.
    down = touching.size > 1 || (e.button ?? 0) > 0 ? null : { x: e.clientX, y: e.clientY, at: e.timeStamp }
    // a pinch zooms (see zoomGestures): the finger that was looking stops turning the view
    if (touching.size > 1) stopLook()
    // the first of them may look; a second finger never takes over
    if (down && look.id === -1) {
      look.id = e.pointerId
      look.x = e.clientX
      look.y = e.clientY
      look.perPx = DRAG_TURN / (canvas.getBoundingClientRect().width || innerWidth)
      look.dragging = false
    }
  }
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== look.id) return
    // a mouse let go of over a chip or a card: the canvas never heard the up, and this is a hover
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) return stopLook()
    if (!look.dragging) {
      if (Math.hypot(e.clientX - look.x, e.clientY - look.y) <= TAP_SLOP) return
      look.dragging = true
      controls.holdLook(true) // held still at the wheel, it keeps the view where it is put
      canvas.setAttribute('data-looking', '')
      // a mouse dragged out over the HUD keeps turning, and its release is heard here
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // not an active pointer (a synthetic event): nothing to hold on to
      }
    }
    // from where it went down, so the slop is part of the turn, not a dead zone
    controls.addLook(-(e.clientX - look.x) * look.perPx, -(e.clientY - look.y) * look.perPx * DRAG_TILT)
    look.x = e.clientX
    look.y = e.clientY
  }
  const onCancel = (e: PointerEvent) => {
    touching.delete(e.pointerId)
    down = null
    if (e.pointerId === look.id) stopLook()
  }
  const onUp = (e: PointerEvent) => {
    touching.delete(e.pointerId)
    const dragged = e.pointerId === look.id && look.dragging
    if (e.pointerId === look.id) stopLook()
    const d = down
    down = null
    // at the wheel nothing opens: not a character, a person or a poster
    if (drive.driving() || dragged) return
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP || e.timeStamp - d.at > TAP_MS) return
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, stage.camera)
    // a poster's card or the composer has the screen as any card does: nothing under it opens
    const postering = hooks.posters?.isOpen() ?? false
    const hit = npcs.pick(ray)
    if (hit) {
      if (!landmarkNear && !postering) hooks.personCard.close() // a character outranks a person
      return hooks.npcCard.tap(hit, landmarkNear || postering)
    }
    const who = people?.pick(ray)
    if (who) return hooks.personCard.tap(who, landmarkNear || postering || hooks.npcCard.isOpen())
    const poster = posters?.pick(ray)
    if (poster) {
      if (landmarkNear) return
      hooks.npcCard.close()
      hooks.personCard.close()
      return hooks.posters?.tap(poster)
    }
    // last: an animal, unless a card is up, a landmark has the screen, or the player is seated or up on a roof
    if (
      landmarkNear ||
      postering ||
      hooks.npcCard.isOpen() ||
      hooks.personCard.isOpen() ||
      sitting?.seated() ||
      roof?.up()
    )
      return
    const pet = animals.pick(ray, at)
    if (pet) animals.call(at, pet.id)
  }
  // A pointer whose up and cancel never came (a lost capture, a backgrounded tab, a call over the page) must not
  // count as down for good, or every later tap would look like a pinch.
  const forgetAll = () => {
    touching.clear()
    down = null
    stopLook()
  }
  const onHidden = () => {
    if (document.visibilityState === 'hidden') forgetAll()
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onCancel)
  canvas.addEventListener('lostpointercapture', onCancel)
  window.addEventListener('blur', forgetAll)
  document.addEventListener('visibilitychange', onHidden)
  return {
    update(_dt, pos) {
      at.x = pos.x
      at.z = pos.z
      const key = controls.interact()
      // at the wheel E means get out, and nothing else hears it; Space is the horn
      const driving = drive.driving()
      if (controls.horn()) drive.honk()
      if (driving && key) drive.exit()
      // up on the roof E comes down (or closes a card that is up), and nothing below hears it
      const onRoof = roof?.up() ?? false
      const press = key && !driving
      const pressed = press && !onRoof
      const chatting = hooks.npcCard.isOpen()
      const meeting = hooks.personCard.isOpen()
      // a poster's card or the composer is a card like any other: E is not for anything under it
      const postering = hooks.posters?.isOpen() ?? false
      const card = chatting || meeting || postering
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
      const wall = pressed && !card && !seated && !landmarkNear && !metro && !bench && posters?.near() != null
      if (wall) hooks.posters!.compose()
      // E by a parked auto drives it, unless anything above has the key
      const auto = pressed && !card && !seated && !landmarkNear && !metro && !bench && !wall && drive.near()
      if (auto) drive.mount()
      // E at the rooftop stair climbs, unless anything above has the key; up there it comes down
      const stair =
        !!roof &&
        press &&
        !card &&
        (onRoof || (!seated && !landmarkNear && !metro && !bench && !wall && !auto && roof.near()))
      if (stair) roof.toggle()
      hooks.npcCard.step(
        pos,
        npcs,
        press && !stair && !meeting && !postering && !bench && !wall && !auto && (chatting || !metro),
        landmarkNear,
      )
      // a character that just opened (or closed on this very E) keeps the key from the person card
      if (people)
        hooks.personCard.step(
          pos,
          people,
          press &&
            !stair &&
            !chatting &&
            !postering &&
            !bench &&
            !wall &&
            !auto &&
            (meeting || (!metro && !hooks.npcCard.isOpen())),
          landmarkNear,
        )
      // E by an animal, only when nothing above wanted it (a card that just opened has it)
      if (
        pressed &&
        !card &&
        !seated &&
        !landmarkNear &&
        !metro &&
        !bench &&
        !wall &&
        !auto &&
        !stair &&
        !hooks.npcCard.isOpen() &&
        !hooks.personCard.isOpen()
      )
        animals.call(pos)
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('lostpointercapture', onCancel)
      window.removeEventListener('blur', forgetAll)
      document.removeEventListener('visibilitychange', onHidden)
      stopLook()
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

type Presence = DistrictSystem & {
  reconnect(): void
  send(m: ClientMsg): void
  open(): boolean
  react(to: string, kind: Reaction): ReactionRefusal | null
}

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
  /** While it rides, nothing is said of where the player is: the server already set them down at the landmark. */
  taxi: Pick<Taxi, 'riding' | 'refused'>,
  hooks: NonNullable<SessionHooks['presence']>,
  reactions: ReactionHooks | undefined,
  WebSocketImpl?: typeof WebSocket,
): Presence {
  const labels = createPeopleLabels(host)
  const emotes = createEmotes(host)
  /** Who this socket is, as its welcome said: the player's own emotes go over the player. */
  let self: string | null = null
  /** Where the player stands this frame, for an emote over their own head. */
  const here = { x: 0, z: 0 }
  /** Where `id` is drawn now, for an emote over their head: the player, or someone on the street in view. */
  const emoteAt = (id: string, out: THREE.Vector3) => {
    if (id === self) {
      out.set(here.x, player.elevation(), here.z)
      return true
    }
    const r = people.get(id)
    if (!r || !r.body.visible) return false
    out.copy(r.body.position)
    return true
  }
  /** Someone the player can see (or the player): only between them is a greeting drawn or told. */
  const known = (id: string) => id === self || people.get(id) !== undefined
  const onReact = (m: Extract<ServerMsg, { t: 'react' }>) => {
    if (!known(m.from) || !known(m.to)) return
    emotes.show(m.from, m.kind)
    emotes.show(m.to, m.kind)
    if (m.from === self) reactions?.sent(m.to, m.kind)
    else if (m.to === self) reactions?.got({ id: m.from, name: people.get(m.from)!.person.name }, m.kind)
  }
  const shadows = (q: QualityTier) => people.setShadows(q === 2)
  shadows(stage.quality)
  const offQuality = stage.onQuality(shadows)
  /** Reused for every frame's move: the socket copies what it sends. */
  const move: Extract<ClientMsg, { t: 'move' }> = { t: 'move', x: 0, z: 0, ry: 0 }
  const sendMove = (pos: Vec2) => {
    if (taxi.riding()) return
    move.x = pos.x
    move.z = pos.z
    move.ry = player.heading()
    // at the wheel the others draw an auto under us, and the server allows the faster pace
    move.v = player.driving() ? 'auto' : undefined
    // a jog asks for the jog's allowance, so a stall while jogging is not pulled back (never relayed)
    move.pace = player.jogging() ? 'jog' : undefined
    conn.send(move)
  }
  const onMsg = (m: ServerMsg) => {
    if (m.t === 'error' && m.code === 'too-fast') return player.teleport(m.x, m.z, m.ry)
    if (m.t === 'error' && m.code === 'no-ride') return taxi.refused()
    if (m.t === 'queued') return hooks.queued?.(m.position, false)
    if (m.t === 'poster' || m.t === 'posters') return posters?.apply(m)
    if (m.t === 'react') return onReact(m)
    if (m.t === 'react-no') return reactions?.refused(m.to, m.why)
    people.apply(m)
    sitting?.apply(m)
    if (m.t === 'welcome') {
      self = m.you.id
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
    stale =
      s === 'connecting'
        ? setTimeout(() => {
            people.clear()
            emotes.clear()
          }, STALE_MS)
        : null
  }
  const connect = (): LiveConn => {
    const c = connectLive({
      district: district.def.id,
      token: hooks.token,
      onMsg,
      onReplaced: () => {
        people.clear()
        emotes.clear()
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
      here.x = pos.x
      here.z = pos.z
      emotes.update(dt, stage.camera, emoteAt)
    },
    reconnect() {
      conn.close()
      sitting?.reset() // the closed socket's seat goes with it
      conn = connect()
    },
    send: (m) => conn.send(m),
    open: () => conn.state() === 'open',
    react(to, kind) {
      if (conn.state() !== 'open') return 'offline'
      const r = people.get(to)
      if (!r || !r.body.visible) return 'gone'
      const { x, z } = player.position()
      if (Math.hypot(r.body.position.x - x, r.body.position.z - z) > REACT_RANGE_M) return 'far'
      conn.send({ t: 'react', to, kind })
      return null
    },
    dispose() {
      conn.close() // its 'closed' stops the stale timer
      offQuality()
      emotes.dispose()
      labels.dispose()
      people.dispose()
    },
  }
}
