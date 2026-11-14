import type { SkyParams } from './live/sky'
import type { LiveState } from './net/live'
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
  /** The Gangaur or Teej procession on the street: how many women and drummers walk in it (0 for none). */
  procession(): { count: number }
  /** The festival in effect (the `gg-festival` override, else the snapshot's). */
  festival(): FestivalId | null
  /** Each character on screen: where it stands (metres) and where its chest is on the page (CSS px). */
  npcs(): { id: string; x: number; z: number; sx: number; sy: number }[]
  /** Merges into the city snapshot and repaints the sky now. */
  setSnapshot(partial: Partial<CitySnapshot>): void
  /** Freezes the clock the sky runs on at an ISO instant, and repaints now. */
  setNow(iso: string): void
  /** Pauses (or resumes) every walking character, so a test can aim at one that stands still. */
  freezeNpcs(on: boolean): void
  /** Each street animal: where it stands (metres), whether it follows, and where it is on the page (CSS px). */
  animals(): { id: string; kind: string; x: number; z: number; following: boolean; sx: number; sy: number }[]
  /** Stops (or resumes) every animal wandering; a follower still follows. */
  freezeAnimals(on: boolean): void
  /** The district socket: `connecting` (also while waiting to retry), `open`, or `closed` for good. */
  liveState(): LiveState
  /** Each other person in the district: where their body is drawn (metres) and their chest on the page (CSS px). */
  people(): { id: string; x: number; z: number; sx: number; sy: number }[]
  /** Every poster up on this district's walls, and where its middle is on the page (CSS px). */
  posters(): { id: string; wall: number; slot: number; text: string; sx: number; sy: number }[]
}

declare global {
  interface Window {
    __gg: GgTestApi
  }
}

/**
 * Merges into `window.__gg`, only in a build made with `VITE_TEST_HOOKS=1` (the e2e build) and on pages
 * opened with `?gg-test=1`. The build flag is checked statically, so a production build drops this body
 * and the `__gg` name with it (scripts/check-no-test-hooks.mjs fails CI if one ever slips back in).
 */
export function installTestHooks(api: Partial<GgTestApi>): void {
  if (import.meta.env.VITE_TEST_HOOKS !== '1') return
  if (new URLSearchParams(location.search).get('gg-test') !== '1') return
  window.__gg = { ...window.__gg, ...api }
}
