// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import type { Controls } from '../player/controls'
import type { PitchDef } from './types'
import { useCricket, type CricketBound } from './useCricket'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function mount() {
  const out = {} as ReturnType<typeof useCricket>
  function Probe() {
    Object.assign(out, useCricket())
    return null
  }
  act(() => createRoot(document.createElement('div')).render(<Probe />))
  return out
}

const pitch: PitchDef = { stumps: { x: 0, z: 0 }, bowler: { x: 7, z: 0 } }
function bound(cricket: PitchDef | undefined | null = pitch) {
  const setHidden = vi.fn()
  const b: CricketBound = {
    session: { district: () => ({ def: cricket ? { cricket } : {} }), player: () => ({ setHidden }) },
    stage: {} as Stage,
    controls: {} as Controls,
  }
  return { b, setHidden }
}

it("opens a game on the bound stage at the district's pitch, and only one", () => {
  const c = mount()
  act(() => c.play())
  expect(c.game).toBeNull() // no city yet
  const { b } = bound()
  act(() => c.bind(b))
  act(() => c.hooks.near(true))
  expect(c.near).toBe(true)
  act(() => c.hooks.play())
  expect(c.game).toEqual({ pitch, stage: b.stage, controls: b.controls })
  const first = c.game
  act(() => c.play())
  expect(c.game).toBe(first)
  act(() => c.stop())
  expect(c.game).toBeNull()
})

it("opens none where there is no pitch, or while the street is not the player's (photo mode, a ride, a sheet)", () => {
  const c = mount()
  act(() => c.bind(bound(null).b))
  act(() => c.play())
  expect(c.game).toBeNull()
  act(() => c.bind(bound().b))
  c.blockedRef.current = true
  act(() => c.hooks.play())
  expect(c.game).toBeNull()
  c.blockedRef.current = false
  act(() => c.hooks.play())
  expect(c.game).not.toBeNull()
})

it('ends the game when the district goes, or the stage does', () => {
  const c = mount()
  act(() => c.bind(bound().b))
  act(() => c.hooks.near(true))
  act(() => c.play())
  act(() => c.hooks.left())
  expect(c.game).toBeNull()
  expect(c.near).toBe(false)
  act(() => c.play())
  expect(c.game).not.toBeNull()
  act(() => c.bind(null))
  expect(c.game).toBeNull()
})

it("hides and shows the player's own body, and does nothing once the city is gone", () => {
  const c = mount()
  const { b, setHidden } = bound()
  act(() => c.bind(b))
  c.hide(true)
  c.hide(false)
  expect(setHidden.mock.calls).toEqual([[true], [false]])
  act(() => c.bind(null))
  c.hide(true)
  expect(setHidden).toHaveBeenCalledTimes(2)
})
