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
  expect(cityLine(base, 'en')).toBe('Clear air today. You can see all the way to Nahargarh.')
  expect(cityLine({ ...base, aqiBand: 'moderate' }, 'hi')).toBe('Hawa theek-thaak hai. Chai pe chalo?')
  expect(cityLine({ ...base, aqiBand: 'poor' }, 'en')).toBe('A bit hazy today. Keep a mask handy.')
  for (const aqiBand of ['unhealthy', 'severe'] as const) {
    expect(cityLine({ ...base, aqiBand }, 'hi')).toBe('Hawa kharab hai, Hukum — aaj andar hi raho.')
  }
})

it('never counts a missing temperature as heat', () => {
  expect(cityLine({ ...base, tempC: null }, 'en')).toBe(
    'Clear air today. You can see all the way to Nahargarh.',
  )
  expect(cityLine({ ...base, tempC: undefined } as unknown as CitySnapshot, 'en')).toContain('Clear air')
  expect(cityLine({ ...base, tempC: 42 }, 'en')).toBe('Heatwave out there. Keep drinking water.')
  expect(cityLine({ ...base, tempC: 41.9 }, 'en')).toContain('Clear air')
})
