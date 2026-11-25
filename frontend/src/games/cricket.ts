import { storage } from '../storage'

/*
 * Gali cricket: a kid bowls, one tap swings. A pure, seeded simulation (rendering lives in cricketView.ts): the
 * same seed and the same taps at the same moments are the same innings, whatever the frame rate.
 *
 * An innings is three overs or three outs, whichever comes first, about a minute. Each ball: the run-up, the
 * flight to the bat, then what came of it. Runs are a matter of timing alone: how far the tap was from the
 * moment the ball reached the bat.
 */

/** An innings ends after this many balls (three overs)... */
export const MAX_BALLS = 18
/** ...or this many outs. */
export const MAX_OUTS = 3
/** Before the first ball the bowler waits for the batter's tap ("ready?"), this long at most. */
export const READY_S = 3
/** The bowler's run-up, in seconds, before the ball leaves the hand. */
export const RUNUP_S = 0.9
/** How long what came of a ball is shown before the next run-up. */
export const RESULT_S = 1.1
/** A broken window is shown for longer: its line takes a moment to read. */
export const ARRE_S = 2.2
/** A tap within this many seconds of the ball reaching the bat, either side: a six, a four, two, one. */
export const SIX_S = 0.04
/** The six's window on a slow phone (the lowest quality tier draws about 30 frames a second): more than one frame. */
export const SIX_SLOW_S = 0.055
/**
 * A finger is on the glass a little before the browser says so: a touch's tap is taken as this much earlier
 * than its event's time stamp.
 */
export const TOUCH_LAG_S = 0.05
/** A tap is placed no further than this before, or after, the frame it is heard in. */
const TAP_EARLY_S = 0.15
const TAP_LATE_S = 0.1
export const FOUR_S = 0.08
export const TWO_S = 0.13
export const ONE_S = 0.18
/** The quickest and the slowest ball's flight to the bat, in seconds. */
export const FLIGHT_MIN_S = 0.7
export const FLIGHT_MAX_S = 1.15
/** A longest slice the innings is stepped in, so a long frame is the same game as several short ones. */
const SLICE = 1 / 30
/** A stalled frame (a tab coming back) counts for no more than this. */
const MAX_DT = 0.25
const BEST_KEY = 'gg-cricket-best'

export type Outcome = 'six' | 'four' | 'two' | 'one' | 'dot' | 'bowled' | 'caught'

