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
  RESULT_S,
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
    run(c, RESULT_S + 0.05)
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

  it('a miss is bowled off a straight ball and a dot ball off a wide one', () => {
    expect(judge(ball({ straight: true }), null)).toBe('bowled')
    expect(judge(ball({ straight: true }), 0.5)).toBe('bowled')
    expect(judge(ball(), null)).toBe('dot')
    expect(judge(ball(), -0.5)).toBe('dot')
  })

  it('a late two off a catchable ball is caught on one bounce; nothing else is', () => {
    expect(judge(ball({ catchable: true }), 0.1)).toBe('caught')
    expect(judge(ball({ catchable: true }), -0.1)).toBe('two') // early: along the ground
    expect(judge(ball(), 0.1)).toBe('two')
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
      run(c, RESULT_S + 0.05)
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
        run(c, RESULT_S + 0.05)
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
    expect(innings(99, 0.1).seen.every((o) => o === 'two' || o === 'caught')).toBe(true)
    expect(innings(99, -0.1).seen.every((o) => o === 'two')).toBe(true)
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
    expect(d.state.phase).toBe('runup')
    expect(d.state.t).toBeLessThanOrEqual(0.25 + 1e-9)
  })
})

describe('the swing', () => {
  it('is one a ball: a swing at air while the bowler runs in leaves the ball to be survived', () => {
    const c = createCricket(21)
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
    expect(d.state.last).toBe('two')
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
