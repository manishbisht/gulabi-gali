// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { storage } from '../storage'
import {
  createCricket,
  deal,
  FLIGHT_MAX_S,
  FLIGHT_MIN_S,
  FOUR_S,
  isOut,
  judge,
  loadBest,
  MAX_BALLS,
  MAX_OUTS,
  ONE_S,
  READY_S,
  RESULT_S,
  SIX_SLOW_S,
  tapSince,
  TOUCH_LAG_S,
  ARRE_S,
  RUNUP_S,
  runsFor,
  runsOf,
  saveBest,
  SIX_S,
  TWO_S,
  type Cricket,
  type Delivery,
  type Outcome,
} from './cricket'

afterEach(() => storage.clear())

const STEP = 1 / 240
/** Steps the innings on by `s` seconds, finely. */
function run(c: Cricket, s: number) {
  for (let i = 0; i < Math.round(s / STEP); i++) c.update(STEP)
}
/** Lets the last ball's result be shown out (a broken window's takes longer). */
function rest(c: Cricket) {
  while (c.state.phase === 'result') c.update(STEP)
}
/** Plays the ball now being bowled with a tap `err` seconds from the perfect moment (null: no tap). */
function play(c: Cricket, err: number | null): Outcome {
  const seq = c.state.seq
  while (c.state.phase === 'result') c.update(STEP)
  if (err !== null) {
    run(c, c.untilBat() + err)
    c.swing()
  }
  while (c.state.seq === seq) c.update(STEP)
  return c.state.last!
}
/** A whole innings with one timing error for every ball. */
function innings(seed: number, err: number | null) {
  const c = createCricket(seed)
  const seen: Outcome[] = []
  while (!c.state.over && seen.length < 40) {
    seen.push(play(c, err))
    rest(c)
  }
  return { c, seen }
}

const ball = (over: Partial<Delivery> = {}): Delivery => ({
  flight: 0.9,
  straight: false,
  line: 0,
  catchable: false,
  window: false,
  ...over,
})

describe('runs by timing', () => {
  it('is 6, 4, 2, 1 and a miss as the tap strays, early or late alike', () => {
    expect(runsFor(0)).toBe(6)
    expect(runsFor(SIX_S)).toBe(6)
    expect(runsFor(-SIX_S)).toBe(6)
    expect(runsFor(SIX_S + 0.001)).toBe(4)
    expect(runsFor(-FOUR_S)).toBe(4)
    expect(runsFor(FOUR_S + 0.001)).toBe(2)
    expect(runsFor(TWO_S + 0.001)).toBe(1)
    expect(runsFor(-ONE_S)).toBe(1)
    expect(runsFor(ONE_S + 0.001)).toBe(0)
    expect(runsFor(-1)).toBe(0)
  })

  it('the six has a wider window on a slow phone: more than one of its frames', () => {
    expect(SIX_SLOW_S).toBeGreaterThan(1 / 30)
    expect(SIX_SLOW_S).toBeLessThan(FOUR_S)
    expect(runsFor(0.05)).toBe(4)
    expect(runsFor(0.05, SIX_SLOW_S)).toBe(6)
    expect(runsFor(-0.05, SIX_SLOW_S)).toBe(6)
    expect(runsFor(0.06, SIX_SLOW_S)).toBe(4)
    expect(judge(ball(), 0.05, SIX_SLOW_S)).toBe('six')
    // and the innings uses it
    const slow = createCricket(8, { six: SIX_SLOW_S })
    expect(play(slow, 0.05)).toBe('six')
    const quick = createCricket(8)
    expect(play(quick, 0.05)).toBe('four')
  })

  it('a miss is bowled off a straight ball and a dot ball off a wide one', () => {
    expect(judge(ball({ straight: true }), null)).toBe('bowled')
    expect(judge(ball({ straight: true }), 0.5)).toBe('bowled')
    expect(judge(ball(), null)).toBe('dot')
    expect(judge(ball(), -0.5)).toBe('dot')
  })

  it('an early two off a catchable ball is caught on one bounce; a late stroke never is', () => {
    expect(judge(ball({ catchable: true }), -0.1)).toBe('caught') // a skied leading edge
    expect(judge(ball({ catchable: true }), 0.1)).toBe('two') // late: only a two
    expect(judge(ball(), -0.1)).toBe('two')
    // a phone that hears every tap late costs runs at worst, never a wicket: no late stroke is out
    for (const d of [ball({ catchable: true }), ball({ catchable: true, straight: true })])
      for (let err = 0; err <= ONE_S; err += 0.005) expect(isOut(judge(d, err)), `late by ${err}`).toBe(false)
    expect(judge(ball({ catchable: true }), -0.06)).toBe('four')
    expect(judge(ball({ catchable: true }), -0.16)).toBe('one')
    expect(judge(ball({ catchable: true }), 0)).toBe('six')
    expect(judge(ball({ catchable: true }), 0.06)).toBe('four')
    expect(judge(ball({ catchable: true }), 0.16)).toBe('one')
  })

  it('counts runs and outs', () => {
    expect((['six', 'four', 'two', 'one', 'dot', 'bowled', 'caught'] as const).map(runsOf)).toEqual([
      6, 4, 2, 1, 0, 0, 0,
    ])
    expect((['six', 'dot', 'bowled', 'caught'] as const).map(isOut)).toEqual([false, false, true, true])
  })
})

