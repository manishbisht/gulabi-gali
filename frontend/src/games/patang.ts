import { storage } from '../storage'
import type { FestivalId } from '../net/protocol'

/** One round, in seconds. */
export const ROUND_S = 60
/** Strings crossed for this long, with someone pulling, and the contest is decided. */
export const CONTEST_S = 0.6
/** A cut rival is gone this long before another flies in. */
export const RESPAWN_S = 3
/** The sky the kites fly in: x in [-X_RANGE, X_RANGE], y in [0, Y_MAX]; every string is tied off at y = 0. */
export const X_RANGE = 10
export const Y_MAX = 20
/** A longest slice the world is stepped in, so a long frame is the same game as several short ones. */
const SLICE = 1 / 30
/** A stalled frame (a tab coming back) counts for no more than this. */
const MAX_DT = 0.25
const STEER_SPEED = 9
/** Pulling is hard work: steering slows to this fraction of its speed. */
const PULL_DRAG = 0.5
/**
 * Nobody can pull for ever. Pulling drains a bucket (2 s of it, 1 per second); letting go refills it slowly,
 * and a bucket run dry cannot pull again until it holds `PULL_RESUME`, so letting go for a frame does not
 * dodge the tiring.
 */
const STAMINA_MAX = 2
const STAMINA_REFILL = 0.6
const PULL_RESUME = 0.3
const PLAYER_Y = 13
const RIVAL_SPEED = 3.5
const RIVAL_RISE = 2.5
const BEST_KEY = 'gg-patang-best'

export type Tier = 0 | 1 | 2

/** Six rivals at the top two tiers, three on the lowest (fewer kites to draw). */
export const rivalCount = (quality: Tier): number => (quality === 0 ? 3 : 6)

/** The "Patang udao" button: Sankranti only, on foot, with no card or sheet over the street. */
export function patangAvailable(s: {
  festival: FestivalId | null
  driving: boolean
  seated: boolean
  card: boolean
}): boolean {
  return s.festival === 'sankranti' && !s.driving && !s.seated && !s.card
}

/** The most cuts in one round, kept under `gg-patang-best`; junk in storage reads as no best. */
export function loadBest(): number {
  const n = Number(storage.get(BEST_KEY))
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** Records a round's cuts; returns the best now (a worse round leaves it as it was). */
export function saveBest(score: number): number {
  const best = Math.max(loadBest(), score)
  if (best > 0) storage.set(BEST_KEY, String(best))
  return best
}

/**
 * Who wins a contest of crossed strings. Whoever is pulling cuts the other; with both pulling, whoever has
 * been pulling longer; neither pulling is nobody. A dead heat goes to the player.
 */
export function contestWinner(
  playerPulling: boolean,
  playerFor: number,
  rivalPulling: boolean,
  rivalFor: number,
): 'player' | 'rival' | null {
  if (playerPulling && rivalPulling) return rivalFor > playerFor ? 'rival' : 'player'
  if (playerPulling) return 'player'
  return rivalPulling ? 'rival' : null
}

/** Whether the segment a-b crosses c-d (a proper crossing; touching ends do not count). */
export function stringsCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (qx - px) * (ry - py) - (qy - py) * (rx - px)
  const d1 = side(ax, ay, bx, by, cx, cy)
  const d2 = side(ax, ay, bx, by, dx, dy)
  const d3 = side(cx, cy, dx, dy, ax, ay)
  const d4 = side(cx, cy, dx, dy, bx, by)
  return d1 * d2 < 0 && d3 * d4 < 0
}

export interface PatangKite {
  x: number
  y: number
  /** Where its string is tied off along the bottom of the sky. */
  anchorX: number
  /** Lean, in radians (steering, or the wind for a kite that has been cut). */
  tilt: number
  pulling: boolean
  /** False for a rival that has been cut and is drifting off. */
  alive: boolean
  /** How long the current pull has lasted. */
  pullTime: number
  /** What is left in the pulling bucket, and whether it ran dry and is still refilling to `PULL_RESUME`. */
  stamina: number
  locked: boolean
}

