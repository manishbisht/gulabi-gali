// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

const renderer = vi.hoisted(() => ({
  calls: [] as string[],
  antialias: [] as boolean[],
  ratios: [] as number[],
  lost: false,
  /** Set to make the context report lost from the next render on. */
  loseOnRender: false,
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
    getContext() {
      return { isContextLost: () => renderer.lost }
    }
    render() {
      renderer.calls.push('render')
      if (renderer.loseOnRender) renderer.lost = true
    }
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

describe('capture', () => {
  beforeEach(() => {
    renderer.ratios.length = 0
    renderer.calls.length = 0
    renderer.lost = renderer.loseOnRender = false
    vi.stubGlobal('devicePixelRatio', 3)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('draws one frame at the device ratio, hands the canvas over, then goes back to the tier ratio', () => {
    sessionStorage.setItem('gg-quality', '0')
    const canvas = document.createElement('canvas')
    const stage = createStage(canvas)
    renderer.calls.length = 0
    renderer.ratios.length = 0
    const seen: unknown[] = []
    const out = stage.capture((c) => {
      seen.push(c, renderer.calls.slice())
      return 'png'
    })
    expect(out).toBe('png')
    expect(seen).toEqual([canvas, ['render']]) // read right after the one render, in the same task
    expect(renderer.ratios).toEqual([3, 1]) // the lowest tier draws at 1; the photo does not
    stage.dispose()
  })

  it('hides what is marked noPhoto for the one render, and shows it again after, even when reading throws', () => {
    const stage = createStage(document.createElement('canvas'))
    const wall = new THREE.Mesh()
    wall.userData.noPhoto = true
    const hiddenAlready = new THREE.Mesh()
    hiddenAlready.userData.noPhoto = true
    hiddenAlready.visible = false
    stage.scene.add(wall, hiddenAlready)
    let seen: boolean[] = []
    const draw = () => (seen = [wall.visible, hiddenAlready.visible])
    const origRender = vi.spyOn(THREE.WebGLRenderer.prototype, 'render').mockImplementation(draw)
    stage.capture(() => 'x')
    expect(seen).toEqual([false, false])
    expect([wall.visible, hiddenAlready.visible]).toEqual([true, false])
    expect(() =>
      stage.capture(() => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect([wall.visible, hiddenAlready.visible]).toEqual([true, false])
    origRender.mockRestore()
    stage.dispose()
  })

  it('throws, and reads nothing, when the context is lost before, or the stage is gone', () => {
    const canvas = document.createElement('canvas')
    const stage = createStage(canvas)
    const read = vi.fn(() => 'png')
    renderer.lost = true
    expect(() => stage.capture(read)).toThrow(/lost/)
    renderer.lost = false
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    expect(() => stage.capture(read)).toThrow(/lost/)
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    stage.dispose()
    expect(() => stage.capture(read)).toThrow()
    expect(read).not.toHaveBeenCalled()
  })

  it('throws, and reads nothing, when the context is lost by the bigger buffer itself', () => {
    const stage = createStage(document.createElement('canvas'))
    renderer.loseOnRender = true
    const read = vi.fn(() => 'png')
    expect(() => stage.capture(read)).toThrow(/lost/)
    expect(read).not.toHaveBeenCalled()
    stage.dispose()
  })

  it('goes back to the tier ratio even when the window reports no size', () => {
    sessionStorage.setItem('gg-quality', '1')
    const stage = createStage(document.createElement('canvas'))
    renderer.ratios.length = 0
    vi.stubGlobal('innerWidth', 0)
    stage.capture(() => 'x')
    expect(renderer.ratios).toEqual([3, 1.25])
    stage.dispose()
  })

  it('puts the ratio back when reading throws', () => {
    sessionStorage.setItem('gg-quality', '2')
    const stage = createStage(document.createElement('canvas'))
    renderer.ratios.length = 0
    expect(() =>
      stage.capture(() => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(renderer.ratios).toEqual([3, 2])
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
  })

  it('steps down on a phone that really crawls: 300 to 600 ms frames, within a few seconds', () => {
    for (const ms of [300, 450, 600, 2000]) {
      const { stage, tiers } = run(ms, Math.ceil(2500 / Math.min(ms, 600))) // one window, no more
      expect(tiers, `${ms} ms frames`).toEqual([1])
      expect(sessionStorage.getItem('gg-quality')).toBe('1')
      stage.dispose()
    }
  })

  it('does not step down for one hitch: a tab switch, a GC pause, a district load', () => {
    const queue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    vi.spyOn(performance, 'now').mockReturnValue(0)
    sessionStorage.clear()
    const stage = createStage(document.createElement('canvas'))
    let now = 0
    const frame = (ms: number) => queue.shift()!((now += ms))
    for (let i = 0; i < 400; i++) {
      // a hitch of 2 s, then 30 s, then a hitch right at the start of a fresh window
      frame(i === 50 ? 2000 : i === 150 ? 30_000 : i % 100 === 0 ? 700 : 16)
    }
    expect(stage.quality).toBe(2)
    expect(sessionStorage.getItem('gg-quality')).not.toBe('1')
    stage.dispose()
  })

  it('does not step down for a few hitches in a row either', () => {
    const queue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    vi.spyOn(performance, 'now').mockReturnValue(0)
    sessionStorage.clear()
    const stage = createStage(document.createElement('canvas'))
    let now = 0
    // two long frames and nothing else for a window's length: not enough slow frames to call it sustained
    for (const ms of [2000, 2000, 16, 16]) queue.shift()!((now += ms))
    expect(stage.quality).toBe(2)
    stage.dispose()
  })

  it('counts game time as the clamped dts, so slow frames run behind the wall clock', () => {
    const fast = run(16, 100) // 1.6 s of wall time, all of it game time
    expect(fast.stage.gameTime()).toBeCloseTo(1.6, 5)
    fast.stage.dispose()
    const slow = run(400, 10) // 4 s of wall time, 0.1 s a frame
    expect(slow.stage.gameTime()).toBeCloseTo(1, 5)
    slow.stage.dispose()
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