describe('the balls a seed deals', () => {
  it('are the same every time, and differ between seeds', () => {
    const balls = (seed: number) => {
      const c = createCricket(seed)
      const out: number[] = []
      for (let i = 0; i < 6; i++) {
        out.push(c.state.flight, c.state.line)
        play(c, 0)
      }
      return out
    }
    expect(balls(42)).toEqual(balls(42))
    expect(balls(42)).not.toEqual(balls(43))
  })

  it('fly for between the quickest and the slowest, straight ones at the stumps and wide ones off them', () => {
    let a = 1
    const rand = () => {
      a = (a * 16807) % 2147483647
      return a / 2147483647
    }
    let straight = 0
    for (let i = 0; i < 400; i++) {
      const d = deal(rand)
      expect(d.flight).toBeGreaterThanOrEqual(FLIGHT_MIN_S)
      expect(d.flight).toBeLessThanOrEqual(FLIGHT_MAX_S)
      if (d.straight) straight++
      if (d.straight) expect(Math.abs(d.line)).toBeLessThanOrEqual(0.15)
      else expect(Math.abs(d.line)).toBeGreaterThanOrEqual(0.55)
      expect(Math.abs(d.line)).toBeLessThanOrEqual(1)
    }
    expect(straight).toBeGreaterThan(140)
    expect(straight).toBeLessThan(260)
  })
})

