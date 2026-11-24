import { expect, it } from 'vitest'
import type { CitySnapshot } from '../net/protocol'
import { cityLine } from './cityLine'

const base = { aqiBand: 'good', condition: 'clear', tempC: 30, stale: false } as CitySnapshot

it('rain beats heat beats air in the city line', () => {
  expect(cityLine({ ...base, condition: 'rain', tempC: 44, aqiBand: 'severe' }, 'hi')).toBe(
    'Baarish! Pakode ka time.',
  )
  expect(cityLine({ ...base, condition: 'storm' }, 'en')).toBe("It's raining! Pakora time.")
  expect(cityLine({ ...base, tempC: 44, aqiBand: 'severe' }, 'hi')).toBe(
    'Lu chal rahi hai, Hukum. Paani peete raho.',
  )
})

it('dust beats heat', () => {
  expect(cityLine({ ...base, condition: 'dust', tempC: 44 }, 'hi')).toBe(
    'Aandhi aa rahi hai — aankhein bachao.',
  )
})

it('speaks the air band otherwise, in either language', () => {
  expect(cityLine(base, 'en')).toBe('Clear air — you can see Nahargarh.')
  expect(cityLine({ ...base, aqiBand: 'moderate' }, 'hi')).toBe('Hawa theek-thaak hai. Chai pe chalo?')
  expect(cityLine({ ...base, aqiBand: 'poor' }, 'en')).toBe('A bit hazy today. Keep a mask handy.')
  for (const aqiBand of ['unhealthy', 'severe'] as const) {
    expect(cityLine({ ...base, aqiBand }, 'hi')).toBe('Hawa kharab hai, Hukum — ghar pe raho.')
  }
})

it('keeps every line short enough for one row of the HUD card on a 360 px phone', () => {
  // an orphaned last word costs a row of the top block; 44 characters is the festival procession line's length
  const snaps: CitySnapshot[] = [
    ...(['good', 'moderate', 'poor', 'unhealthy', 'severe'] as const).map((aqiBand) => ({
      ...base,
      aqiBand,
    })),
    { ...base, condition: 'rain' },
    { ...base, condition: 'dust' },
    { ...base, tempC: 44 },
  ]
  for (const s of snaps)
    for (const lang of ['hi', 'en'] as const) {
      expect(cityLine(s, lang).length).toBeLessThanOrEqual(44)
      expect(cityLine(s, lang, WINTER_DAWN).length).toBeLessThanOrEqual(44)
    }
})

/** 07:00 IST on 10 January: the winter mist at its thickest. */
const WINTER_DAWN = new Date('2027-01-10T07:00:00+05:30')

it('speaks of the mist on a winter morning, over clean or middling air', () => {
  expect(cityLine(base, 'hi', WINTER_DAWN)).toBe('Kohre wali subah — garam chai ka time.')
  expect(cityLine({ ...base, aqiBand: 'moderate' }, 'en', WINTER_DAWN)).toBe(
    'A foggy winter morning. Hot chai weather.',
  )
  // by mid-morning, in the afternoon and outside winter, the air speaks again
  for (const at of ['2027-01-10T10:30:00+05:30', '2027-01-10T15:00:00+05:30', '2027-04-10T07:00:00+05:30'])
    expect(cityLine(base, 'en', new Date(at))).toBe('Clear air — you can see Nahargarh.')
  // without a clock, as before
  expect(cityLine(base, 'en')).toBe('Clear air — you can see Nahargarh.')
})

it('keeps hazy or bad air, rain, dust and heat ahead of the mist', () => {
  expect(cityLine({ ...base, aqiBand: 'poor' }, 'en', WINTER_DAWN)).toBe(
    'A bit hazy today. Keep a mask handy.',
  )
  expect(cityLine({ ...base, aqiBand: 'severe' }, 'hi', WINTER_DAWN)).toBe(
    'Hawa kharab hai, Hukum — ghar pe raho.',
  )
  expect(cityLine({ ...base, condition: 'rain' }, 'en', WINTER_DAWN)).toBe("It's raining! Pakora time.")
})

it('never counts a missing temperature as heat', () => {
  expect(cityLine({ ...base, tempC: null }, 'en')).toBe('Clear air — you can see Nahargarh.')
  expect(cityLine({ ...base, tempC: undefined } as unknown as CitySnapshot, 'en')).toContain('Clear air')
  expect(cityLine({ ...base, tempC: 42 }, 'en')).toBe('Heatwave out there. Keep drinking water.')
  expect(cityLine({ ...base, tempC: 41.9 }, 'en')).toContain('Clear air')
})
