// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Joystick } from './Joystick'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)', media: q }))
  document.body.innerHTML = '<div id="app"></div>'
  host = document.getElementById('app')!
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})

it('tints the knob (data-jog) while the stick jogs: in past 90% of its reach, out under 80%', () => {
  const onChange = vi.fn()
  act(() => root.render(<Joystick lang="en" jogs onChange={onChange} />))
  const stick = host.querySelector<HTMLElement>('.joystick')!
  stick.setPointerCapture = () => {}
  // happy-dom lays nothing out: the stick's centre is (0, 0), and its reach is 48 px
  const fire = (type: string, y: number) =>
    act(() => {
      stick.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 0, clientY: y }))
    })
  const jogging = () => stick.hasAttribute('data-jog')
  fire('pointerdown', -41) // 85%: a walk
  expect(jogging()).toBe(false)
  fire('pointermove', -46) // 96%: a jog
  expect(jogging()).toBe(true)
  fire('pointermove', -41) // back to 85%: still a jog
  expect(jogging()).toBe(true)
  fire('pointermove', -37) // 77%: a walk
  expect(jogging()).toBe(false)
  fire('pointermove', -100) // past the rim, held at it
  expect(jogging()).toBe(true)
  expect(onChange).toHaveBeenLastCalledWith({ x: 0, z: 1 })
  fire('pointerup', -100)
  expect(jogging()).toBe(false)
  expect(onChange).toHaveBeenLastCalledWith({ x: 0, z: 0 })
})

it('a stick that does not walk (the wheel, a kite) is never tinted', () => {
  act(() => root.render(<Joystick lang="en" onChange={() => {}} />))
  const stick = host.querySelector<HTMLElement>('.joystick')!
  stick.setPointerCapture = () => {}
  act(() => {
    stick.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0, clientY: -100 }),
    )
  })
  expect(stick.hasAttribute('data-jog')).toBe(false)
})
