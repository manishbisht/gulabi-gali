// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
import type { LandmarkDef } from './types'

type Stamps = typeof import('./stamps')
let stamps: Stamps

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules() // storage keeps an in-memory fallback map, so start from a fresh copy
  stamps = await import('./stamps')
})

it('collects once and persists', () => {
  expect(stamps.collect('hawa-mahal')).toBe(true)
  expect(stamps.collect('hawa-mahal')).toBe(false)
  expect(stamps.collected()).toEqual(['hawa-mahal'])
  expect(JSON.parse(localStorage.getItem('gg-stamps')!)).toEqual(['hawa-mahal'])
})

it('starts empty and ignores a corrupt save', () => {
  expect(stamps.collected()).toEqual([])
  localStorage.setItem('gg-stamps', '{"oops":1}')
  expect(stamps.collected()).toEqual([])
})

it('counts each known stamp once: a save with repeats or ids this page does not know cannot inflate the HUD', () => {
  localStorage.setItem('gg-stamps', JSON.stringify(['jkk', 'jkk', 'taj-mahal', 7, 'hawa-mahal', 'jkk']))
  expect(stamps.collected()).toEqual(['jkk', 'hawa-mahal'])
  expect(stamps.collect('jkk')).toBe(false)
  expect(stamps.collect('wtp')).toBe(true)
  expect(stamps.collected()).toEqual(['jkk', 'hawa-mahal', 'wtp'])
})

it("merges another device's stamps in after the local ones, known stamps only, once each", () => {
  stamps.collect('jkk')
  expect(stamps.mergeStamps(['hawa-mahal', 'jkk', 'taj-mahal', 'hawa-mahal'])).toBe(true)
  expect(stamps.collected()).toEqual(['jkk', 'hawa-mahal'])
  expect(JSON.parse(localStorage.getItem('gg-stamps')!)).toEqual(['jkk', 'hawa-mahal'])
  // nothing new: nothing written, and it says so
  expect(stamps.mergeStamps(['hawa-mahal'])).toBe(false)
  expect(stamps.collected()).toEqual(['jkk', 'hawa-mahal'])
})

it('names a stamp in either language, and knows how many there are', () => {
  expect(stamps.TOTAL_STAMPS).toBe(9)
  expect(stamps.stampName('university-gate', 'hi')).toBe('Rajasthan University')
  expect(stamps.stampName('university-gate', 'en')).toBe('University of Rajasthan')
})

it('finds the landmark only inside its radius', () => {
  const l = { id: 'x', at: { x: 10, z: 0 }, radius: 6 } as LandmarkDef
  expect(stamps.nearestLandmark({ x: 5, z: 0 }, [l])?.id).toBe('x')
  expect(stamps.nearestLandmark({ x: 3, z: 0 }, [l])).toBeNull()
})

it('picks the closest when rings overlap', () => {
  const a = { id: 'a', at: { x: 0, z: 0 }, radius: 10 } as LandmarkDef
  const b = { id: 'b', at: { x: 8, z: 0 }, radius: 10 } as LandmarkDef
  expect(stamps.nearestLandmark({ x: 6, z: 0 }, [a, b])?.id).toBe('b')
})