/** The most runs in one innings, kept under `gg-cricket-best`; junk in storage reads as no best. */
export function loadBest(): number {
  const n = Number(storage.get(BEST_KEY))
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** Records an innings' runs; returns the best now (a worse innings leaves it as it was). */
export function saveBest(runs: number): number {
  const best = Math.max(loadBest(), runs)
  if (best > 0) storage.set(BEST_KEY, String(best))
  return best
}

/**
 * The runs a tap `err` seconds from the perfect moment is worth (early or late alike); 0 is a miss. `six` is
 * the six's window (`SIX_SLOW_S` on a slow phone).
 */
export function runsFor(err: number, six: number = SIX_S): 0 | 1 | 2 | 4 | 6 {
  const off = Math.abs(err)
  return off <= six ? 6 : off <= FOUR_S ? 4 : off <= TWO_S ? 2 : off <= ONE_S ? 1 : 0
}

/** One ball, as the seed deals it. */
export interface Delivery {
  /** Seconds from the hand to the bat. */
  flight: number
  /** On the stumps: miss it and the bricks go down. Off them, a miss is only a dot ball. */
  straight: boolean
  /** Where it pitches across the strip, -1 (off side) to 1 (leg side): for the eye only. */
  line: number
  /** A fielder is under it if it is skied: an early two goes to hand on one bounce, and by lane rules that is out. */
  catchable: boolean
  /** Somebody's window is in the way of a six off this ball. */
  window: boolean
}

/**
 * What a ball comes to. `err` is the tap's distance from the perfect moment in seconds (negative early), or
 * null with no tap. A miss is bowled off a straight ball and a dot ball otherwise; a two hit early off a
 * catchable ball (a skied leading edge) is caught on one bounce ("ek tappa out"); the rest is runs by timing.
 * Only an early stroke is ever caught: a phone that hears a tap late never costs a wicket for it.
 */
export function judge(d: Delivery, err: number | null, six: number = SIX_S): Outcome {
  const runs = err === null ? 0 : runsFor(err, six)
  if (runs === 0) return d.straight ? 'bowled' : 'dot'
  if (runs === 2 && d.catchable && err! < 0) return 'caught'
  return runs === 6 ? 'six' : runs === 4 ? 'four' : runs === 2 ? 'two' : 'one'
}

export const runsOf = (o: Outcome): number =>
  o === 'six' ? 6 : o === 'four' ? 4 : o === 'two' ? 2 : o === 'one' ? 1 : 0
export const isOut = (o: Outcome): boolean => o === 'bowled' || o === 'caught'

export interface CricketState {
  /**
   * `ready`: before the first ball, the bowler waits for a tap (or `READY_S`); `runup`: the bowler runs in;
   * `flight`: the ball is on its way; `result`: what came of it; `over`: stumps.
   */
  phase: 'ready' | 'runup' | 'flight' | 'result' | 'over'
  /** Seconds into this phase. In `flight` the ball reaches the bat at `flight`, the stumps `ONE_S` later. */
  t: number
  /** This ball's flight time and line (see `Delivery`). */
  flight: number
  line: number
  /** Balls finished so far, runs, and outs. */
  balls: number
  runs: number
  outs: number
  /** The innings is over, and its last ball has been shown. */
  over: boolean
  /** What the last finished ball came to (null before the first). */
  last: Outcome | null
  /** Goes up by one each time a ball comes to something. */
  seq: number
  /** The last ball was a six through a window ("Arre!"): once an innings at most. */
  arre: boolean
  /** How long the last ball's result is shown, in seconds (`ARRE_S` for the window, else `RESULT_S`). */
  hold: number
  /** Seconds since the bat was last swung (large when it has not been, this ball). */
  swing: number
  /** How many times the bat has been swung this innings (the "ready" tap is not one). */
  swings: number
}

export interface Cricket {
  /** The same object every call, updated in place: a frame allocates nothing. */
  readonly state: CricketState
  update(dt: number): CricketState
  /**
   * The tap. Before the first ball it only says "ready": the bowler starts the run-up, and nothing is swung.
   * After that, one swing a ball; a tap before the ball has left the hand, or far too early, is a swing at
   * air, and the ball still has to be survived. `since` is when the tap was, in seconds after the last
   * `update` (negative: before it; see `tapSince`): the timing is the tap's, not the frame's.
   */
  swing(since?: number): void
  /** For tests: seconds from now until the ball of this delivery reaches the bat (0 once past, or over). */
  untilBat(): number
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

/** Deals a ball: always the same five draws, so a seed's innings is one sequence of balls whatever is hit. */
export function deal(rand: () => number): Delivery {
  const flight = FLIGHT_MIN_S + rand() * (FLIGHT_MAX_S - FLIGHT_MIN_S)
  const straight = rand() < 0.5
  const line = straight ? (rand() - 0.5) * 0.3 : (rand() < 0.5 ? -1 : 1) * (0.55 + rand() * 0.45)
  return { flight, straight, line, catchable: rand() < 0.5, window: rand() < 0.5 }
}

/**
 * When a tap was, in seconds after the frame the game last stepped on (negative: before it), from the tap
 * event's own time stamp and that frame's, both in ms on the page's clock. A touch is taken `TOUCH_LAG_S`
 * earlier (see there). Bounded, so a stamp from some other clock cannot fling the stroke.
 */
export function tapSince(stampMs: number, frameMs: number, touch: boolean): number {
  const since = (stampMs - frameMs) / 1000 - (touch ? TOUCH_LAG_S : 0)
  return Number.isFinite(since) ? Math.min(Math.max(since, -TAP_EARLY_S), TAP_LATE_S) : 0
}

/**
 * An innings of gali cricket from `seed`. Stepped in equal slices of at most 1/30 s. `opts.six` is the six's
 * window (`SIX_SLOW_S` on the lowest quality tier).
 */
export function createCricket(seed: number, opts: { six?: number } = {}): Cricket {
  const six = opts.six ?? SIX_S
  const rand = rng(seed)
  let ball = deal(rand)
  let disposed = false
  /** The window gag has been had this innings. */
  let arreDone = false
  /** This ball has been swung at. */
  let swung = false
  const state: CricketState = {
    phase: 'ready',
    t: 0,
    flight: ball.flight,
    line: ball.line,
    balls: 0,
    runs: 0,
    outs: 0,
    over: false,
    last: null,
    seq: 0,
    arre: false,
    hold: RESULT_S,
    swing: 99,
    swings: 0,
  }

  function settle(err: number | null) {
    const o = judge(ball, err, six)
    state.last = o
    state.seq++
    state.balls++
    state.runs += runsOf(o)
    if (isOut(o)) state.outs++
    state.arre = o === 'six' && ball.window && !arreDone
    if (state.arre) arreDone = true
    state.hold = state.arre ? ARRE_S : RESULT_S
    state.phase = 'result'
    state.t = 0
  }

  function slice(h: number) {
    state.t += h
    state.swing += h
    if (state.phase === 'ready') {
      if (state.t < READY_S) return
      state.phase = 'runup'
      state.t -= READY_S
    }
    if (state.phase === 'runup') {
      if (state.t < RUNUP_S) return
      state.phase = 'flight'
      state.t -= RUNUP_S
    }
    if (state.phase === 'flight') {
      // past the bat and into the stumps (or past them) with no bat on it
      if (state.t >= ball.flight + ONE_S) settle(null)
      return
    }
    if (state.phase !== 'result' || state.t < state.hold) return
    if (state.balls >= MAX_BALLS || state.outs >= MAX_OUTS) {
      state.phase = 'over'
      state.over = true
      return
    }
    ball = deal(rand)
    swung = false
    state.flight = ball.flight
    state.line = ball.line
    state.phase = 'runup'
    state.t = 0
    state.swing = 99
  }

  return {
    state,
    update(dt) {
      if (disposed || state.over || !(dt > 0)) return state
      const d = Math.min(dt, MAX_DT)
      const slices = Math.ceil(d / SLICE - 1e-9)
      const h = d / slices
      for (let i = 0; i < slices && !state.over; i++) slice(h)
      return state
    },
    swing(since = 0) {
      if (disposed || state.over || swung || state.phase === 'result') return
      if (state.phase === 'ready') {
        // "ready": the bowler starts in, and the bat stays where it is
        state.phase = 'runup'
        state.t = 0
        return
      }
      swung = true
      state.swings++
      const at = Math.min(Math.max(since, -TAP_EARLY_S), TAP_LATE_S)
      state.swing = 0
      if (state.phase !== 'flight') return // at air: the ball is still in the hand
      const err = state.t + at - ball.flight
      // close enough to be a stroke: it is played now. Too early is a swing at air, and the ball comes on
      if (runsFor(err, six) > 0) settle(err)
    },
    untilBat() {
      if (state.phase === 'ready') return READY_S - state.t + RUNUP_S + ball.flight
      if (state.phase === 'runup') return RUNUP_S - state.t + ball.flight
      return state.phase === 'flight' ? Math.max(0, ball.flight - state.t) : 0
    },
    dispose() {
      disposed = true
    },
  }
}