interface Rival extends PatangKite {
  /** How long its string has been crossed with the player's. */
  cross: number
  tx: number
  ty: number
  think: number
  /** How much longer it means to pull, and how long before it may begin. */
  pullFor: number
  pullDelay: number
  /** Pinned in place (a test's forced crossing). */
  hold: number
  /** Counts down to a new rival, once cut. */
  respawn: number
  drift: number
}

export interface PatangState {
  /** Seconds left in the round. */
  timeLeft: number
  /** Cuts so far. */
  score: number
  /** The round is over: time ran out, or the player's string was cut. */
  over: boolean
  cutByRival: boolean
  /** Goes up by one at every cut the player makes ("Wo kaata!"). */
  cutSeq: number
  /** The player's string is crossed with a rival's now. */
  crossing: boolean
  player: PatangKite
  rivals: readonly PatangKite[]
}

export interface PatangInput {
  /** The pull button, or Space, is held. */
  pull: boolean
  /** -1 (left) to 1 (right). */
  steer: number
}

export interface Patang {
  /** The same object every call, updated in place: a frame allocates nothing. */
  readonly state: PatangState
  update(input: PatangInput, dt: number): PatangState
  /**
   * For tests: ties the nearest live rival's string across the player's and holds it there. `rivalPulls`
   * makes it pull (after `rivalDelay` seconds), otherwise it keeps its hands to itself. For as long as it is
   * held, the other rivals let go and think of nothing new, so no stray pull can decide the round.
   */
  forceCross(rivalPulls?: boolean, rivalDelay?: number): void
  dispose(): void
}

/** Small, seedable and fast (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const toward = (v: number, goal: number, step: number) =>
  v < goal ? Math.min(goal, v + step) : Math.max(goal, v - step)

/**
 * The kite fight (`opts.rivals` overrides the tier's count, for tests): a pure, seeded simulation, 60 s a round. Stepped in equal slices of at most 1/30 s, so a
 * phone at 20 fps and a laptop at 144 play the same game. Rendering lives elsewhere.
 */
