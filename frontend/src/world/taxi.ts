import type { ClientMsg, DistrictId } from '../net/protocol'
import type { Pilot, Pose } from '../player/player'
import { MOUNT_RANGE } from './driving'
import type { ParkedAutos } from './props'
import type { Player } from './session'
import LINE from './taxi.json'
import type { DistrictDef, Vec2 } from './types'

/**
 * The auto-taxi, by district: where its parked autos stand, and per landmark the point beside it where a ride
 * stops, with the way the auto faces there. The server's copy (backend/src/taxi.json) decides where a rider
 * lands; scripts/check-protocol.mjs keeps the two equal, and taxi.test.ts checks them against the districts.
 */
export const TAXI: Record<DistrictId, { stands: Vec2[]; drops: Record<string, Pose> }> = LINE

/** "Le chalo" shows this close to a parked auto, as "Auto chalao" does; the server allows 3 m. */
export const TAXI_RANGE = MOUNT_RANGE
/** A parked auto is at its stand within this of it: one driven off and left elsewhere is no taxi. */
const AT_STAND_M = 0.5
/** The ride's run up: this far, straight along the way the auto faces at the drop point. */
export const APPROACH_M = 20
/** Getting in, and getting out: the screen goes dark this long each time (the `.fade` transition). */
export const TAXI_FADE_MS = 300
/** The drive up to the landmark, between the two. */
export const TAXI_DRIVE_MS = 2800
/** Start to finish: getting in, the drive, getting out. */
export const TAXI_RIDE_MS = TAXI_FADE_MS + TAXI_DRIVE_MS + TAXI_FADE_MS
/** With reduced motion there is no drive: a cut, through black held this long. */
export const TAXI_CUT_MS = 250

/** What the taxi tells React. Each is called only when its news changes. */
export interface TaxiHooks {
  /** A parked auto at its stand is in reach (never at the wheel or during a ride). */
  near(on: boolean): void
  /** A ride began, or ended with the player on foot. */
  riding(on: boolean): void
  /** The screen goes dark (getting in or out), or comes back. */
  dark(on: boolean): void
  /** The server would not give the ride: the player is back by the stand (or soon will be). */
  refused(): void
}

export interface Taxi {
  update(dt: number, pos: Vec2): void
  near(): boolean
  riding(): boolean
  /** Rides to landmark `to` of this district from the auto in reach. False (and nothing happens) when it may not. */
  go(to: string): boolean
  /** Cuts the ride short: on foot beside the landmark at once. */
  skip(): void
  /** The server's `no-ride`: a ride under way ends where it began. */
  refused(): void
  dispose(): void
}

/** "Le chalo" may be offered: an auto at its stand in reach, on foot, with nothing else holding the screen. */
export function taxiAvailable(s: {
  near: boolean
  seated: boolean
  driving: boolean
  /** A card, sheet or landmark is up. */
  card: boolean
  /** The kite fight. */
  kite: boolean
  /** A metro ride (or its fade). */
  metro: boolean
  /** Up on a rooftop viewpoint. */
  roof?: boolean
}): boolean {
  return s.near && !s.seated && !s.driving && !s.card && !s.kite && !s.metro && !s.roof
}

/**
 * The auto-taxi ("Le chalo"): from a parked auto at its stand to a landmark of the district. The player gets in
 * (the screen goes dark), rides the last `APPROACH_M` up to the landmark with the view behind the auto, and gets
 * out beside it, on foot (dark again), while the auto goes back to its stand. With reduced motion it is a cut.
 * `send` tells the server, which checks the ride and sets the player down at the same drop point, so the next
 * step there is a walk on from it; meanwhile the presence sends no moves (see `riding`).
 */
