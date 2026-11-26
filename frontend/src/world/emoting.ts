import * as THREE from 'three'
import { EMOTE_KINDS, EMOTE_PER_MINUTE, type EmoteKind } from '../net/protocol'
import { createEmotes } from './emotes'
import type { People } from './people'
import type { Vec2 } from './types'

/** The mark that pops over the head of whoever plays each emote (and the wheel's buttons wear). */
export const EMOTE_MARKS: Record<EmoteKind, string> = {
  dance: '✨',
  clap: '👏',
  sit: '🧘',
  selfie: '🤳',
  wave: '👋',
}
/** How long each plays, in seconds of play. Sitting lasts until the sitter walks on. */
export const EMOTE_SECONDS: Record<EmoteKind, number> = {
  dance: 4,
  clap: 2.4,
  sit: Infinity,
  selfie: 3,
  wave: 2.4,
}
/** A step this long from where it began ends the player's own emote. */
const STEP_M = 0.05
/**
 * And someone else's, by less: their page says exactly where the emote began as it begins and where they
 * stand as it ends (see `EmotingOptions.send`, `ended`), so their first step off shows as at least `STEP_M`
 * less the server's rounding to a centimetre. Anything past this is that step.
 */
const OTHERS_STEP_M = 0.02
/** Standing: the player moved less than this since the last frame. */
const STILL_M = 1e-4
/**
 * Someone else's emote can arrive ahead of the last steps they took before it (their page sends moves at most
 * ten a second, and the district batches them): for this long after it arrives, a step does not end it.
 */
export const SETTLE_S = 0.5
/** Other people's emotes posed at once; one more takes the place of the one that has played longest. */
const OTHERS = 12
/** The player's own, in the marks' pool: no person's id is empty. */
const SELF = ''
const TURN = 2 * Math.PI

export const isEmoteKind = (kind: unknown): kind is EmoteKind =>
  (EMOTE_KINDS as readonly unknown[]).includes(kind)

/** How an emote holds a body: metres up (or down), and radians turned on, leaning back and swaying aside. */
export interface EmotePose {
  y: number
  spin: number
  lean: number
  sway: number
}

const ease = (t: number, over: number) => {
  const k = Math.min(1, Math.max(0, t / over))
  return k * k * (3 - 2 * k)
}

/**
 * The pose of `kind`, `t` seconds in, written into `out` (nothing is allocated). The figures are one merged
 * mesh with no limbs to lift, so an emote is a mark over the head and the whole body moving: a slow ghoomar
 * turn, a clapping bounce, a lowered seat on the ground, a lean back for the selfie, a sway for the wave.
 * `still` (reduced motion): nothing turns, bounces or sways; only the poses that are held are kept.
 */
export function emotePose(kind: EmoteKind, t: number, still: boolean, out: EmotePose): EmotePose {
  out.y = out.spin = out.lean = out.sway = 0
  switch (kind) {
    case 'dance':
      if (still) break
      // two unhurried turns, the body rising a little on each beat; it ends facing the way it began
      out.spin = TURN * ease(t, EMOTE_SECONDS.dance) * 2
      out.y = 0.06 * Math.abs(Math.sin(Math.PI * 2 * t))
      out.sway = 0.07 * Math.sin(TURN * t)
      break
    case 'clap':
      if (!still) out.y = 0.07 * Math.abs(Math.sin(Math.PI * 2.5 * t))
      break
    case 'sit': {
      // down onto the ground, legs out of sight under it, leaning back a touch
      const k = still ? 1 : ease(t, 0.35)
      out.y = -0.45 * k
      out.lean = -0.08 * k
      break
    }
    case 'selfie': {
      const k = still ? 1 : ease(t, 0.25)
      out.lean = -0.14 * k
      out.sway = 0.09 * k
      break
    }
    case 'wave':
      out.sway = still ? 0.1 : 0.13 * Math.sin(TURN * 1.5 * t)
      break
  }
  return out
}

