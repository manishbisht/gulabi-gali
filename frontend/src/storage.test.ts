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

it('clear forgets what the page-lifetime map holds too', () => {
  const held = new Map<string, string>()
  const fake = {
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => void held.set(k, v),
    clear: () => held.clear(),
  }
  vi.stubGlobal('localStorage', fake)
  storage.set('gg-clear', '1')
  fake.clear() // what a test used to do: the map still answers
  expect(storage.get('gg-clear')).toBe('1')
  storage.clear()
  expect(storage.get('gg-clear')).toBeNull()
})
