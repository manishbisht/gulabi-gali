// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createZoomGestures } from './zoomGestures'

let off: (() => void) | undefined
afterEach(() => {
  off?.()
  off = undefined
})

function setup() {
  const canvas = document.body.appendChild(document.createElement('canvas'))
  const controls = { addZoom: vi.fn() }
  const gestures = createZoomGestures(canvas, controls)
  off = () => {
    gestures.dispose()
    canvas.remove()
  }
  const fire = (type: string, pointerId: number, x: number, y = 50) =>
    canvas.dispatchEvent(Object.assign(new Event(type), { pointerId, clientX: x, clientY: y, button: 0 }))
  const wheel = (deltaY: number, deltaMode = 0) => {
    const e = Object.assign(new Event('wheel', { cancelable: true }), { deltaY, deltaMode })
    canvas.dispatchEvent(e)
    return e
  }
  /** Every zoom asked for so far, multiplied together. */
  const zoomed = () => controls.addZoom.mock.calls.reduce((k, [f]) => k * f, 1)
  return { canvas, controls, gestures, fire, wheel, zoomed }
}

it('the wheel rolled toward you zooms out, away zooms in, and the page does not scroll', () => {
  const { wheel, zoomed, controls } = setup()
  const e = wheel(100)
  expect(e.defaultPrevented).toBe(true)
  expect(zoomed()).toBeGreaterThan(1.05)
  expect(zoomed()).toBeLessThan(1.3) // a notch is a step, not the whole range
  controls.addZoom.mockClear()
  wheel(-100)
  expect(zoomed()).toBeLessThan(1)
  // a wheel that counts in lines (Firefox) zooms about as far as one that counts in pixels
  controls.addZoom.mockClear()
  wheel(3, 1)
  expect(zoomed()).toBeGreaterThan(1.05)
  expect(zoomed()).toBeLessThan(1.3)
  controls.addZoom.mockClear()
  wheel(0) // a sideways scroll: nothing
  expect(controls.addZoom).not.toHaveBeenCalled()
})

it('two fingers spreading on the canvas zoom in, by how far apart they move; pinching zooms out', () => {
  const { fire, zoomed, controls } = setup()
  fire('pointerdown', 1, 10)
  fire('pointermove', 1, 40) // alone, a look: no zoom, but the pinch starts from here
  expect(controls.addZoom).not.toHaveBeenCalled()
  fire('pointerdown', 2, 60)
  fire('pointermove', 2, 80) // 20 px apart to 40
  expect(zoomed()).toBeCloseTo(0.5)
  fire('pointermove', 1, 60) // 40 to 20
  expect(zoomed()).toBeCloseTo(1)
  controls.addZoom.mockClear()
  // one finger lifts: the other alone is a look, not a zoom
  fire('pointerup', 2, 80)
  fire('pointermove', 1, 10)
  expect(controls.addZoom).not.toHaveBeenCalled()
})

it('one finger or a mouse never zooms, and a lost pointer or a blur ends the pinch', () => {
  const { fire, controls } = setup()
  fire('pointerdown', 1, 40)
  fire('pointermove', 1, 90)
  expect(controls.addZoom).not.toHaveBeenCalled()
  fire('pointerdown', 2, 60)
  fire('pointercancel', 2, 60)
  fire('pointermove', 1, 20)
  expect(controls.addZoom).not.toHaveBeenCalled()
  fire('pointerdown', 3, 60)
  window.dispatchEvent(new Event('blur'))
  fire('pointermove', 3, 90)
  expect(controls.addZoom).not.toHaveBeenCalled()
})

it('dispose takes all eight listeners off: six on the canvas, the blur on the window, the hiding on the page', () => {
  const { canvas, gestures, fire, wheel, controls } = setup()
  const listeners = (target: EventTarget) => {
    const added = vi.mocked(target.addEventListener).mock.calls.map(([type, fn]) => [type, fn])
    const removed = vi.mocked(target.removeEventListener).mock.calls.map(([type, fn]) => [type, fn])
    return { added, removed }
  }
  for (const t of [canvas, window, document]) {
    vi.spyOn(t, 'addEventListener')
    vi.spyOn(t, 'removeEventListener')
  }
  // a fresh set, so the spies saw every add
  const again = createZoomGestures(canvas, controls)
  again.dispose()
  const onCanvas = listeners(canvas)
  expect(onCanvas.added.map(([type]) => type).sort()).toEqual(
    ['lostpointercapture', 'pointercancel', 'pointerdown', 'pointermove', 'pointerup', 'wheel'].sort(),
  )
  expect(onCanvas.removed).toEqual(expect.arrayContaining(onCanvas.added))
  expect(listeners(window).added.map(([type]) => type)).toEqual(['blur'])
  expect(listeners(window).removed).toEqual(expect.arrayContaining(listeners(window).added))
  expect(listeners(document).added.map(([type]) => type)).toEqual(['visibilitychange'])
  expect(listeners(document).removed).toEqual(expect.arrayContaining(listeners(document).added))
  vi.restoreAllMocks()
  gestures.dispose()
  wheel(100)
  fire('pointerdown', 1, 40)
  fire('pointerdown', 2, 60)
  fire('pointermove', 2, 80)
  expect(controls.addZoom).not.toHaveBeenCalled()
})
