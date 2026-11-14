// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { hasWebGL } from './webgl'

afterEach(() => vi.restoreAllMocks())

/** A canvas whose `getContext` answers only for the kinds listed. */
function stubContexts(available: string[]) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
    available.includes(kind) ? { getExtension: () => null } : null) as never)
}

it('needs WebGL2: a browser with only WebGL1 gets the no-3D screen', () => {
  stubContexts(['webgl'])
  expect(hasWebGL()).toBe(false)
})

it('accepts a browser with WebGL2', () => {
  stubContexts(['webgl2'])
  expect(hasWebGL()).toBe(true)
})
