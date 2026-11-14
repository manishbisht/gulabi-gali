import { expect, it } from 'vitest'
import { clampDelta } from './stage'

it('clamps frame delta to 0.1s', () => {
  expect(clampDelta(16)).toBeCloseTo(0.016)
  expect(clampDelta(5 * 60_000)).toBe(0.1) // back from background
  expect(clampDelta(-5)).toBe(0)
})
