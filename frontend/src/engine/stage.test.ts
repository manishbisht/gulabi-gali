// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

const renderer = vi.hoisted(() => ({
  calls: [] as string[],
  antialias: [] as boolean[],
  ratios: [] as number[],
}))
vi.mock('three', async (orig) => {
  const real = await orig<typeof import('three')>()
  class FakeRenderer {
    shadowMap = {}
    domElement: HTMLCanvasElement
    constructor(o: { canvas: HTMLCanvasElement; antialias: boolean }) {
      this.domElement = o.canvas
      renderer.antialias.push(o.antialias)
    }
    setPixelRatio(r: number) {
      renderer.ratios.push(r)
    }
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

vi.mock('../net/errorBeacon', () => ({ beaconError: vi.fn() }))

import { beaconError } from '../net/errorBeacon'
import { clampDelta, createStage } from './stage'

it('clamps frame delta to 0.1s', () => {
  expect(clampDelta(16)).toBeCloseTo(0.016)
  expect(clampDelta(5 * 60_000)).toBe(0.1) // back from background
  expect(clampDelta(-5)).toBe(0)
  expect(clampDelta(NaN)).toBe(0) // a bad timestamp must not poison every position with NaN
  expect(clampDelta(Infinity)).toBe(0)
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
  expect(beaconError).toHaveBeenCalledWith('webgl-lost', 'WebGL context lost')
  stage.dispose()
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
  expect(beaconError).toHaveBeenCalledTimes(1)
})

describe('a test page', () => {
  beforeEach(() => {
    renderer.antialias.length = renderer.ratios.length = 0
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    history.replaceState(null, '', '/')
  })

  it('draws a sixteenth of the pixels, without antialiasing, so software WebGL keeps up', () => {
    vi.stubEnv('VITE_TEST_HOOKS', '1')
    history.replaceState(null, '', '/?gg-test=1')
    const stage = createStage(document.createElement('canvas'))
    expect(renderer.antialias).toEqual([false])
    expect(renderer.ratios.at(-1)).toBe(0.25)
    stage.dispose()
  })

  it('draws in full anywhere else', () => {
    vi.stubEnv('VITE_TEST_HOOKS', '')
    history.replaceState(null, '', '/?gg-test=1')
    vi.stubGlobal('devicePixelRatio', 2)
    const stage = createStage(document.createElement('canvas'))
    expect(renderer.antialias).toEqual([true])
    expect(renderer.ratios.at(-1)).toBe(2)
    stage.dispose()
  })
})

describe('adaptive quality', () => {
  function run(frameMs: number, frames: number, startQuality?: string) {
    sessionStorage.clear()
    if (startQuality) sessionStorage.setItem('gg-quality', startQuality)
    const queue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const stage = createStage(document.createElement('canvas'))
    const tiers: number[] = []
    stage.onQuality((q) => tiers.push(q))
    let now = 0
    for (let i = 0; i < frames; i++) {
      now += frameMs
      queue.shift()!(now)
    }
    return { stage, tiers }
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('steps one tier down after ~2.5 s of slow frames, and remembers it for the tab session', () => {
    const { stage, tiers } = run(40, 70) // 70 x 40 ms = 2.8 s at 25 fps
    expect(tiers).toEqual([1])
    expect(stage.quality).toBe(1)
    expect(sessionStorage.getItem('gg-quality')).toBe('1')
    stage.dispose()
  })

  it('keeps its tier when frames are fast, or the slowness is only a stall', () => {
    expect(run(16, 400).tiers).toEqual([])
    expect(run(300, 40).tiers).toEqual([]) // 250 ms+ frames are a tab coming back, not a slow device
  })

  it('never steps below the lowest tier, and starts where the session left off', () => {
    const low = run(40, 200, '0')
    expect(low.stage.quality).toBe(0)
    expect(low.tiers).toEqual([])
    expect(run(16, 5, '1').stage.quality).toBe(1)
  })

  it('dispose frees the sky backdrop texture', () => {
    const { stage } = run(16, 1)
    const texture = new THREE.CanvasTexture(document.createElement('canvas'))
    const disposed = vi.fn()
    texture.addEventListener('dispose', disposed)
    stage.scene.background = texture
    stage.dispose()
    expect(disposed).toHaveBeenCalled()
  })
})
