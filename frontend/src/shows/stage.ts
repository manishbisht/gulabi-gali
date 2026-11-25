import type * as THREE from 'three'
import { setShowDuck } from '../audio/ambience'
import {
  CLAP_AFTER_S,
  NEAR_M,
  SHOW_S,
  showColliders,
  showFront,
  showOn,
  showsOf,
  showWatched,
  STAY_M,
} from '../world/shows'
import type { AABB, DistrictDef, ShowKind, ShowSpec, Vec2 } from '../world/types'
import { createShowRig, showMaterial, type ShowRig, type Tier } from './figures'
import { createShowMusic, type ShowMusic } from './music'

/*
 * A district's street shows, performing. Each holds its idle pose (nothing is written, nothing moves) until the
 * player walks within `NEAR_M`; then it plays for `SHOW_S` seconds with its tune, and after that keeps a small
 * looping idle while the player stays. Walking further than `STAY_M` ends it, and the next approach starts it
 * again. One show at a time. Client-only: nothing is sent.
 *
 * Cost: a far show is one distance check a frame and no draw (its group is hidden past `FAR_M`); an idle one in
 * view is its three or four draw calls and no updates. Only the one playing writes instance matrices. Under
 * `prefers-reduced-motion` the figures hold their pose and only the music plays (a clap is answered by a bow
 * held for a moment, not an animated one).
 */

/** A show further off than this is not drawn at all. */
const FAR_M = 90
/** The tune is at its loudest within this many metres, and would be silent at `QUIET_M`. */
const LOUD_M = 5
const QUIET_M = 20
/** How long the performers' bow to a clap takes. */
const BOW_S = 1.4
/** How much the figures move in the lull after the show, as a share of the performance. */
const LULL = 0.22
/** Whether the evening's show is out is looked at this often (seconds of game time). */
const CHECK_S = 5

export type ShowPhase = 'idle' | 'playing' | 'after' | 'settling'

export interface ShowHooks {
  /** The player came near and `kind` began. */
  began(kind: ShowKind): void
  /** "Taali bajao" is offered for `kind` (while it plays and for a little after), or for nothing. */
  clap(kind: ShowKind | null): void
  /** The player walked away from `kind`, or it left the street. */
  left(kind: ShowKind): void
}

export interface ShowsDeps {
  /** What the figures are added to: the district's root, so they can never outlive it. */
  scene: THREE.Object3D
  def: DistrictDef
  /** The district's colliders: a show adds what nobody walks through, and takes it back when it goes. */
  colliders: AABB[]
  /** Read every frame: a step down swaps the figures for thinner ones (no listener to leave behind). */
  quality(): Tier
  /** The clock and today's sunset the evening's show keeps (the live city's, which a test can freeze). */
  now(): Date
  sunset(): string
  hooks: ShowHooks
  /** Tests hand in a stand-in; by default the tunes play on the page's audio context. */
  music?: ShowMusic
  /** Told when a tune is within earshot; by default the ambience steps back (`setShowDuck`). */
  duck?(on: boolean): void
  /** Defaults to the browser's `prefers-reduced-motion`. */
  reducedMotion?(): boolean
}

export interface Shows {
  update(dt: number, pos: Vec2): void
  /** The player claps: a clap sound and a bow, while a show is on or just over. False when there is none. */
  clap(): boolean
  /** For the test hooks: each show, whether it is out, and what it is doing. */
  list(): { kind: ShowKind; x: number; z: number; out: boolean; phase: ShowPhase; calls: number }[]
  /** For the test hooks: moves the show now playing on by `seconds`. */
  skip(seconds: number): void
  dispose(): void
}

interface Entry {
  spec: ShowSpec
  /** The way its group is turned (radians about y). */
  ry: number
  /** Its figures, while it is out on the street. */
  rig: ShowRig | null
  boxes: AABB[]
  phase: ShowPhase
  /** Seconds into the performance, and into the lull after it. */
  elapsed: number
  after: number
  energy: number
  /** Seconds of bow left. */
  bow: number
  /** Under reduced motion: the bow the held pose shows now (0 or 1). */
  held: number
  offered: boolean
}

