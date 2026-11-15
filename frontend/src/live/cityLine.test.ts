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
    for (const lang of ['hi', 'en'] as const) expect(cityLine(s, lang).length).toBeLessThanOrEqual(44)
})

it('never counts a missing temperature as heat', () => {
  expect(cityLine({ ...base, tempC: null }, 'en')).toBe('Clear air — you can see Nahargarh.')
  expect(cityLine({ ...base, tempC: undefined } as unknown as CitySnapshot, 'en')).toContain('Clear air')
  expect(cityLine({ ...base, tempC: 42 }, 'en')).toBe('Heatwave out there. Keep drinking water.')
  expect(cityLine({ ...base, tempC: 41.9 }, 'en')).toContain('Clear air')
})
