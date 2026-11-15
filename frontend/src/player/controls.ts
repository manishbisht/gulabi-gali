import type { Vec2 } from '../world/types'

/** `move()` is input space: x is right, z is forward, length at most 1. The caller turns it to world space. */
export interface Controls {
  move(): Vec2
  /**
   * The wheel (x, right positive) and the pedal (z, forward positive), for driving. Unlike `move()` the
   * keyboard's diagonal is not shortened (W and D together are full throttle and full lock), and a
   * joystick pushed two thirds of the way up is already full throttle.
   */
  drive(): Vec2
  /** True once per press of E; reading it consumes the press. */
  interact(): boolean
  /** True once per press of Space (the horn); reading it consumes the press. */
  horn(): boolean
  setJoystick(v: Vec2): void
  /**
   * Holds the player still while a minigame has the keys and the stick: `move()` and `drive()` read zero (the stick is let go of), and
   * E and Space (the horn) are not heard. Letting go (or `freeze(false)`) hands them back; a key held through
   * it carries on being held.
   */
  freeze(on: boolean): void
  /**
   * While on (at the wheel), Space is the horn's alone: its default is prevented, so it never also presses a
   * focused HUD button (or scrolls). Typing in a text field still types a space.
   */
  holdSpace(on: boolean): void
  dispose(): void
}

/** A joystick pushed 1/PEDAL_GAIN of the way up is full throttle. */
const PEDAL_GAIN = 1.5
const FORWARD = ['KeyW', 'ArrowUp']
const BACK = ['KeyS', 'ArrowDown']
const LEFT = ['KeyA', 'ArrowLeft']
const RIGHT = ['KeyD', 'ArrowRight']

/** A text field, which keeps its keys to itself. */
function typing(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null
  return !!el && (el.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''))
}

export function createControls(target: Window): Controls {
  const down = new Set<string>()
  let joystick: Vec2 = { x: 0, z: 0 }
  let interactQueued = false
  let hornQueued = false
  let frozen = false
  let spaceHeld = false
  /** What `drive()` hands back, reused: a frame of driving allocates nothing. */
  const drived: Vec2 = { x: 0, z: 0 }

  const axis = (positive: string[], negative: string[]) =>
    (positive.some((k) => down.has(k)) ? 1 : 0) - (negative.some((k) => down.has(k)) ? 1 : 0)

  /** At the wheel, Space presses nothing but the horn (a button activates on Space's keyup, so both go). */
  const holdHorn = (e: Event) => {
    if (spaceHeld && (e as KeyboardEvent).code === 'Space' && !typing(e.target)) e.preventDefault()
  }
  const onKeyDown = (e: Event) => {
    // Typing a line (bench chat, the profile) is not walking, nor pressing E.
    if (typing(e.target)) return
    holdHorn(e)
    if (frozen) return
    const code = (e as KeyboardEvent).code
    if (code === 'KeyE' && !down.has(code)) interactQueued = true
    if (code === 'Space' && !down.has(code)) hornQueued = true
    down.add(code)
  }
  const onKeyUp = (e: Event) => {
    holdHorn(e)
    down.delete((e as KeyboardEvent).code)
  }
  // A key released while the tab was hidden never sends keyup; without this the player walks on alone.
  const onBlur = () => down.clear()

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  target.addEventListener('blur', onBlur)

  return {
    move() {
      if (frozen) return { x: 0, z: 0 }
      if (joystick.x !== 0 || joystick.z !== 0) {
        const len = Math.hypot(joystick.x, joystick.z)
        return len > 1 ? { x: joystick.x / len, z: joystick.z / len } : { ...joystick }
      }
      const x = axis(RIGHT, LEFT)
      const z = axis(FORWARD, BACK)
      if (x !== 0 && z !== 0) return { x: x * Math.SQRT1_2, z: z * Math.SQRT1_2 }
      return { x, z }
    },
    drive() {
      if (frozen) {
        drived.x = 0
        drived.z = 0
        return drived
      }
      if (joystick.x !== 0 || joystick.z !== 0) {
        const len = Math.hypot(joystick.x, joystick.z)
        const k = len > 1 ? 1 / len : 1
        drived.x = joystick.x * k
        drived.z = Math.max(-1, Math.min(1, joystick.z * k * PEDAL_GAIN))
        return drived
      }
      drived.x = axis(RIGHT, LEFT)
      drived.z = axis(FORWARD, BACK)
      return drived
    },
    interact() {
      const fired = interactQueued
      interactQueued = false
      return fired
    },
    horn() {
      const fired = hornQueued
      hornQueued = false
      return fired
    },
    freeze(on) {
      frozen = on
      // a stick still held when its widget goes away would never say it let go
      if (on) joystick = { x: 0, z: 0 }
      interactQueued = false
      hornQueued = false
    },
    holdSpace(on) {
      spaceHeld = on
    },
    setJoystick(v) {
      joystick = { x: v.x, z: v.z }
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown)
      target.removeEventListener('keyup', onKeyUp)
      target.removeEventListener('blur', onBlur)
      down.clear()
      joystick = { x: 0, z: 0 }
      spaceHeld = false
    },
  }
}
