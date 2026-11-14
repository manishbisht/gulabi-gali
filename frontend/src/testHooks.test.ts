// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { installTestHooks } from './testHooks'

afterEach(() => {
  history.replaceState(null, '', '/')
  delete (window as { __gg?: unknown }).__gg
})

it('turns test mode on for gg-test=1 only, not gg-test=10', () => {
  history.replaceState(null, '', '/?gg-test=10')
  installTestHooks({ quality: () => 2 })
  expect(window.__gg).toBeUndefined()
  history.replaceState(null, '', '/?gg-test=1')
  installTestHooks({ quality: () => 2 })
  expect(window.__gg.quality()).toBe(2)
})
