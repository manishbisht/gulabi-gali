import { afterEach, describe, expect, it, vi } from 'vitest'
import { storage } from '../storage'
import { emitDeed, onDeed } from './deeds'
import { STAMPS } from './stamps'
import {
  advance,
  asRecord,
  dayBefore,
  GOAL_KINDS,
  goalById,
  goalFor,
  istDay,
  liveStreak,
  localRecord,
  meets,
  nextIstMidnight,
  NO_RECORD,
  saveLocalRecord,
  type Deed,
} from './today'

afterEach(() => storage.clear())

/** `count` IST days from `from` on. */
function days(from: string, count: number): string[] {
  const out: string[] = []
  let ms = Date.parse(`${from}T00:00:00Z`)
  for (let i = 0; i < count; i++, ms += 24 * 3600_000) out.push(new Date(ms).toISOString().slice(0, 10))
  return out
}

describe('the IST day', () => {
  it('is the date in India, wherever the phone is', () => {
    // 20:00 UTC on the 23rd is 01:30 on the 24th in Jaipur
    expect(istDay(Date.parse('2026-11-23T20:00:00Z'))).toBe('2026-11-24')
    expect(istDay(Date.parse('2026-11-23T18:29:59Z'))).toBe('2026-11-23')
    expect(istDay(Date.parse('2026-11-23T18:30:00Z'))).toBe('2026-11-24')
    // the same instant read with a phone set to New York or Tokyo: Date.parse of an offset string is absolute
    expect(istDay(Date.parse('2026-11-23T15:00:00-05:00'))).toBe('2026-11-24')
    expect(istDay(Date.parse('2026-11-24T05:00:00+09:00'))).toBe('2026-11-24')
  })

  it('turns over at midnight IST, and knows the day before across months and years', () => {
    expect(nextIstMidnight(Date.parse('2026-11-24T10:00:00+05:30'))).toBe(Date.parse('2026-11-25T00:00:00+05:30'))
    expect(nextIstMidnight(Date.parse('2026-11-24T00:00:00+05:30'))).toBe(Date.parse('2026-11-25T00:00:00+05:30'))
    expect(dayBefore('2026-12-01')).toBe('2026-11-30')
    expect(dayBefore('2027-01-01')).toBe('2026-12-31')
    expect(dayBefore('2028-03-01')).toBe('2028-02-29')
  })
})

describe('the goal of the day', () => {
  it('is the same for a day whoever asks, and has a stable id', () => {
    expect(goalFor('2026-11-24')).toEqual(goalFor('2026-11-24'))
    const g = goalFor('2026-11-24')
    expect(goalById(g.id)).toEqual(g)
  })

  it('does every kind once in each run of days, never the same kind two days running', () => {
    const all = days('2026-01-01', 800).map(goalFor)
    for (let i = 1; i < all.length; i++) expect(all[i]!.kind, `day ${i}`).not.toBe(all[i - 1]!.kind)
    // runs line up with the day number; within each, every kind once
    const n0 = Math.floor(Date.parse('2026-01-01T00:00:00Z') / 86400_000)
    const start = (GOAL_KINDS.length - (n0 % GOAL_KINDS.length)) % GOAL_KINDS.length
    for (let r = start; r + GOAL_KINDS.length <= all.length; r += GOAL_KINDS.length)
      expect(new Set(all.slice(r, r + GOAL_KINDS.length).map((g) => g.kind)).size).toBe(GOAL_KINDS.length)
  })

  it("names a known landmark on a darshan day, and goes round all of them", () => {
    const seen = new Set<string>()
    for (const g of days('2026-01-01', GOAL_KINDS.length * STAMPS.length).map(goalFor))
      if (g.kind === 'darshan') {
        expect(STAMPS.some((s) => s.id === g.stamp)).toBe(true)
        expect(g.id).toBe(`darshan:${g.stamp}`)
        seen.add(g.stamp!)
      }
    expect(seen.size).toBe(STAMPS.length)
  })

  it('reads an override id, and refuses one that is not a goal', () => {
    expect(goalById('photo')).toEqual({ id: 'photo', kind: 'photo' })
    expect(goalById('darshan:jkk')).toEqual({ id: 'darshan:jkk', kind: 'darshan', stamp: 'jkk' })
    for (const bad of ['darshan', 'darshan:taj-mahal', 'greet', 'photo:x', '']) expect(goalById(bad)).toBeNull()
  })

  it('never asks for another person, a sign-in or the monkey', () => {
    expect(GOAL_KINDS).toEqual(['darshan', 'tapri', 'ride', 'auto', 'photo', 'roof', 'map', 'animal'])
  })
})

