// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'

const renderer = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('three', async (orig) => {
  const real = await orig<typeof import('three')>()
  class FakeRenderer {
    shadowMap = {}
    domElement: HTMLCanvasElement
    constructor(o: { canvas: HTMLCanvasElement }) {
      this.domElement = o.canvas
    }
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {
      renderer.calls.push('dispose')
    }
    forceContextLoss() {
      renderer.calls.push('forceContextLoss')
    }
  }
  return { ...real, WebGLRenderer: FakeRenderer }
})

vi.mock('../net/errorBeacon', () => ({ reportError: vi.fn() }))

import { reportError } from '../net/errorBeacon'
import { clampDelta, createStage } from './stage'

it('clamps frame delta to 0.1s', () => {
  expect(clampDelta(16)).toBeCloseTo(0.016)
  expect(clampDelta(5 * 60_000)).toBe(0.1) // back from background
  expect(clampDelta(-5)).toBe(0)
})

it('dispose releases the WebGL context', () => {
  const canvas = { addEventListener() {}, removeEventListener() {}, clientWidth: 1, clientHeight: 1 }
  const stage = createStage(canvas as unknown as HTMLCanvasElement)
  stage.dispose()
  expect(renderer.calls).toContain('forceContextLoss')
  stage.dispose() // idempotent
  expect(renderer.calls.filter((c) => c === 'forceContextLoss')).toHaveLength(1)
})

it('a lost WebGL context goes to the error beacon, and our own dispose does not', () => {
  const canvas = document.createElement('canvas')
  const stage = createStage(canvas)
  const lost = new Event('webglcontextlost', { cancelable: true })
  canvas.dispatchEvent(lost)
  expect(lost.defaultPrevented).toBe(true)
  expect(reportError).toHaveBeenCalledWith('webgl-lost', 'WebGL context lost')
  stage.dispose()
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
  expect(reportError).toHaveBeenCalledTimes(1)
})
