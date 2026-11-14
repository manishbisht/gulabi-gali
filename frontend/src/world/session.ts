import * as THREE from 'three'
import type { QualityTier, Stage } from '../engine/stage'
import type { Lang } from '../i18n/strings'
import { createFestivalFx, festivalSky } from '../live/festivalFx'
import { applySky, skyParams, type SkyParams } from '../live/sky'
import type { LiveCity } from '../live/useLiveCity'
import { createWeatherFx } from '../live/weatherFx'
import { connectLive, type LiveConn } from '../net/live'
import type { ClientMsg, DistrictId, FestivalId, ServerMsg } from '../net/protocol'
import { loadOrCreateLook } from '../player/avatar'
import type { Controls } from '../player/controls'
import { createPlayer } from '../player/player'
import { installTestHooks } from '../testHooks'
import { loadDistrict, type District } from './district'
import { createBubbles } from './npcBubbles'
import { createNpcs, type Npcs } from './npcs'
import { createPeople, createPeopleLabels } from './people'
import type { AvatarLook, DistrictDef, LandmarkDef, NpcDef, Vec2 } from './types'

/** A hazy Jaipur blue, until the live sky (weather and time of day) paints it. */
const SKY = '#BFD6DE'
/** The sun moves slowly; the sky is recomputed from the clock this often. */
const SKY_REFRESH_MS = 30_000
/** A tap moves less than this many px and lasts less than this many ms. */
const TAP_SLOP = 10
const TAP_MS = 500

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
  presence?: { token(): Promise<string | null>; replaced(on: boolean): void }
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
  travelTo(id: DistrictId): Promise<void>
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

  async function enter(id: DistrictId, at: 'spawn' | 'station'): Promise<void> {
    const district = await loadDistrict(id).catch(() => null)
    if (disposed) return district?.dispose()
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
    const systems: DistrictSystem[] = [
      npcs,
      sky,
      createLights(stage, district),
      createInteraction(canvas, stage, controls, district, npcs, hooks),
      createBubbleSystem(bubbleHost, stage, npcs, hooks),
    ]
    // one live socket per tab: `leave` above closed the last district's before this one opens
    const presence = hooks.presence
      ? createPresence(stage, district, player, bubbleHost, hooks.presence, opts.WebSocketImpl)
      : null
    if (presence) systems.push(presence)
    here = { district, player, systems, presence }
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
    travelTo: (id) => enter(id, 'station'),
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
    dispose() {
      if (disposed) return
      disposed = true
      leave()
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
 * E and taps: a landmark's stamp, the metro and the character card, in that order of priority. A tap, not
 * a drag: the pointer barely moved. Taps that start on the joystick, card or HUD buttons never reach the
 * canvas, since those capture their own pointers.
 */
function createInteraction(
  canvas: HTMLCanvasElement,
  stage: Stage,
  controls: Controls,
  district: District,
  npcs: Npcs,
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
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP || e.timeStamp - d.at > TAP_MS) return
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, stage.camera)
    const hit = npcs.pick(ray)
    if (hit) hooks.npcCard.tap(hit, landmarkNear)
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointerup', onUp)
  return {
    update(_dt, pos) {
      const pressed = controls.interact()
      const chatting = hooks.npcCard.isOpen()
      landmarkNear = hooks.track(pos, district.def.landmarks, pressed && !chatting) !== null
      // E by the station opens the metro, unless a landmark's or a character's card has it
      const metro = hooks.trackStation(pos, district.def.station, pressed && !landmarkNear && !chatting)
      hooks.npcCard.step(pos, npcs, pressed && (chatting || !metro), landmarkNear)
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      hooks.npcCard.close()
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

type Presence = DistrictSystem & { reconnect(): void }

/**
 * The district's live socket and the people it brings: their bodies, their labels, and the test hooks that
 * read them. The player's own position goes out every frame (the socket throttles it), and straight after
 * every welcome, since a socket that has not said where it stands hears nobody move.
 */
function createPresence(
  stage: Stage,
  district: District,
  player: Player,
  host: HTMLElement,
  hooks: NonNullable<SessionHooks['presence']>,
  WebSocketImpl?: typeof WebSocket,
): Presence {
  const people = createPeople(stage.scene)
  const labels = createPeopleLabels(host)
  const shadows = (q: QualityTier) => people.setShadows(q === 2)
  shadows(stage.quality)
  const offQuality = stage.onQuality(shadows)
  /** Reused for every frame's move: the socket copies what it sends. */
  const move = { t: 'move', x: 0, z: 0, ry: 0 } satisfies ClientMsg
  const sendMove = (pos: Vec2) => {
    move.x = pos.x
    move.z = pos.z
    move.ry = player.heading()
    conn.send(move)
  }
  const onMsg = (m: ServerMsg) => {
    if (m.t === 'error' && m.code === 'too-fast') return player.teleport(m.x, m.z, m.ry)
    people.apply(m)
    if (m.t === 'welcome') {
      hooks.replaced(false)
      sendMove(player.position())
    }
  }
  const connect = (): LiveConn =>
    connectLive({
      district: district.def.id,
      token: hooks.token,
      onMsg,
      onReplaced: () => hooks.replaced(true),
      WebSocketImpl,
    })
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
      people.update(dt)
      labels.update(stage.camera, people, pos)
    },
    reconnect() {
      conn.close()
      conn = connect()
    },
    dispose() {
      conn.close()
      offQuality()
      labels.dispose()
      people.dispose()
    },
  }
}