describe('doing it', () => {
  const kinds: Deed[] = [
    { kind: 'tapri' },
    { kind: 'ride' },
    { kind: 'auto' },
    { kind: 'photo' },
    { kind: 'roof' },
    { kind: 'map' },
    { kind: 'animal' },
  ]
  it('each kind is done by its own deed and no other', () => {
    for (const d of kinds) {
      const goal = goalById(d.kind)!
      expect(meets(goal, d), d.kind).toBe(true)
      for (const other of kinds) if (other.kind !== d.kind) expect(meets(goal, other)).toBe(false)
      expect(meets(goal, { kind: 'darshan', stamp: 'jkk' })).toBe(false)
    }
  })

  it("a darshan day is done at that landmark only", () => {
    const goal = goalById('darshan:hawa-mahal')!
    expect(meets(goal, { kind: 'darshan', stamp: 'hawa-mahal' })).toBe(true)
    expect(meets(goal, { kind: 'darshan', stamp: 'jkk' })).toBe(false)
    expect(meets(goal, { kind: 'photo' })).toBe(false)
  })

  it('the deeds bus reaches every listener until it stops listening, past one that throws', () => {
    const a = vi.fn()
    const off = onDeed(() => {
      throw new Error('broken')
    })
    const offA = onDeed(a)
    emitDeed({ kind: 'photo' })
    expect(a).toHaveBeenCalledWith({ kind: 'photo' })
    offA()
    off()
    emitDeed({ kind: 'roof' })
    expect(a).toHaveBeenCalledTimes(1)
  })
})

describe('the streak', () => {
  it('starts at 1, adds a day for each day running, and the same day twice changes nothing', () => {
    let r = advance(NO_RECORD, '2026-11-20')
    expect(r).toEqual({ last: '2026-11-20', streak: 1, best: 1 })
    r = advance(r, '2026-11-21')
    expect(r).toEqual({ last: '2026-11-21', streak: 2, best: 2 })
    expect(advance(r, '2026-11-21')).toBe(r)
    r = advance(r, '2026-11-22')
    expect(r.streak).toBe(3)
  })

  it('a missed day starts it again at 1 and keeps the best', () => {
    const r = advance({ last: '2026-11-22', streak: 3, best: 3 }, '2026-11-24')
    expect(r).toEqual({ last: '2026-11-24', streak: 1, best: 3 })
  })

  it('shows the run while it is alive (done today or yesterday), else 0', () => {
    const r = { last: '2026-11-22', streak: 4, best: 6 }
    expect(liveStreak(r, '2026-11-22')).toBe(4)
    expect(liveStreak(r, '2026-11-23')).toBe(4)
    expect(liveStreak(r, '2026-11-24')).toBe(0)
    expect(liveStreak(NO_RECORD, '2026-11-24')).toBe(0)
  })

  it("a ghost's record lives on this device; a broken or tampered save reads as none", () => {
    expect(localRecord()).toEqual(NO_RECORD)
    saveLocalRecord({ last: '2026-11-24', streak: 2, best: 5 })
    expect(localRecord()).toEqual({ last: '2026-11-24', streak: 2, best: 5 })
    for (const bad of ['nope', '{"last":"x","streak":1,"best":1}', '{"last":"2026-11-24","streak":5,"best":2}'])
      expect(asRecord((() => { try { return JSON.parse(bad) } catch { return null } })())).toBeNull()
    storage.set('gg-today', '{oops')
    expect(localRecord()).toEqual(NO_RECORD)
  })
})
