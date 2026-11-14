import { afterEach, expect, it, vi } from 'vitest'
import { storage } from './storage'

afterEach(() => vi.unstubAllGlobals())

it('storage survives a throwing localStorage', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    },
  })
  storage.set('gg-x', '1')
  expect(storage.get('gg-x')).toBe('1') // from memory
  expect(storage.getJSON('gg-missing', [])).toEqual([])
})

it('getJSON falls back on unparseable values', () => {
  vi.stubGlobal('localStorage', { getItem: () => '{nope', setItem: () => {} })
  expect(storage.getJSON('gg-bad', { a: 1 })).toEqual({ a: 1 })
})