let listener: ((kind: EmoteKind) => void) | null = null
/**
 * The player just played an emote (seen by others or not): called once, at that moment, from the city session.
 * Plain and DOM-free; whoever wants to know (the day's goal) listens with `onEmoted`.
 */
export function emoted(kind: EmoteKind): void {
  listener?.(kind)
}
/** One listener for `emoted` (the last one set); the answer takes it off again. */
export function onEmoted(cb: (kind: EmoteKind) => void): () => void {
  listener = cb
  return () => {
    if (listener === cb) listener = null
  }
}

/**
 * The page's own count of what the server allows (`EMOTE_PER_MINUTE` in any minute): past it an emote is not
 * sent at all (the player's own still plays), so a fair page never has one dropped. `take` answers whether one
 * may go at `now` (ms), and counts it.
 */
export function createEmoteAllowance(perMinute = EMOTE_PER_MINUTE) {
  const sent = new Float64Array(perMinute).fill(-Infinity)
  let oldest = 0
  return {
    take(now: number): boolean {
      if (now - sent[oldest]! < 60_000) return false
      sent[oldest] = now
      oldest = (oldest + 1) % perMinute
      return true
    },
  }
}

export interface Emoting {
  /**
   * Plays `kind` on the player, here and now, and passes it to `send`. False (and nothing happens: nothing
   * sent, `emoted` not called) when the player cannot emote now (`can`), or is walking: an emote is played
   * standing, since the next step is what ends it for everyone.
   */
  play(kind: EmoteKind): boolean
  /** The district socket's word that `from` plays `kind`: only someone the street lists, and a kind we know. */
  heard(from: unknown, kind: unknown): void
  /** What plays now: the player's own, and other people's. Allocates; for tests. */
  playing(): { self: EmoteKind | null; others: { id: string; kind: EmoteKind }[] }
  update(dt: number, pos: Vec2): void
  dispose(): void
}

export interface EmotingOptions {
  /** Where the marks go (the same host as the name labels). */
  host: HTMLElement
  camera: THREE.Camera
  player: {
    position(): Vec2
    elevation(): number
    setPose(y: number, spin: number, lean: number, sway: number): void
  }
  /** The others on the street; null offline, where only the player's own play. */
  people: Pick<People, 'get'> | null
  /**
   * Whether the player may emote now: on foot, not seated at a bench, at the wheel, in a taxi, a ride or a
   * game. Asked as one begins and every frame one plays: when it turns false, the emote ends.
   */
  can(): boolean
  /**
   * Tells the street (a resident others can see, on an open socket); a ghost's stays here. It must first say
   * exactly where the player stands (a move that does not wait for the socket's throttle), so the others
   * measure the emote's end from the same point this page does.
   */
  send(kind: EmoteKind): void
  /**
   * The player's own emote ended before its time (a step, or `can` turned false): the street must be told
   * where they stand now, at once, since that move is the only word that it ended.
   */
  ended?(): void
  /** Reduced motion, asked as each emote begins. */
  still?(): boolean
}

