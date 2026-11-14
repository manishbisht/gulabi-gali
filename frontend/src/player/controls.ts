import type { Vec2 } from '../world/types'

/** `move()` is input space: x is right, z is forward, length at most 1. The caller turns it to world space. */
export interface Controls {
  move(): Vec2
  /** True once per press of E; reading it consumes the press. */
  interact(): boolean
  setJoystick(v: Vec2): void
  dispose(): void
}

const FORWARD = ['KeyW', 'ArrowUp']
const BACK = ['KeyS', 'ArrowDown']
const LEFT = ['KeyA', 'ArrowLeft']
const RIGHT = ['KeyD', 'ArrowRight']

export function createControls(target: Window): Controls {
  const down = new Set<string>()
  let joystick: Vec2 = { x: 0, z: 0 }
  let interactQueued = false

  const axis = (positive: string[], negative: string[]) =>
    (positive.some((k) => down.has(k)) ? 1 : 0) - (negative.some((k) => down.has(k)) ? 1 : 0)

  const onKeyDown = (e: Event) => {
    const code = (e as KeyboardEvent).code
    if (code === 'KeyE' && !down.has(code)) interactQueued = true
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
    interact() {
      const fired = interactQueued
      interactQueued = false
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
