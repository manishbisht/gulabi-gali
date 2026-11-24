// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { festivalOverride, todayOverride } from './overrides'

const KNOWN = { sankranti: 1, gangaur: 1 }

afterEach(() => {
  vi.unstubAllEnvs()
  history.replaceState(null, '', '/')
})

it('a production build ignores gg-festival and gg-today, even with gg-test=1', () => {
  vi.stubEnv('VITE_TEST_HOOKS', '')
  history.replaceState(null, '', '/?gg-test=1&gg-festival=gangaur&gg-today=photo')
  expect(festivalOverride(KNOWN)).toBeNull()
  expect(todayOverride()).toBeNull()
})

it('the e2e build takes them with gg-test=1 only, and only for a festival or goal that exists', () => {
  vi.stubEnv('VITE_TEST_HOOKS', '1')
  history.replaceState(null, '', '/?gg-test=1&gg-festival=gangaur&gg-today=darshan:jkk')
  expect(festivalOverride(KNOWN)).toBe('gangaur')
  expect(todayOverride()).toEqual({ id: 'darshan:jkk', kind: 'darshan', stamp: 'jkk' })
  history.replaceState(null, '', '/?gg-festival=gangaur&gg-today=photo')
  expect(festivalOverride(KNOWN)).toBeNull()
  expect(todayOverride()).toBeNull()
  history.replaceState(null, '', '/?gg-test=1&gg-festival=diwali-ish&gg-today=greet')
  expect(festivalOverride(KNOWN)).toBeNull()
  expect(todayOverride()).toBeNull()
})
