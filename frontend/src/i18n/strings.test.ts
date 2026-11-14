import { expect, it } from 'vitest'
import { STRINGS, t } from './strings'

it('every string has Hinglish and English', () => {
  for (const [key, v] of Object.entries(STRINGS)) {
    expect(v.hi.trim(), key).not.toBe('')
    expect(v.en.trim(), key).not.toBe('')
  }
})

it('interpolates vars', () =>
  expect(t('stampGot', 'en', { place: 'Hawa Mahal' })).toBe('Stamp collected: Hawa Mahal'))

it('interpolates vars in Hinglish', () =>
  expect(t('stampGot', 'hi', { place: 'Hawa Mahal' })).toBe('Jaipur Darshan · stamp mila: Hawa Mahal'))
