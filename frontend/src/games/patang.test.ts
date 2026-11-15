// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storage } from '../storage'
import {
  CONTEST_S,
  ROUND_S,
  contestWinner,
  createPatang,
  loadBest,
  patangAvailable,
  rivalCount,
  saveBest,
  stringsCross,
} from './patang'

afterEach(() => {
  storage.clear()
  vi.restoreAllMocks()
})

const idle = { pull: false, steer: 0 }
/** Runs `s` seconds at 60 fps. */
function run(p: ReturnType<typeof createPatang>, s: number, input = idle) {
  for (let i = 0; i < Math.round(s * 60); i++) p.update(input, 1 / 60)
}

describe('rival count by tier', () => {
  it('is 6 at tiers 2 and 1 and 3 at tier 0', () => {
    expect([rivalCount(2), rivalCount(1), rivalCount(0)]).toEqual([6, 6, 3])
    for (const q of [0, 1, 2] as const) {
      const p = createPatang(1, q)
      expect(p.state.rivals).toHaveLength(rivalCount(q))
      p.dispose()
    }
  })
})

describe('steering', () => {
  it('is frame-rate independent: 1 x 0.1 s equals 10 x 0.01 s', () => {
    const a = createPatang(7, 2, { rivals: 0 })
    const b = createPatang(7, 2, { rivals: 0 })
    const input = { pull: true, steer: 1 }
    a.update(input, 0.1)
    for (let i = 0; i < 10; i++) b.update(input, 0.01)
    expect(a.state.player.x).toBeGreaterThan(0.3) // it really moved
    expect(a.state.player.x).toBeCloseTo(b.state.player.x, 6)
    expect(a.state.player.y).toBeCloseTo(b.state.player.y, 6)
    expect(a.state.timeLeft).toBeCloseTo(b.state.timeLeft, 6)
  })

  it('stays the same over a second at 30, 60 and 144 fps', () => {
    const xs = [30, 60, 144].map((fps) => {
      const p = createPatang(3, 2, { rivals: 0 })
      for (let i = 0; i < fps; i++) p.update({ pull: false, steer: -0.5 }, 1 / fps)
      return p.state.player.x
    })
    expect(xs[0]).toBeCloseTo(xs[1]!, 4)
    expect(xs[2]).toBeCloseTo(xs[1]!, 4)
  })

  it('a stalled frame is bounded, not a leap across the sky', () => {
    const p = createPatang(3, 2, { rivals: 0 })
    p.update({ pull: false, steer: 1 }, 30)
    expect(p.state.timeLeft).toBeGreaterThan(ROUND_S - 1)
  })
})

