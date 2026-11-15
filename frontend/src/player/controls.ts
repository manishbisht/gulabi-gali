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
  /**
   * How far to turn the view this frame, in radians: `yaw` positive turns it left, `pitch` positive tilts it up.
   * The drags added since the last read plus Q (left) or R (right) held for `dt` seconds. Reading consumes the
   * drags, and the answer is one reused object. `held`: a drag on the stage is still down (see `holdLook`).
   */
  look(dt: number): { yaw: number; pitch: number; held: boolean }
  /** A drag on the stage turned the view by this much (radians, as `look`); summed until `look` reads it. */
  addLook(yaw: number, pitch: number): void
  /** A drag on the stage began (true) or let go (false): held still, it keeps the view where it is put. */
  holdLook(on: boolean): void
  /** Jogging, not walking: Shift held, or the joystick at its rim (see `rimJog`). */
  jog(): boolean
  /**
   * How much to scale the camera's distance by this frame (above 1 farther, below 1 nearer): the wheel's and
   * pinches' factors multiplied together since the last read, which consumes them; 1 when there were none.
   */
  zoom(): number
  /** A wheel or a pinch asked for the camera's distance times `factor`; multiplied in until `zoom` reads it. */
  addZoom(factor: number): void
  setJoystick(v: Vec2): void
  /**
   * Holds the player still while a minigame has the keys and the stick: `move()`, `drive()` and `look()` read
   * zero (the stick is let go of, drags and zooms are dropped, nobody jogs), and E and Space (the horn) are not heard. Letting go (or `freeze(false)`) hands them back; a key held through
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
/** Turning the view: Q and R sit either side of W and E, and nothing else here has them. */
const TURN_LEFT = ['KeyQ']
const TURN_RIGHT = ['KeyR']
/** Radians a second while Q or R is held: a quarter turn in about 0.8 s. */
const TURN_RATE = 2
/** Either Shift held jogs. */
const SHIFT = ['ShiftLeft', 'ShiftRight'] as const
/** A joystick pushed past this fraction of its reach starts to jog, and jogs on until it is back under JOG_LEAVE. */
const JOG_ENTER = 0.9
const JOG_LEAVE = 0.8

/**
 * Whether a stick pushed `push` of its reach (0 to 1) jogs, given whether it was jogging: the one rule for the
 * walk (controls) and the knob's tint (the joystick). The gap between in and out keeps a thumb resting at the
 * rim from flickering between the two.
 */
export function rimJog(was: boolean, push: number): boolean {
  return was ? push >= JOG_LEAVE : push > JOG_ENTER
}

/** A text field, which keeps its keys to itself. */
function typing(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null
  return !!el && (el.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''))
}

export function createControls(target: Window): Controls {
  const down = new Set<string>()
  let joystick: Vec2 = { x: 0, z: 0 }
  /** The stick is at its rim (see `rimJog`), as of its last report. */
  let stickJog = false
  let interactQueued = false
  let hornQueued = false
  let frozen = false
  let spaceHeld = false
  /** What `drive()` hands back, reused: a frame of driving allocates nothing. */
  const drived: Vec2 = { x: 0, z: 0 }
  /** Drags not read yet, and what `look()` hands back, reused. */
  let dragYaw = 0
  let dragPitch = 0
  let lookHeld = false
  const looked = { yaw: 0, pitch: 0, held: false }
  /** Zooms not read yet, multiplied together. */
  let zoomBy = 1

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
    look(dt) {
      looked.yaw = frozen ? 0 : dragYaw + axis(TURN_LEFT, TURN_RIGHT) * TURN_RATE * dt
      looked.pitch = frozen ? 0 : dragPitch
      looked.held = !frozen && lookHeld
      dragYaw = 0
      dragPitch = 0
      return looked
    },
    addLook(yaw, pitch) {
      if (frozen) return
      dragYaw += yaw
      dragPitch += pitch
    },
    holdLook(on) {
      lookHeld = on
    },
    jog() {
      if (frozen) return false
      return stickJog || down.has(SHIFT[0]) || down.has(SHIFT[1])
    },
    zoom() {
      const k = zoomBy
      zoomBy = 1
      return k
    },
    addZoom(factor) {
      if (frozen || !(factor > 0) || !Number.isFinite(factor)) return
      zoomBy *= factor
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
      if (on) {
        joystick = { x: 0, z: 0 }
        stickJog = false
      }
      dragYaw = 0
      dragPitch = 0
      zoomBy = 1
      interactQueued = false
      hornQueued = false
    },
    holdSpace(on) {
      spaceHeld = on
    },
    setJoystick(v) {
      joystick = { x: v.x, z: v.z }
      stickJog = rimJog(stickJog, Math.hypot(v.x, v.z))
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown)
      target.removeEventListener('keyup', onKeyUp)
      target.removeEventListener('blur', onBlur)
      down.clear()
      joystick = { x: 0, z: 0 }
      stickJog = false
      dragYaw = 0
      dragPitch = 0
      zoomBy = 1
      lookHeld = false
      spaceHeld = false
    },
  }
}