describe('an innings', () => {
  it('is three overs of sixes for perfect timing: 108, with the window broken once at most', () => {
    const c = createCricket(7)
    let arre = 0
    for (let i = 0; i < MAX_BALLS; i++) {
      expect(play(c, 0)).toBe('six')
      if (c.state.arre) arre++
      expect(c.state.over).toBe(false) // the last ball is shown before the innings is over
      rest(c)
    }
    expect(c.state.over).toBe(true)
    expect(c.state.phase).toBe('over')
    expect(c.state.runs).toBe(108)
    expect(c.state.balls).toBe(MAX_BALLS)
    expect(c.state.outs).toBe(0)
    expect(arre).toBeLessThanOrEqual(1)
  })

  it('breaks a window in some innings and never twice', () => {
    let broke = 0
    for (let seed = 1; seed <= 12; seed++) {
      const c = createCricket(seed)
      let arre = 0
      while (!c.state.over) {
        play(c, 0)
        if (c.state.arre) arre++
        rest(c)
      }
      expect(arre).toBeLessThanOrEqual(1)
      broke += arre
    }
    expect(broke).toBeGreaterThan(6)
  })

  it('ends at the third out for someone who never swings, with no runs', () => {
    const { c, seen } = innings(11, null)
    expect(c.state.over).toBe(true)
    expect(c.state.runs).toBe(0)
    expect(seen.every((o) => o === 'bowled' || o === 'dot')).toBe(true)
    if (c.state.outs === MAX_OUTS) expect(seen.at(-1)).toBe('bowled')
    else expect(c.state.balls).toBe(MAX_BALLS)
    expect(c.state.balls).toBeLessThanOrEqual(MAX_BALLS)
  })

  it('is the same innings for the same seed and the same taps', () => {
    for (const err of [0, 0.06, -0.1, 0.1, 0.16, 0.3, null]) {
      const a = innings(99, err)
      const b = innings(99, err)
      expect(a.seen).toEqual(b.seen)
      expect({ ...a.c.state }).toEqual({ ...b.c.state })
    }
    // and timing is all that scores: a little late is fours, later still twos or a catch
    expect(innings(99, 0.06).seen.every((o) => o === 'four')).toBe(true)
    expect(innings(99, -0.1).seen.every((o) => o === 'two' || o === 'caught')).toBe(true)
    expect(innings(99, 0.1).seen.every((o) => o === 'two')).toBe(true)
  })

  it('is frame-rate independent: 20, 60 and 144 fps with no taps end the same', () => {
    const ends = [20, 60, 144].map((fps) => {
      const c = createCricket(5)
      for (let i = 0; i < fps * 90 && !c.state.over; i++) c.update(1 / fps)
      return { runs: c.state.runs, outs: c.state.outs, balls: c.state.balls, last: c.state.last }
    })
    expect(ends[0]).toEqual(ends[1])
    expect(ends[2]).toEqual(ends[1])
  })

  it('lasts about a minute at most, and a stalled frame counts for little', () => {
    const c = createCricket(3)
    let t = 0
    while (!c.state.over && t < 200) {
      // a batter who survives every ball: a tap just inside the window
      if (c.state.phase === 'flight' && c.untilBat() <= 0.15) c.swing()
      c.update(1 / 60)
      t += 1 / 60
    }
    expect(c.state.balls).toBe(MAX_BALLS)
    expect(t).toBeGreaterThan(40)
    expect(t).toBeLessThan(65)
    const d = createCricket(3)
    d.update(30) // a tab coming back
    expect(d.state.phase).toBe('ready')
    expect(d.state.t).toBeLessThanOrEqual(0.25 + 1e-9)
  })
})

describe('the ready beat', () => {
  it('waits for a tap before the first ball: that tap starts the run-up and is not a swing', () => {
    const c = createCricket(4)
    expect(c.state.phase).toBe('ready')
    c.update(1)
    expect(c.state.phase).toBe('ready')
    c.swing()
    expect(c.state.phase).toBe('runup')
    expect(c.state.t).toBe(0)
    expect(c.state.swing).toBeGreaterThan(90) // the bat has not moved
    // the swing of this ball is still to be had: a perfect one is a six
    expect(play(c, 0)).toBe('six')
  })

  it('starts by itself after three seconds for someone who only watches', () => {
    const c = createCricket(4)
    run(c, READY_S - 0.05)
    expect(c.state.phase).toBe('ready')
    run(c, 0.1)
    expect(c.state.phase).toBe('runup')
    expect(c.state.balls).toBe(0)
  })

  it('is only before the first ball: later balls follow one another', () => {
    const c = createCricket(4)
    play(c, 0)
    rest(c)
    expect(c.state.phase).toBe('runup')
  })
})

describe("the tap's own moment", () => {
  it("is the event's time stamp against the frame's, a touch taken a little earlier", () => {
    expect(tapSince(1030, 1000, false)).toBeCloseTo(0.03)
    expect(tapSince(990, 1000, false)).toBeCloseTo(-0.01) // heard a frame late: it was before this frame
    expect(tapSince(1030, 1000, true)).toBeCloseTo(0.03 - TOUCH_LAG_S)
    expect(TOUCH_LAG_S).toBeCloseTo(0.05)
  })

  it('is bounded, whatever clock the stamp came from', () => {
    expect(tapSince(1_700_000_000_000, 1000, false)).toBe(0.1)
    expect(tapSince(0, 100_000, true)).toBe(-0.15)
    expect(tapSince(Number.NaN, 1000, false)).toBe(0)
  })

  it('a touch heard 50 ms late is the stroke it was: the six stays a six', () => {
    const c = createCricket(23)
    run(c, c.untilBat() + 0.05) // the frame the late event lands in
    c.swing(tapSince(1000, 1000, true))
    expect(c.state.last).toBe('six')
    const d = createCricket(23)
    run(d, d.untilBat() + 0.05)
    d.swing(tapSince(1000, 1000, false)) // a mouse, on time by its own stamp: 50 ms late is a four
    expect(d.state.last).toBe('four')
  })
})

