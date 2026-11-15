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

it('a write that failed (a full disk) is still what get answers, not the older value left in localStorage', () => {
  const held = new Map<string, string>([['gg-full', 'old']])
  let full = false
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (full) throw new DOMException('quota', 'QuotaExceededError')
      held.set(k, v)
    },
  })
  storage.set('gg-full', 'fine')
  expect(storage.get('gg-full')).toBe('fine')
  full = true
  storage.set('gg-full', 'new') // refused by the disk, kept by the page
  expect(held.get('gg-full')).toBe('fine')
  expect(storage.get('gg-full')).toBe('new')
  full = false
  storage.set('gg-full', 'newer') // the disk takes it again, and is the one to ask
  expect(held.get('gg-full')).toBe('newer')
  expect(storage.get('gg-full')).toBe('newer')
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
