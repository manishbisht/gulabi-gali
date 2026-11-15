// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { installTestHooks, testRenderLite } from './testHooks'

afterEach(() => {
  vi.unstubAllEnvs()
  history.replaceState(null, '', '/')
  delete (window as { __gg?: unknown }).__gg
})

it('turns test mode on for gg-test=1 only, not gg-test=10', () => {
  vi.stubEnv('VITE_TEST_HOOKS', '1')
  history.replaceState(null, '', '/?gg-test=10')
  installTestHooks({ quality: () => 2 })
  expect(window.__gg).toBeUndefined()
  history.replaceState(null, '', '/?gg-test=1')
  installTestHooks({ quality: () => 2 })
  expect(window.__gg.quality()).toBe(2)
})

it('does nothing in a build without VITE_TEST_HOOKS, whatever the URL says', () => {
  vi.stubEnv('VITE_TEST_HOOKS', '')
  history.replaceState(null, '', '/?gg-test=1')
  installTestHooks({ quality: () => 2 })
  expect(window.__gg).toBeUndefined()
})

it('draws lite on a test page unless gg-full=1 asks for the real thing, and never outside the test build', () => {
  vi.stubEnv('VITE_TEST_HOOKS', '1')
  history.replaceState(null, '', '/?gg-test=1')
  expect(testRenderLite()).toBe(true)
  history.replaceState(null, '', '/?gg-test=1&gg-full=1') // the device perf run measures the real cost
  expect(testRenderLite()).toBe(false)
  history.replaceState(null, '', '/')
  expect(testRenderLite()).toBe(false)
  vi.stubEnv('VITE_TEST_HOOKS', '')
  history.replaceState(null, '', '/?gg-test=1')
  expect(testRenderLite()).toBe(false)
})