describe('the manjha contest', () => {
  it('crossing for 0.6 s while pulling cuts the rival', () => {
    const p = createPatang(11, 2, { rivals: 1 })
    p.forceCross()
    run(p, CONTEST_S - 0.2, { pull: true, steer: 0 })
    expect(p.state.score).toBe(0) // not yet
    run(p, 0.5, { pull: true, steer: 0 })
    expect(p.state.score).toBe(1)
    expect(p.state.over).toBe(false)
    expect(p.state.cutSeq).toBe(1)
  })

  it('neither pulling means nothing happens', () => {
    const p = createPatang(11, 2, { rivals: 1 })
    p.forceCross()
    run(p, 0.1)
    expect(p.state.crossing).toBe(true)
    run(p, 1.2)
    expect(p.state.score).toBe(0)
    expect(p.state.over).toBe(false)
    // and the moment the player pulls, the contest is decided
    run(p, 0.2, { pull: true, steer: 0 })
    expect(p.state.score).toBe(1)
  })

  it('a pulling rival cuts a player who is not pulling, ending the round early', () => {
    const p = createPatang(11, 2, { rivals: 1 })
    p.forceCross(true)
    run(p, 1.5)
    expect(p.state.over).toBe(true)
    expect(p.state.cutByRival).toBe(true)
    expect(p.state.score).toBe(0)
    expect(p.state.timeLeft).toBeGreaterThan(ROUND_S - 5)
  })

  it('when both pull, whoever started first wins', () => {
    // the rival starts pulling at once; the player joins late, so the rival wins
    const late = createPatang(11, 2, { rivals: 1 })
    late.forceCross(true)
    run(late, 0.2)
    run(late, 1.5, { pull: true, steer: 0 })
    expect(late.state.cutByRival).toBe(true)

    // the player was already pulling when the strings met, so the player wins
    const early = createPatang(11, 2, { rivals: 1 })
    early.forceCross(true, 0.8) // the rival begins pulling 0.8 s after the strings meet
    run(early, 1.5, { pull: true, steer: 0 })
    expect(early.state.cutByRival).toBe(false)
    expect(early.state.score).toBe(1)
  })

  it('a cut rival drifts away and a new one flies in after 3 s', () => {
    const p = createPatang(11, 2, { rivals: 1 })
    p.forceCross()
    run(p, 1, { pull: true, steer: 0 })
    expect(p.state.score).toBe(1)
    expect(p.state.rivals.filter((r) => r.alive)).toHaveLength(0)
    run(p, 3.2)
    expect(p.state.rivals.filter((r) => r.alive)).toHaveLength(1)
  })

  it('the round lasts 60 s', () => {
    const p = createPatang(5, 0, { rivals: 0 })
    run(p, ROUND_S - 1)
    expect(p.state.over).toBe(false)
    run(p, 1.1)
    expect(p.state.over).toBe(true)
    expect(p.state.timeLeft).toBe(0)
  })

  it('is deterministic for a seed', () => {
    const a = createPatang(42, 2)
    const b = createPatang(42, 2)
    run(a, 10)
    run(b, 10)
    expect(a.state.rivals.map((r) => r.x)).toEqual(b.state.rivals.map((r) => r.x))
  })

  it('judges who wins, and where two strings cross', () => {
    expect(contestWinner(true, 0.2, false, 0)).toBe('player')
    expect(contestWinner(false, 0, true, 0.2)).toBe('rival')
    expect(contestWinner(false, 0, false, 0)).toBeNull()
    expect(contestWinner(true, 0.9, true, 0.3)).toBe('player')
    expect(contestWinner(true, 0.3, true, 0.9)).toBe('rival')
    // (0,0)-(2,2) against (2,0)-(0,2) cross; (0,0)-(0,2) against (2,0)-(2,2) do not
    expect(stringsCross(0, 0, 2, 2, 2, 0, 0, 2)).toBe(true)
    expect(stringsCross(0, 0, 0, 2, 2, 0, 2, 2)).toBe(false)
  })
})

describe('best score', () => {
  it('persists via storage', () => {
    expect(loadBest()).toBe(0)
    expect(saveBest(3)).toBe(3)
    expect(storage.get('gg-patang-best')).toBe('3')
    expect(saveBest(2)).toBe(3) // a worse round does not lower it
    expect(loadBest()).toBe(3)
    expect(saveBest(5)).toBe(5)
    expect(loadBest()).toBe(5)
  })

  it('survives storage failure, and junk in storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(saveBest(4)).toBe(4)
    expect(loadBest()).toBe(4) // the page-lifetime copy
    vi.restoreAllMocks()
    storage.set('gg-patang-best', 'banana')
    expect(loadBest()).toBe(0)
  })
})

describe('the button', () => {
  const free = { festival: 'sankranti', driving: false, seated: false, card: false } as const
  it('appears only on Sankranti, on foot, with no card open', () => {
    expect(patangAvailable(free)).toBe(true)
    expect(patangAvailable({ ...free, festival: 'holi' })).toBe(false)
    expect(patangAvailable({ ...free, festival: null })).toBe(false)
    expect(patangAvailable({ ...free, driving: true })).toBe(false)
    expect(patangAvailable({ ...free, seated: true })).toBe(false)
    expect(patangAvailable({ ...free, card: true })).toBe(false)
  })
})
