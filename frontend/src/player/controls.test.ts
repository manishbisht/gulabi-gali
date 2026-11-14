import { afterEach, describe, expect, it } from 'vitest'
import { createControls, type Controls } from './controls'

/** A minimal Window stand-in: just enough EventTarget to carry key events. */
function fakeWindow() {
  return new EventTarget() as unknown as Window
}
function press(w: Window, code: string, type: 'keydown' | 'keyup' = 'keydown') {
  const e = new Event(type, { cancelable: true }) as Event & { code: string }
  e.code = code
  w.dispatchEvent(e)
}

let controls: Controls | undefined
afterEach(() => controls?.dispose())

describe('createControls', () => {
  it('normalises diagonal keyboard input', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    press(w, 'KeyW')
    press(w, 'KeyD')
    const v = c.move()
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1)
    expect(v.x).toBeGreaterThan(0)
    expect(v.z).toBeGreaterThan(0)
  })

  it('maps WASD and arrows, and releasing a key stops it', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    press(w, 'ArrowLeft')
    expect(c.move()).toEqual({ x: -1, z: 0 })
    press(w, 'ArrowLeft', 'keyup')
    press(w, 'KeyS')
    expect(c.move()).toEqual({ x: 0, z: -1 })
    press(w, 'KeyS', 'keyup')
    expect(c.move()).toEqual({ x: 0, z: 0 })
  })

  it('opposite keys cancel out', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    press(w, 'KeyA')
    press(w, 'KeyD')
    expect(c.move()).toEqual({ x: 0, z: 0 })
  })

  it('joystick magnitude is kept (walk slowly with a small push)', () => {
    const c = (controls = createControls(fakeWindow()))
    c.setJoystick({ x: 0, z: 0.3 })
    expect(c.move()).toEqual({ x: 0, z: 0.3 })
  })

  it('clamps an over-long joystick vector to length 1', () => {
    const c = (controls = createControls(fakeWindow()))
    c.setJoystick({ x: 3, z: 4 })
    const v = c.move()
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1)
  })

  it('interact() fires once per E press', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    expect(c.interact()).toBe(false)
    press(w, 'KeyE')
    expect(c.interact()).toBe(true)
    expect(c.interact()).toBe(false)
  })

  it('stops listening after dispose', () => {
    const w = fakeWindow()
    const c = createControls(w)
    c.dispose()
    press(w, 'KeyW')
    expect(c.move()).toEqual({ x: 0, z: 0 })
  })
})
