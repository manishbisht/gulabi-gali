import { expect, it } from 'vitest'
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
  expect([...ids].sort()).toEqual(['diwali', 'gangaur', 'holi', 'jlf', 'sankranti', 'teej'])
})

it('has well-formed entries', () => {
  for (const e of CALENDAR) {
    expect(e.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(e.end >= e.start).toBe(true)
  }
})