export function createShows(deps: ShowsDeps): Shows {
  const { scene, def, colliders, hooks } = deps
  const music = deps.music ?? createShowMusic()
  const duck = deps.duck ?? setShowDuck
  const query =
    typeof matchMedia === 'function' && !deps.reducedMotion
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
  const still = deps.reducedMotion ?? (() => query?.matches ?? false)
  const material = showMaterial()
  let tier = deps.quality()
  let ducked = false
  const setDuck = (on: boolean) => {
    if (on === ducked) return
    ducked = on
    duck(on)
  }

  const entries: Entry[] = showsOf(def).map((spec) => {
    const f = showFront(spec)
    return {
      spec,
      ry: Math.atan2(f.x, f.z),
      rig: null,
      boxes: [],
      phase: 'idle',
      elapsed: 0,
      after: 0,
      energy: 0,
      bow: 0,
      held: 0,
      offered: false,
    }
  })
  /** The show that is not idle, if any. */
  let active: Entry | null = null

  function build(e: Entry) {
    const rig = createShowRig(e.spec.kind, tier, material)
    rig.group.position.set(e.spec.at.x, 0, e.spec.at.z)
    rig.group.rotation.y = e.ry
    scene.add(rig.group)
    e.rig = rig
  }
  function bring(e: Entry) {
    build(e)
    e.boxes = showColliders(e.spec)
    colliders.push(...e.boxes)
  }
  function send(e: Entry) {
    e.rig?.dispose()
    e.rig = null
    for (const box of e.boxes) {
      const i = colliders.indexOf(box)
      if (i >= 0) colliders.splice(i, 1)
    }
    e.boxes = []
  }

  /** Brings out or sends home the shows that keep hours. One on which the player's eyes are stays until they go. */
  function keepHours() {
    const now = deps.now()
    const sunset = deps.sunset()
    for (const e of entries) {
      const on = showOn(e.spec.kind, now, sunset)
      if (on && !e.rig) bring(e)
      else if (!on && e.rig && e.phase === 'idle') send(e)
    }
  }
  keepHours()

  /** Thinner figures for a slower phone: the same show carries on with them. */
  function retier(q: Tier) {
    tier = q
    for (const e of entries) {
      if (!e.rig) continue
      e.rig.dispose()
      build(e)
      e.held = 0
    }
  }

  function offer(e: Entry, on: boolean) {
    if (e.offered === on) return
    e.offered = on
    hooks.clap(on ? e.spec.kind : null)
  }

  function begin(e: Entry) {
    active = e
    e.phase = 'playing'
    e.elapsed = 0
    e.after = 0
    music.start(e.spec.kind)
    hooks.began(e.spec.kind)
    offer(e, true)
  }

  function walkedOff(e: Entry) {
    if (e.phase === 'playing') music.stop()
    setDuck(false)
    e.phase = 'settling'
    e.bow = 0
    offer(e, false)
    hooks.left(e.spec.kind)
  }

  let clock = 0
  let nextCheck = CHECK_S

  return {
    update(dt, pos) {
      const q = deps.quality()
      if (q !== tier) retier(q)
      clock += dt
      if (clock >= nextCheck) {
        nextCheck = clock + CHECK_S
        keepHours()
      }
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!
        const rig = e.rig
        if (!rig) continue
        const dx = pos.x - e.spec.at.x
        const dz = pos.z - e.spec.at.z
        const d = Math.hypot(dx, dz)
        const shown = d <= FAR_M
        if (rig.group.visible !== shown) rig.group.visible = shown
        if (e.phase === 'idle') {
          if (d > NEAR_M || active) continue
          begin(e)
        }
        if (d > STAY_M && e.phase !== 'settling') walkedOff(e)

        let want = 0
        if (e.phase === 'playing') {
          want = 1
          e.elapsed += dt
          const loud = Math.min(1, Math.max(0, (QUIET_M - d) / (QUIET_M - LOUD_M)))
          setDuck(music.update(e.elapsed, loud))
          if (e.elapsed >= SHOW_S[e.spec.kind]) {
            e.phase = 'after'
            music.stop()
            setDuck(false)
            // the player stayed from the first note to the last: walking off would have ended it
            showWatched(e.spec.kind)
          }
        } else if (e.phase === 'after') {
          want = LULL
          e.after += dt
          if (e.after >= CLAP_AFTER_S) offer(e, false)
        }
        e.energy += (want - e.energy) * Math.min(1, dt * 3)
        if (e.bow > 0) e.bow = Math.max(0, e.bow - dt)
        const face = Math.atan2(dx, dz) - e.ry

        if (still()) {
          // a held pose with the music; a clap is answered by a bow held for its moment
          const bowed = e.bow > 0 ? 1 : 0
          if (bowed !== e.held) {
            e.held = bowed
            rig.step(0, 0, bowed, face)
          }
        } else {
          rig.step(dt, e.energy, Math.sin((1 - e.bow / BOW_S) * Math.PI), face)
        }

        if (e.phase === 'settling' && e.energy < 0.02 && e.bow === 0) {
          // back to an idle pose: from here nothing is written until the player comes near again
          e.energy = 0
          if (!still()) rig.step(0, 0, 0, face)
          e.phase = 'idle'
          active = null
        }
      }
    },
    clap() {
      const e = active
      if (!e?.rig || !e.offered) return false
      music.clap()
      e.bow = BOW_S
      return true
    },
    list: () =>
      entries.map((e) => ({
        kind: e.spec.kind,
        x: e.spec.at.x,
        z: e.spec.at.z,
        out: e.rig !== null,
        phase: e.phase,
        calls: e.rig?.calls ?? 0,
      })),
    skip(seconds) {
      if (active?.phase === 'playing') active.elapsed += seconds
    },
    dispose() {
      if (active) offer(active, false)
      active = null
      music.stop()
      music.dispose()
      setDuck(false)
      for (const e of entries) send(e)
      material.dispose()
    },
  }
}
