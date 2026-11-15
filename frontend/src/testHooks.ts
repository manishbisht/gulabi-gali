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
  /** Forces a procession whatever the festival (null: the festival's own again); for the perf run. */
  forceProcession(kind: 'gangaur' | 'teej' | null): void
  /** What the renderer drew in the last frame, and what it holds: for the perf run. */
  renderInfo(): { calls: number; triangles: number; geometries: number; textures: number; programs: number }
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
  /** The kite fight: whether one is running, and the levers a test needs to play a short round. */
  patang(): {
    active: boolean
    /** Ties a rival's string across the player's and holds it there (see `Patang.forceCross`). */
    forceCross(): void
    /** Plays the rest of the round out at once. */
    finish(): void
    /**
     * Plays `seconds` of game time at once, in steady 1/30 s steps, with whatever the player holds now: a
     * slow machine's clamped frames cannot stretch a contest past a test's wait.
     */
    step(seconds: number): void
    /** Stops (or restarts) frames moving the round on, so only `step` does: the drawing goes on. */
    pause(on: boolean): void
    score(): number
    rivals(): number
  }
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

/**
 * True on a test page (the e2e build, `?gg-test=1`) unless `gg-full=1` asks for the real thing: the stage
 * then draws a sixteenth of the pixels, without antialiasing. CI's browser has no GPU, and software WebGL at
 * full size draws ~3 frames a second (two pages at once: ~1.4), too few for Playwright's actions to finish in
 * a test's minute. Only the picture is coarser; sizes on the page, hit tests and the frame loop are unchanged.
 * The device perf run passes `gg-full=1`: it measures what a phone pays. Like `installTestHooks`, a production
 * build drops the body.
 */
export function testRenderLite(): boolean {
  if (import.meta.env.VITE_TEST_HOOKS !== '1') return false
  const query = new URLSearchParams(location.search)
  return query.get('gg-test') === '1' && query.get('gg-full') !== '1'
}
