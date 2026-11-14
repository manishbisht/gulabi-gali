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
  /** What `drive()` hands back, reused: a frame of driving allocates nothing. */
  const drived: Vec2 = { x: 0, z: 0 }

  const axis = (positive: string[], negative: string[]) =>
    (positive.some((k) => down.has(k)) ? 1 : 0) - (negative.some((k) => down.has(k)) ? 1 : 0)

  const onKeyDown = (e: Event) => {
    // Typing a line (bench chat, the profile) is not walking, nor pressing E.
    if (typing(e.target)) return
    const code = (e as KeyboardEvent).code
    if (code === 'KeyE' && !down.has(code)) interactQueued = true
    if (code === 'Space' && !down.has(code)) hornQueued = true
    down.add(code)
  }
  const onKeyUp = (e: Event) => down.delete((e as KeyboardEvent).code)
  // A key released while the tab was hidden never sends keyup; without this the player walks on alone.
  const onBlur = () => down.clear()

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  target.addEventListener('blur', onBlur)

  return {
    move() {
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
    setJoystick(v) {
      joystick = { x: v.x, z: v.z }
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown)
      target.removeEventListener('keyup', onKeyUp)
      target.removeEventListener('blur', onBlur)
      down.clear()
      joystick = { x: 0, z: 0 }
    },
  }
}