export function createPatang(seed: number, quality: Tier, opts: { rivals?: number } = {}): Patang {
  const rand = rng(seed)
  const n = opts.rivals ?? rivalCount(quality)
  let time = 0
  let disposed = false
  const player: PatangKite = {
    x: 0,
    y: PLAYER_Y,
    anchorX: 0,
    tilt: 0,
    pulling: false,
    alive: true,
    pullTime: 0,
    stamina: STAMINA_MAX,
    locked: false,
  }
  const rivals: Rival[] = []
  const spawn = (r: Rival, at: 'edge' | 'sky') => {
    r.x = at === 'edge' ? (rand() < 0.5 ? -1 : 1) * X_RANGE : (rand() * 2 - 1) * X_RANGE
    r.y = 11 + rand() * 8
    r.anchorX = (rand() * 2 - 1) * X_RANGE * 1.2
    r.tilt = 0
    r.pulling = false
    r.alive = true
    r.pullTime = 0
    r.cross = 0
    r.tx = r.x
    r.ty = r.y
    r.think = 0.3 + rand() * 1.5
    r.pullFor = 0
    r.pullDelay = 0
    r.stamina = STAMINA_MAX
    r.locked = false
    r.hold = 0
    r.respawn = 0
  }
  for (let i = 0; i < n; i++) {
    const r = { drift: 0 } as Rival
    spawn(r, 'sky')
    // spread the anchors along the bottom so the strings fan out rather than bunch
    r.anchorX = (((i + 0.5) / n) * 2 - 1) * X_RANGE * 1.2
    rivals.push(r)
  }
  const state: PatangState = {
    timeLeft: ROUND_S,
    score: 0,
    over: false,
    cutByRival: false,
    cutSeq: 0,
    crossing: false,
    player,
    rivals,
  }

  /** Both arms tire: whether this kite may pull now, draining or refilling its bucket. */
  function canPull(k: PatangKite, wants: boolean, h: number): boolean {
    if (wants && !k.locked) {
      k.pullTime += h
      k.stamina -= h
      if (k.stamina > 0) return true
      k.stamina = 0
      k.locked = true
    }
    k.pullTime = 0
    k.stamina = Math.min(STAMINA_MAX, k.stamina + STAMINA_REFILL * h)
    if (k.locked && k.stamina >= PULL_RESUME) k.locked = false
    return false
  }

  function slice(input: PatangInput, h: number) {
    time += h
    state.timeLeft = Math.max(0, ROUND_S - time)
    // the player
    player.pulling = canPull(player, input.pull, h)
    const steer = clamp(input.steer, -1, 1)
    player.x = clamp(player.x + steer * STEER_SPEED * (player.pulling ? PULL_DRAG : 1) * h, -X_RANGE, X_RANGE)
    player.y = PLAYER_Y + Math.sin(time * 1.3) * 0.6
    player.tilt = -steer * 0.35

    let crossing = false
    for (let i = 0; i < n; i++) {
      const r = rivals[i]!
      if (!r.alive) {
        // cut: it drifts off on the wind, and a new kite flies in after a while
        r.x += r.drift * h
        r.y += 1.5 * h
        r.tilt = r.drift * 0.15
        r.respawn -= h
        if (r.respawn <= 0) spawn(r, 'edge')
        continue
      }
      // the rival's own mind
      if (r.hold > 0) {
        r.hold -= h
        r.pullDelay -= h
      } else {
        r.think -= h
        if (r.think <= 0) {
          r.think = 1 + rand() * 2
          if (rand() < 0.3) {
            // a dive, at the player's string
            r.tx = clamp(player.x + (rand() - 0.5) * 6, -X_RANGE, X_RANGE)
            r.ty = 4 + rand() * 4
          } else {
            r.tx = (rand() * 2 - 1) * X_RANGE * 0.9
            r.ty = 10 + rand() * 8
          }
          if (rand() < 0.45) r.pullFor = 0.8 + rand() * 1.4
        }
        const before = r.x
        r.x = toward(r.x, r.tx, RIVAL_SPEED * h)
        r.y = toward(r.y, r.ty, RIVAL_RISE * h)
        r.tilt = h > 0 ? clamp(-(r.x - before) / h / RIVAL_SPEED, -1, 1) * 0.35 : 0
        r.pullDelay = 0
      }
      const wants = r.pullDelay <= 0 && r.pullFor > 0
      r.pulling = canPull(r, wants, h)
      if (wants && r.hold <= 0) r.pullFor -= h

      // do the two strings cross?
      if (stringsCross(player.anchorX, 0, player.x, player.y, r.anchorX, 0, r.x, r.y)) {
        crossing = true
        r.cross += h
      } else r.cross = 0
      if (r.cross < CONTEST_S) continue
      const won = contestWinner(player.pulling, player.pullTime, r.pulling, r.pullTime)
      if (won === 'player') {
        r.alive = false
        r.pulling = false
        r.cross = 0
        r.hold = 0
        r.drift = (r.x >= player.x ? 1 : -1) * (2 + rand() * 2)
        r.respawn = RESPAWN_S
        state.score++
        state.cutSeq++
      } else if (won === 'rival') {
        state.over = true
        state.cutByRival = true
        break
      }
    }
    state.crossing = crossing
    if (state.timeLeft === 0) state.over = true
  }

  return {
    state,
    update(input, dt) {
      if (disposed || state.over || !(dt > 0)) return state
      const d = Math.min(dt, MAX_DT)
      const slices = Math.ceil(d / SLICE - 1e-9)
      const h = d / slices
      for (let i = 0; i < slices && !state.over; i++) slice(input, h)
      return state
    },
    forceCross(rivalPulls = false, rivalDelay = 0) {
      let pick: Rival | null = null
      for (const r of rivals) if (r.alive && (!pick || Math.abs(r.x) < Math.abs(pick.x))) pick = r
      if (!pick) return
      pick.anchorX = player.anchorX + 4
      pick.x = player.x - 4
      pick.y = player.y
      pick.tx = pick.x
      pick.ty = pick.y
      pick.cross = 0
      pick.hold = 5
      pick.stamina = STAMINA_MAX
      pick.locked = false
      pick.pullFor = rivalPulls ? 5 : 0
      pick.pullDelay = rivalPulls ? rivalDelay : 0
      for (const r of rivals) {
        if (r === pick || !r.alive) continue
        r.pullFor = 0
        r.think = Math.max(r.think, pick.hold)
      }
    },
    dispose() {
      disposed = true
    },
  }
}
