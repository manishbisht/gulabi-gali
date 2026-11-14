import { honk, unlockAudio } from '../audio/horn'
import type { Player } from './session'
import type { ParkedAutos } from './props'
import type { Vec2 } from './types'

/** "Auto chalao" shows, and E mounts, this close to a parked auto. */
export const MOUNT_RANGE = 2.5

/** What the driving system tells React. Each is called only when its news changes. */
export interface DriveHooks {
  /** A parked auto is in reach (never while driving). */
  near(on: boolean): void
  /** The player got into an auto, or got out of it. */
  driving(on: boolean): void
  /** E or the exit button, with no clear place to get out: the player stays in the auto. */
  blocked(): void
}

export interface Driving {
  /** Every frame: which parked auto is in reach. */
  update(pos: Vec2): void
  near(): boolean
  driving(): boolean
  /** Mounts the auto in reach, standing up from a bench first. */
  mount(): void
  /** Gets out at the nearest clear spot round the auto, or (nowhere clear) stays in and says so. */
  exit(): void
  /** Space or the horn button; only while driving. */
  honk(): void
  dispose(): void
}

/**
 * Driving a parked auto: walk up, mount, drive with the stick (or WASD), honk, get out. Everything is this
 * client's: the parked auto hides here and reappears where it was left, and the others only learn of it
 * through the `v` flag the presence sends under the driver (see `createPresence`).
 */
export function createDriving(opts: {
  autos: ParkedAutos
  player: Pick<Player, 'position' | 'driving' | 'mount' | 'dismount' | 'ridePose' | 'exitPoint'>
  /** Stands the player up from a bench, if they are seated. */
  stand?: () => void
  hooks: DriveHooks
}): Driving {
  const { autos, player, hooks } = opts
  /** The parked auto in reach, and the one being driven (the same index, once mounted). */
  let near = -1
  let mounted = -1

  const setNear = (i: number) => {
    if (i >= 0 !== near >= 0) hooks.near(i >= 0)
    near = i
  }

  return {
    update(pos) {
      setNear(mounted >= 0 ? -1 : autos.nearest(pos, MOUNT_RANGE))
    },
    near: () => near >= 0,
    driving: () => mounted >= 0,
    mount() {
      if (near < 0 || mounted >= 0) return
      unlockAudio() // from a tap or a key: the horn may need this gesture
      opts.stand?.()
      const i = near
      const { x, z, ry } = autos.pose(i)
      autos.take(i)
      mounted = i
      setNear(-1)
      player.mount(x, z, ry)
      hooks.driving(true)
    },
    exit() {
      if (mounted < 0) return
      const out = player.exitPoint()
      if (!out) return hooks.blocked()
      const { x, z, ry } = player.ridePose()
      autos.leave(mounted, x, z, ry)
      mounted = -1
      player.dismount(out)
      hooks.driving(false)
    },
    honk() {
      if (mounted >= 0) honk()
    },
    dispose() {
      // The district is going away with its autos and its player: only React needs telling.
      if (mounted >= 0) hooks.driving(false)
      if (near >= 0) hooks.near(false)
      near = mounted = -1
    },
  }
}
