import { afterEach, describe, expect, it } from 'vitest'
import { createControls, rimJog, type Controls } from './controls'

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

  it('ignores keys typed into a text field (a bench chat line is not a walk)', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    for (const [code, tagName] of [
      ['KeyW', 'INPUT'],
      ['KeyE', 'TEXTAREA'],
    ]) {
      const e = new Event('keydown') as Event & { code: string }
      e.code = code!
      Object.defineProperty(e, 'target', { value: { tagName } })
      w.dispatchEvent(e)
    }
    expect(c.move()).toEqual({ x: 0, z: 0 })
    expect(c.interact()).toBe(false)
    press(w, 'KeyE') // and outside one, E still works
    expect(c.interact()).toBe(true)
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

  it('Space is the horn, once per press', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    expect(c.horn()).toBe(false)
    press(w, 'Space')
    press(w, 'Space') // held: the key repeats
    expect(c.horn()).toBe(true)
    expect(c.horn()).toBe(false)
  })

  it('drive() keeps the keyboard diagonal at full throttle and full lock, and reuses its answer', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    press(w, 'KeyW')
    press(w, 'KeyD')
    const a = c.drive()
    expect(a).toEqual({ x: 1, z: 1 })
    expect(c.drive()).toBe(a) // no allocation per frame
    c.setJoystick({ x: 0, z: 0.7 })
    expect(c.drive().z).toBe(1) // two thirds up is already full throttle
    c.setJoystick({ x: 0.3, z: -0.2 })
    expect(c.drive().z).toBeCloseTo(-0.3)
    expect(c.drive().x).toBeCloseTo(0.3)
  })

  it('while driving, Space is the horn alone: it presses no focused button, but still types into a field', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    const space = (type: 'keydown' | 'keyup', tagName = 'BUTTON') => {
      const e = new Event(type, { cancelable: true }) as Event & { code: string }
      e.code = 'Space'
      Object.defineProperty(e, 'target', { value: { tagName } })
      w.dispatchEvent(e)
      return e.defaultPrevented
    }
    // on foot, Space on a focused button presses it as ever
    expect(space('keydown')).toBe(false)
    expect(space('keyup')).toBe(false)
    c.holdSpace(true)
    expect(space('keydown')).toBe(true)
    expect(space('keyup')).toBe(true)
    expect(c.horn()).toBe(true)
    // typing a line is typing, at the wheel or not
    expect(space('keydown', 'INPUT')).toBe(false)
    expect(space('keydown', 'TEXTAREA')).toBe(false)
    // another key is left alone
    const e = new Event('keydown', { cancelable: true }) as Event & { code: string }
    e.code = 'Enter'
    w.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    c.holdSpace(false)
    expect(space('keydown')).toBe(false)
  })

  it('frozen for a minigame: no walking, no driving, no E or horn, until it thaws', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    press(w, 'KeyW')
    c.setJoystick({ x: 0, z: 1 })
    c.freeze(true)
    press(w, 'KeyE')
    press(w, 'Space')
    expect(c.move()).toEqual({ x: 0, z: 0 })
    expect(c.drive()).toEqual({ x: 0, z: 0 })
    expect(c.interact()).toBe(false)
    expect(c.horn()).toBe(false)
    c.freeze(false)
    expect(c.interact()).toBe(false) // the frozen press is gone, not saved up
    expect(c.move().z).toBe(1)
  })

  it('freezing lets go of a held stick, so nobody walks off alone afterwards', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    c.setJoystick({ x: 0, z: 1 })
    c.freeze(true)
    c.freeze(false)
    expect(c.move()).toEqual({ x: 0, z: 0 })
  })
  it('a drag on the stage turns the view: summed until read, then consumed, in one reused answer', () => {
    const c = (controls = createControls(fakeWindow()))
    expect(c.look(1 / 30)).toEqual({ yaw: 0, pitch: 0, held: false })
    c.addLook(0.1, 0.02)
    c.addLook(0.2, -0.01)
    const a = c.look(1 / 30)
    expect(a.yaw).toBeCloseTo(0.3)
    expect(a.pitch).toBeCloseTo(0.01)
    const b = c.look(1 / 30)
    expect(b).toBe(a) // no allocation per frame
    expect(b).toEqual({ yaw: 0, pitch: 0, held: false })
  })

  it('Q turns the view left and R right, at a steady rate while held, and they are not walking keys', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    press(w, 'KeyQ')
    expect(c.look(0.5).yaw).toBeGreaterThan(0.5) // a quarter turn takes under a second
    expect(c.look(0.5).yaw).toBeLessThan(Math.PI / 2)
    expect(c.move()).toEqual({ x: 0, z: 0 })
    press(w, 'KeyQ', 'keyup')
    press(w, 'KeyR')
    expect(c.look(0.5).yaw).toBeLessThan(-0.5)
    press(w, 'KeyR', 'keyup')
    expect(c.look(0.5).yaw).toBe(0)
  })

  it('the stick walks and a drag looks at the same time: two thumbs', () => {
    const c = (controls = createControls(fakeWindow()))
    c.setJoystick({ x: 0, z: 1 })
    c.addLook(0.4, 0)
    expect(c.move()).toEqual({ x: 0, z: 1 })
    expect(c.look(1 / 30).yaw).toBeCloseTo(0.4)
    expect(c.move()).toEqual({ x: 0, z: 1 })
  })

  it('frozen for a minigame, the view does not turn: drags and Q/R are dropped, not saved up', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    c.addLook(0.5, 0)
    c.freeze(true)
    c.addLook(0.5, 0)
    press(w, 'KeyQ')
    expect(c.look(1).yaw).toBe(0)
    c.freeze(false)
    expect(c.look(1 / 30).yaw).toBe(0)
  })
  it('reports a look held (a finger down on the street) until it lets go, and never while frozen', () => {
    const c = (controls = createControls(fakeWindow()))
    expect(c.look(1 / 30).held).toBe(false)
    c.holdLook(true)
    expect(c.look(1 / 30)).toEqual({ yaw: 0, pitch: 0, held: true })
    expect(c.look(1 / 30).held).toBe(true) // held is a state, not consumed
    c.freeze(true)
    expect(c.look(1 / 30).held).toBe(false)
    c.freeze(false)
    c.holdLook(false)
    expect(c.look(1 / 30).held).toBe(false)
  })

  it('jogs while Shift is held or the stick is pushed past 90% of its reach; never while frozen', () => {
    const w = fakeWindow()
    const c = (controls = createControls(w))
    expect(c.jog()).toBe(false)
    press(w, 'ShiftLeft')
    expect(c.jog()).toBe(true)
    press(w, 'ShiftLeft', 'keyup')
    press(w, 'ShiftRight')
    expect(c.jog()).toBe(true)
    press(w, 'ShiftRight', 'keyup')
    expect(c.jog()).toBe(false)
    c.setJoystick({ x: 0, z: 0.85 }) // most of the way: still a walk
    expect(c.jog()).toBe(false)
    c.setJoystick({ x: 0, z: 0.95 })
    expect(c.jog()).toBe(true)
    c.setJoystick({ x: -0.7, z: 0.7 }) // a diagonal at the rim counts as much as straight up
    expect(c.jog()).toBe(true)
    c.freeze(true)
    expect(c.jog()).toBe(false)
    press(w, 'ShiftLeft')
    expect(c.jog()).toBe(false)
  })

  it('the stick jogs from past 90% and keeps jogging until it eases back under 80%, so the rim does not flicker', () => {
    const c = (controls = createControls(fakeWindow()))
    const at = (z: number) => (c.setJoystick({ x: 0, z }), c.jog())
    expect(at(0.85)).toBe(false) // not jogging yet: 85% is a walk
    expect(at(0.95)).toBe(true)
    expect(at(0.85)).toBe(true) // jogging: 85% stays a jog
    expect(at(0.81)).toBe(true)
    expect(at(0.75)).toBe(false)
    expect(at(0.85)).toBe(false) // and walking again, 85% is a walk again
    expect(at(0.95)).toBe(true)
    expect(at(0)).toBe(false) // let go
    expect(at(0.85)).toBe(false)
    expect(at(0.95)).toBe(true)
    c.freeze(true) // a minigame takes the stick: the jog goes with it
    c.freeze(false)
    expect(at(0.85)).toBe(false)
  })

  it('rimJog is the one rule for the stick and its tint: in above 0.9, out below 0.8', () => {
    expect(rimJog(false, 0.9)).toBe(false)
    expect(rimJog(false, 0.91)).toBe(true)
    expect(rimJog(true, 0.8)).toBe(true)
    expect(rimJog(true, 0.79)).toBe(false)
  })

  it('a wheel or pinch zooms: factors multiply until read, then are consumed; frozen, they are dropped', () => {
    const c = (controls = createControls(fakeWindow()))
    expect(c.zoom()).toBe(1)
    c.addZoom(1.2)
    c.addZoom(1.5)
    expect(c.zoom()).toBeCloseTo(1.8)
    expect(c.zoom()).toBe(1)
    for (const bad of [0, -2, NaN, Infinity]) c.addZoom(bad)
    expect(c.zoom()).toBe(1)
    c.addZoom(0.5)
    c.freeze(true)
    c.addZoom(0.5)
    expect(c.zoom()).toBe(1)
    c.freeze(false)
    expect(c.zoom()).toBe(1)
  })
})