describe('a broken window', () => {
  it('is shown for about two seconds, long enough to read; any other ball for one', () => {
    expect(ARRE_S).toBeGreaterThanOrEqual(2)
    let seen = false
    for (let seed = 1; seed <= 12 && !seen; seed++) {
      const c = createCricket(seed)
      while (!c.state.over && !seen) {
        play(c, 0)
        const shown = c.state.arre ? ARRE_S : RESULT_S
        expect(c.state.hold).toBe(shown)
        run(c, shown - 0.05)
        expect(c.state.phase).toBe('result')
        run(c, 0.1)
        expect(c.state.phase).not.toBe('result')
        seen = c.state.arre
      }
    }
    expect(seen).toBe(true)
  })
})

describe('the swing', () => {
  it('is one a ball: a swing at air while the bowler runs in leaves the ball to be survived', () => {
    const c = createCricket(21)
    c.swing() // "ready"
    c.update(0.1)
    c.swing() // far too early: the ball is still in the hand
    expect(c.state.swing).toBe(0)
    run(c, c.untilBat())
    c.swing() // perfect, but the bat has been swung
    const seq = c.state.seq
    expect(seq).toBe(0)
    while (c.state.seq === seq) c.update(STEP)
    expect(runsOf(c.state.last!)).toBe(0)
    // the next ball is a fresh swing
    expect(play(c, 0)).toBe('six')
  })

  it('too early in the flight is a swing at air too; in time, the stroke is played at once', () => {
    const c = createCricket(22)
    c.swing() // "ready"
    run(c, RUNUP_S + 0.05)
    expect(c.state.phase).toBe('flight')
    c.swing()
    expect(c.state.seq).toBe(0) // nothing came of it yet: the ball comes on
    const d = createCricket(22)
    run(d, d.untilBat() - 0.06)
    d.swing()
    expect(d.state.seq).toBe(1)
    expect(d.state.last).toBe('four')
    expect(d.state.phase).toBe('result')
    d.swing() // while the result shows: nothing
    expect(d.state.seq).toBe(1)
  })

  it("takes the tap's own moment, not the frame's: a tap 50 ms after the last frame is 50 ms later", () => {
    const c = createCricket(23)
    run(c, c.untilBat() - 0.1)
    c.swing(0.05) // 50 ms early, not 100
    expect(c.state.last).toBe('four')
    const d = createCricket(23)
    run(d, d.untilBat() - 0.1)
    d.swing()
    expect(['two', 'caught']).toContain(d.state.last)
  })

  it('does nothing once the innings is over or the game is gone', () => {
    const { c } = innings(31, null)
    const before = { ...c.state }
    c.swing()
    c.update(1)
    expect({ ...c.state }).toEqual(before)
    const d = createCricket(31)
    d.dispose()
    d.update(1)
    d.swing()
    expect(d.state.t).toBe(0)
    expect(d.state.swing).toBe(99)
  })
})

describe('best score', () => {
  it('loads 0 with nothing stored and ignores junk', () => {
    expect(loadBest()).toBe(0)
    storage.set('gg-cricket-best', 'lots')
    expect(loadBest()).toBe(0)
    storage.set('gg-cricket-best', '-3')
    expect(loadBest()).toBe(0)
  })

  it('keeps the highest under gg-cricket-best', () => {
    expect(saveBest(0)).toBe(0)
    expect(storage.get('gg-cricket-best')).toBeNull()
    expect(saveBest(24)).toBe(24)
    expect(saveBest(12)).toBe(24)
    expect(loadBest()).toBe(24)
    expect(saveBest(31)).toBe(31)
    expect(storage.get('gg-cricket-best')).toBe('31')
  })
})
