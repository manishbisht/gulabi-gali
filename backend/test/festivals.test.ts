import { describe, expect, it, vi } from 'vitest'
import { festivalOn } from '../src/festivals'
import { CALENDAR } from '../src/festivals.data'

const cal = [{ id: 'diwali', start: '2027-10-28', end: '2027-10-30' }] as const

it('is inclusive and uses IST days', () => {
  expect(festivalOn(new Date('2027-10-27T18:29:00Z'), [...cal])).toBeNull() // 23:59 IST on the 27th
  expect(festivalOn(new Date('2027-10-27T18:31:00Z'), [...cal])).toBe('diwali') // 00:01 IST on the 28th
  expect(festivalOn(new Date('2027-10-30T18:29:00Z'), [...cal])).toBe('diwali')
  expect(festivalOn(new Date('2027-10-30T18:31:00Z'), [...cal])).toBeNull()
})

it('the real calendar covers every festival in 2027', () => {
  const ids = new Set(CALENDAR.filter((e) => e.start.startsWith('2027')).map((e) => e.id))
  expect([...ids].sort()).toEqual(['diwali', 'gangaur', 'holi', 'jlf', 'newyear', 'sankranti', 'teej'])
})

it('has well-formed entries', () => {
  for (const e of CALENDAR) {
    // a day, or a day and an IST time; both ends the same kind
    expect(e.start).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
    expect(e.end).toHaveLength(e.start.length)
    expect(e.end > e.start || (e.start.length === 10 && e.end === e.start)).toBe(true)
  }
})

describe('a window with times (New Year: 31 Dec 18:00 to 1 Jan 06:00 IST)', () => {
  const ny = [
    { id: 'jlf', start: '2027-01-01', end: '2027-01-01' },
    { id: 'newyear', start: '2026-12-31T18:00', end: '2027-01-01T06:00' },
  ] as const
  const on = (iso: string) => festivalOn(new Date(iso), [...ny.slice(1)])

  it('starts at its IST start minute and stops at its end, which is not in it', () => {
    expect(on('2026-12-31T12:29:59Z')).toBeNull() // 17:59:59 IST on the 31st
    expect(on('2026-12-31T12:30:00Z')).toBe('newyear') // 18:00 IST
    expect(on('2026-12-31T18:30:00Z')).toBe('newyear') // midnight IST
    expect(on('2027-01-01T00:29:59Z')).toBe('newyear') // 05:59:59 IST on the 1st
    expect(on('2027-01-01T00:30:00Z')).toBeNull() // 06:00 IST
  })

  it('reads the instant, whatever timezone the Worker runs in', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    try {
      expect(on('2026-12-31T12:30:00Z')).toBe('newyear')
      expect(on('2026-12-31T06:00:00Z')).toBeNull() // already the 31st in UTC, 11:30 IST
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('mixes with day entries: where they overlap, the one listed first still wins', () => {
    const both = (iso: string) => festivalOn(new Date(iso), [...ny])
    expect(both('2026-12-31T20:00:00Z')).toBe('jlf') // 01:30 IST on the 1st: both, and the day entry is first
    expect(both('2026-12-31T13:00:00Z')).toBe('newyear') // 18:30 IST on the 31st: only New Year
  })
})

it('the real calendar has New Year evening to morning every year it covers', () => {
  for (const y of [2026, 2027, 2028]) {
    expect(festivalOn(new Date(`${y}-12-31T12:00:00Z`))).toBeNull() // 17:30 IST
    expect(festivalOn(new Date(`${y}-12-31T13:00:00Z`))).toBe('newyear') // 18:30 IST
    expect(festivalOn(new Date(`${y + 1}-01-01T00:00:00Z`))).toBe('newyear') // 05:30 IST
    expect(festivalOn(new Date(`${y + 1}-01-01T01:00:00Z`))).toBeNull() // 06:30 IST
  }
})
