import type { SkyParams } from './live/sky'
import type { CitySnapshot, DistrictId, FestivalId } from './net/protocol'
import type { Vec2 } from './world/types'

/** What Playwright specs can ask of the running city. Grows task by task. */
export interface GgTestApi {
  /** Current render quality tier: 2 full, 1 lower pixel ratio, 0 lowest and no shadows. */
  quality(): 0 | 1 | 2
  /** Frames drawn since the WebGL context was last restored (or since start). */
  framesSinceRestore(): number
  /** Where the player stands, in metres. */
  position(): Vec2
  /** Puts the player at (x, z), skipping collision. */
  teleport(x: number, z: number): void
  /** The district the player is in. */
  district(): DistrictId
  /** The sky as last painted. */
  sky(): SkyParams
  /** The festival in effect (the `gg-festival` override, else the snapshot's). */
  festival(): FestivalId | null
  /** Merges into the city snapshot and repaints the sky now. */
  setSnapshot(partial: Partial<CitySnapshot>): void
  /** Freezes the clock the sky runs on at an ISO instant, and repaints now. */
  setNow(iso: string): void
}

declare global {
  interface Window {
    __gg: GgTestApi
  }
}

/** Merges into `window.__gg`, only on pages opened with `?gg-test=1`. */
export function installTestHooks(api: Partial<GgTestApi>): void {
  if (!location.search.includes('gg-test=1')) return
  window.__gg = { ...window.__gg, ...api }
}