const prefersStill = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Emotes on the street: the player's own, and those of the people the district socket says are playing one.
 * Each is a mark over the head (the reactions' pooled DOM nodes) and a pose of the whole figure (`emotePose`),
 * until its time is up or its person takes a step: nothing says "stopped", their next move does. A frame costs
 * a few floats per emote and allocates nothing; nothing is added to the scene, so there is nothing to dispose
 * but the marks.
 */
export function createEmoting(opts: EmotingOptions): Emoting {
  const { player, people, camera } = opts
  const marks = createEmotes(opts.host)
  const still = opts.still ?? prefersStill
  const pose: EmotePose = { y: 0, spin: 0, lean: 0, sway: 0 }
  const mine = { kind: null as EmoteKind | null, t: 0, x: 0, z: 0, still: false }
  const others = Array.from({ length: OTHERS }, () => ({
    id: null as string | null,
    kind: 'wave' as EmoteKind,
    t: 0,
    x: 0,
    z: 0,
    still: false,
  }))
  /** Where the player stands this frame, for the mark over their own head. */
  const here = { x: 0, z: 0 }
  /** Whether the last frame moved the player (NaN until the first frame: standing). */
  let walking = false
  let lastX = NaN
  let lastZ = NaN
  const at = (id: string, out: THREE.Vector3) => {
    if (id === SELF) {
      out.set(here.x, player.elevation(), here.z)
      return true
    }
    const r = people?.get(id)
    if (!r || !r.body.visible) return false
    out.copy(r.body.position)
    return true
  }

  function rest() {
    if (mine.kind === null) return
    mine.kind = null
    player.setPose(0, 0, 0, 0)
    marks.drop(SELF)
  }

  function release(slot: (typeof others)[number]) {
    if (slot.id === null) return
    // their figure stands straight again (people.update puts its feet back on the ground every frame)
    people?.get(slot.id)?.avatar.rotation.set(0, 0, 0)
    marks.drop(slot.id)
    slot.id = null
  }

  return {
    play(kind) {
      if (walking || !opts.can()) return false
      const pos = player.position()
      mine.kind = kind
      mine.t = 0
      mine.x = pos.x
      mine.z = pos.z
      mine.still = still()
      here.x = pos.x
      here.z = pos.z
      marks.mark(SELF, EMOTE_MARKS[kind])
      opts.send(kind)
      emoted(kind)
      return true
    },
    heard(from, kind) {
      if (typeof from !== 'string' || !isEmoteKind(kind)) return
      const r = people?.get(from)
      // nobody the street lists (a block, a ghost, the player themself), or someone at a wheel: not drawn
      if (!r || r.person.v === 'auto') return
      let slot = others.find((s) => s.id === from) ?? others.find((s) => s.id === null)
      if (!slot) {
        slot = others.reduce((a, b) => (b.t > a.t ? b : a))
        release(slot)
      }
      slot.id = from
      slot.kind = kind
      slot.t = 0
      slot.x = r.person.x
      slot.z = r.person.z
      slot.still = still()
      marks.mark(from, EMOTE_MARKS[kind])
    },
    playing: () => ({
      self: mine.kind,
      others: others.filter((s) => s.id !== null).map((s) => ({ id: s.id!, kind: s.kind })),
    }),
    update(dt, pos) {
      here.x = pos.x
      here.z = pos.z
      walking = Math.abs(pos.x - lastX) > STILL_M || Math.abs(pos.z - lastZ) > STILL_M
      lastX = pos.x
      lastZ = pos.z
      if (mine.kind !== null) {
        mine.t += dt
        if (!opts.can() || Math.abs(pos.x - mine.x) > STEP_M || Math.abs(pos.z - mine.z) > STEP_M) {
          rest()
          opts.ended?.()
        } else if (mine.t >= EMOTE_SECONDS[mine.kind]) rest()
        else {
          emotePose(mine.kind, mine.t, mine.still, pose)
          player.setPose(pose.y, pose.spin, pose.lean, pose.sway)
        }
      }
      for (let i = 0; i < OTHERS; i++) {
        const slot = others[i]!
        if (slot.id === null) continue
        const r = people?.get(slot.id)
        if (!r) {
          // off the street (left, blocked, the socket gone): their body went with them
          marks.drop(slot.id)
          slot.id = null
          continue
        }
        slot.t += dt
        const { x, z, v } = r.person
        if (slot.t < SETTLE_S) {
          slot.x = x
          slot.z = z
        }
        if (
          v === 'auto' ||
          Math.abs(x - slot.x) > OTHERS_STEP_M ||
          Math.abs(z - slot.z) > OTHERS_STEP_M ||
          slot.t >= EMOTE_SECONDS[slot.kind]
        ) {
          release(slot)
          continue
        }
        emotePose(slot.kind, slot.t, slot.still, pose)
        const { rotation, position } = r.avatar
        rotation.order = 'YXZ'
        rotation.set(pose.lean, pose.spin, pose.sway)
        position.y += pose.y
      }
      marks.update(dt, camera, at)
    },
    dispose() {
      rest()
      for (const slot of others) release(slot)
      marks.dispose()
    },
  }
}
