import { describe, expect, it, vi } from 'vitest'
import { festivalForVersion, festivalOn } from '../src/festivals'
import type { FestivalId } from '../src/protocol'
import { CALENDAR } from '../src/festivals.data'

const cal = [{ id: 'diwali', start: '2027-10-28', end: '2027-10-30' }] as const

it('is inclusive and uses IST days', () => {
  expect(festivalOn(new Date('2027-10-27T18:29:00Z'), [...cal])).toBeNull() // 23:59 IST on the 27th
  expect(festivalOn(new Date('2027-10-27T18:31:00Z'), [...cal])).toBe('diwali') // 00:01 IST on the 28th
  expect(festivalOn(new Date('2027-10-30T18:29:00Z'), [...cal])).toBe('diwali')
  expect(festivalOn(new Date('2027-10-30T18:31:00Z'), [...cal])).toBeNull()
})

const SIX = ['diwali', 'gangaur', 'holi', 'jlf', 'sankranti', 'teej']

it('the real calendar covers every festival in 2027', () => {
  const ids = new Set(CALENDAR.filter((e) => e.start.startsWith('2027')).map((e) => e.id))
  expect([...ids].sort()).toEqual(SIX)
})

it('the table still covers 2028 (see the yearly upkeep note in festivals.data.ts)', () => {
  const ids = new Set(CALENDAR.filter((e) => e.start.startsWith('2028')).map((e) => e.id))
  expect([...ids].sort()).toEqual(SIX)
})

it('has well-formed entries', () => {
  for (const e of CALENDAR) {
    // a day, or a day and an IST time; both ends the same kind
    expect(e.start).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
    expect(e.end).toHaveLength(e.start.length)
    expect(e.end > e.start || (e.start.length === 10 && e.end === e.start)).toBe(true)
    // New Year needs no entry: festivalOn works it out every year
    expect(e.id).not.toBe('newyear')
  }
})

describe('New Year: 31 Dec 18:00 to 1 Jan 06:00 IST, every year', () => {
  const on = (iso: string) => festivalOn(new Date(iso), [])

  it('starts at 18:00 IST on the 31st and is over at 06:00 IST on the 1st', () => {
    expect(on('2026-12-31T12:29:59Z')).toBeNull() // 17:59:59 IST on the 31st
    expect(on('2026-12-31T12:30:00Z')).toBe('newyear') // 18:00 IST
    expect(on('2026-12-31T18:30:00Z')).toBe('newyear') // midnight IST
    expect(on('2027-01-01T00:29:59Z')).toBe('newyear') // 05:59:59 IST on the 1st
    expect(on('2027-01-01T00:30:00Z')).toBeNull() // 06:00 IST
    expect(on('2027-01-02T00:00:00Z')).toBeNull() // the next morning
  })

  it('comes round every year, with no table at all', () => {
    for (let y = 2026; y <= 2040; y++) {
      expect(festivalOn(new Date(`${y}-12-31T12:00:00Z`))).toBeNull() // 17:30 IST
      expect(festivalOn(new Date(`${y}-12-31T13:00:00Z`))).toBe('newyear') // 18:30 IST
      expect(festivalOn(new Date(`${y + 1}-01-01T00:00:00Z`))).toBe('newyear') // 05:30 IST
      expect(festivalOn(new Date(`${y + 1}-01-01T01:00:00Z`))).toBeNull() // 06:30 IST
    }
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
})

describe('a table window with times', () => {
  const cal = [
    { id: 'jlf', start: '2027-05-02', end: '2027-05-02' },
    { id: 'diwali', start: '2027-05-01T18:00', end: '2027-05-02T06:00' },
  ] as const

  it('starts at its IST start minute and has ended at its end minute', () => {
    const on = (iso: string) => festivalOn(new Date(iso), [cal[1]])
    expect(on('2027-05-01T12:29:00Z')).toBeNull() // 17:59 IST
    expect(on('2027-05-01T12:30:00Z')).toBe('diwali') // 18:00 IST
    expect(on('2027-05-02T00:29:00Z')).toBe('diwali') // 05:59 IST
    expect(on('2027-05-02T00:30:00Z')).toBeNull() // 06:00 IST
  })

  it('mixes with day entries: where they overlap, the one listed first still wins', () => {
    const both = (iso: string) => festivalOn(new Date(iso), [...cal])
    expect(both('2027-05-01T20:00:00Z')).toBe('jlf') // 01:30 IST on the 2nd: both, and the day entry is first
    expect(both('2027-05-01T13:00:00Z')).toBe('diwali') // 18:30 IST on the 1st: only the timed one
  })
})

describe('festivalForVersion', () => {
  it('gives pages without a version only the first six festivals', () => {
    for (const id of SIX) expect(festivalForVersion(id as FestivalId, 1)).toBe(id)
    expect(festivalForVersion('newyear', 1)).toBeNull()
    expect(festivalForVersion(null, 1)).toBeNull()
  })

  it('gives v2 pages every festival', () => {
    expect(festivalForVersion('newyear', 2)).toBe('newyear')
    expect(festivalForVersion('diwali', 2)).toBe('diwali')
    expect(festivalForVersion('newyear', 3)).toBe('newyear')
  })
})