export function createTaxi(opts: {
  def: DistrictDef
  autos: ParkedAutos
  player: Pick<Player, 'position' | 'driving' | 'mount' | 'dismount' | 'exitPoint' | 'teleport' | 'autopilot'>
  /** The live socket's; absent offline. */
  send?: (m: ClientMsg) => void
  /** Something else holds the player (seated, a card is up): no ride now. */
  blocked?: () => boolean
  hooks: TaxiHooks
  now?: () => number
  reducedMotion?: () => boolean
}): Taxi {
  const { autos, player, hooks } = opts
  const line = TAXI[opts.def.id]
  const now = opts.now ?? (() => performance.now())
  // asked once; `.matches` follows the setting as it changes
  const query =
    typeof matchMedia === 'function' && !opts.reducedMotion
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
  const still = opts.reducedMotion ?? (() => query?.matches ?? false)
  /** The parked auto in reach that stands at its stand, or -1. */
  let near = -1
  let trip: {
    auto: number
    home: Pose
    drop: Pose
    start: number
    cut: boolean
    /** The drive has the wheel. */
    driving: boolean
    dark: boolean
  } | null = null

  const setNear = (i: number) => {
    if (i >= 0 !== near >= 0) hooks.near(i >= 0)
    near = i
  }
  const atStand = (i: number) => {
    const p = autos.pose(i)
    return line.stands.some((s) => Math.hypot(s.x - p.x, s.z - p.z) <= AT_STAND_M)
  }
  const shade = (on: boolean) => {
    if (!trip || trip.dark === on) return
    trip.dark = on
    hooks.dark(on)
  }

  /** The run up: from `APPROACH_M` back to the drop point, slowing to a stop. */
  const pilot: Pilot = (_dt, to) => {
    if (!trip) return
    const u = Math.min(1, Math.max(0, (now() - trip.start - TAXI_FADE_MS) / TAXI_DRIVE_MS))
    const back = APPROACH_M * (1 - u) * (1 - u)
    const { x, z, ry } = trip.drop
    to.x = x - Math.sin(ry) * back
    to.z = z - Math.cos(ry) * back
    to.ry = ry
  }

  /** Out of the auto, beside where it stops at `at` (the drop, or back at the stand), and the auto goes home. */
  function end(at: 'drop' | 'home') {
    const t = trip!
    trip = null
    player.autopilot(null)
    const spot = t[at]
    player.teleport(spot.x, spot.z, spot.ry) // at the wheel: the auto is put there
    player.dismount(player.exitPoint() ?? spot)
    autos.leave(t.auto, t.home.x, t.home.z, t.home.ry)
    if (t.dark) hooks.dark(false)
    hooks.riding(false)
  }

  return {
    update(_dt, pos) {
      const t = trip
      if (!t) {
        const i = player.driving() ? -1 : autos.nearest(pos, TAXI_RANGE)
        return setNear(i >= 0 && atStand(i) ? i : -1)
      }
      const since = now() - t.start
      if (t.cut) {
        if (since >= TAXI_CUT_MS) end('drop')
        return
      }
      if (!t.driving && since >= TAXI_FADE_MS) {
        t.driving = true
        player.autopilot(pilot)
        shade(false)
      }
      if (since >= TAXI_FADE_MS + TAXI_DRIVE_MS) shade(true)
      if (since >= TAXI_RIDE_MS) end('drop')
    },
    near: () => near >= 0,
    riding: () => trip !== null,
    go(to) {
      const drop = Object.hasOwn(line.drops, to) ? line.drops[to] : undefined
      if (trip || near < 0 || !drop || player.driving() || opts.blocked?.()) return false
      const from = player.position()
      const auto = near
      const home = { ...autos.pose(auto) }
      setNear(-1)
      autos.take(auto)
      player.mount(home.x, home.z, home.ry)
      opts.send?.({ t: 'ride', to, x: from.x, z: from.z })
      trip = { auto, home, drop, start: now(), cut: still(), driving: false, dark: false }
      hooks.riding(true)
      shade(true)
      return true
    },
    skip() {
      if (trip) end('drop')
    },
    refused() {
      hooks.refused()
      if (trip) end('home')
    },
    dispose() {
      // the district goes with its autos and its player: only React needs telling
      if (trip) {
        player.autopilot(null)
        if (trip.dark) hooks.dark(false)
        trip = null
        hooks.riding(false)
      }
      setNear(-1)
    },
  }
}
