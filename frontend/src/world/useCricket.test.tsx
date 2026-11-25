// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import type { Controls } from '../player/controls'
import type { PitchDef } from './types'
import { useCricket, type CricketBound } from './useCricket'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The game's code, arriving when the test says: `arrive()` (or `fail()`), then a tick for the hook to hear. */
function chunk() {
  let settle: { ok(): void; no(): void } | null = null
  const load = vi.fn(
    () =>
      new Promise<unknown>((ok, no) => {
        settle = { ok: () => ok(null), no: () => no(new Error('offline')) }
      }),
  )
  return {
    load,
    arrive: () => act(async () => settle!.ok()),
    fail: () => act(async () => settle!.no()),
  }
}

function mount(load: () => Promise<unknown> = () => Promise.resolve()) {
  const out = {} as ReturnType<typeof useCricket>
  function Probe() {
    Object.assign(out, useCricket(load))
    return null
  }
  act(() => createRoot(document.createElement('div')).render(<Probe />))
  return out
}

const pitch: PitchDef = { stumps: { x: 0, z: 0 }, bowler: { x: 7, z: 0 } }
function bound(cricket: PitchDef | null = pitch) {
  const setHidden = vi.fn()
  const b: CricketBound = {
    session: { district: () => ({ def: cricket ? { cricket } : {} }), player: () => ({ setHidden }) },
    stage: {} as Stage,
    controls: {} as Controls,
  }
  return { b, setHidden }
}
/** By the pitch of a bound city, the game's code in the test's hands. */
function atPitch() {
  const code = chunk()
  const c = mount(code.load)
  const { b } = bound()
  act(() => c.bind(b))
  act(() => c.hooks.near(true))
  return { c, b, ...code }
}

it("fetches the game, says it is opening, then opens it on the bound stage at the district's pitch", async () => {
  const { c, b, load, arrive } = atPitch()
  expect(c.near).toBe(true)
  act(() => c.hooks.play())
  expect(load).toHaveBeenCalledTimes(1)
  expect(c.loading).toBe(true) // "Khul raha hai…"
  expect(c.game).toBeNull() // nothing is up until its code is here
  act(() => c.play()) // an impatient second tap fetches nothing more
  expect(load).toHaveBeenCalledTimes(1)
  await arrive()
  expect(c.loading).toBe(false)
  expect(c.game).toEqual({ pitch, stage: b.stage, controls: b.controls })
  act(() => c.stop())
  expect(c.game).toBeNull()
})

it('walking away while the game is still arriving opens nothing, and the next ask starts afresh', async () => {
  const { c, load, arrive } = atPitch()
  act(() => c.play())
  act(() => c.hooks.near(false)) // off down the lane
  await arrive()
  expect(c.game).toBeNull()
  expect(c.loading).toBe(false)
  act(() => c.hooks.near(true))
  act(() => c.play())
  expect(load).toHaveBeenCalledTimes(2)
  await arrive()
  expect(c.game).not.toBeNull()
})

it('a sheet, a ride or photo mode coming up while it arrives opens nothing either', async () => {
  const { c, arrive } = atPitch()
  act(() => c.play())
  c.blockedRef.current = true
  await arrive()
  expect(c.game).toBeNull()
  expect(c.loading).toBe(false)
})

it('the district or the city going while it arrives drops it: a late answer opens nothing', async () => {
  const first = atPitch()
  act(() => first.c.play())
  act(() => first.c.hooks.left())
  expect(first.c.loading).toBe(false)
  act(() => first.c.hooks.near(true)) // the next district has a pitch too
  await first.arrive()
  expect(first.c.game).toBeNull()
  const second = atPitch()
  act(() => second.c.play())
  act(() => second.c.bind(null))
  expect(second.c.loading).toBe(false)
  await second.arrive()
  expect(second.c.game).toBeNull()
})

it("a fetch that fails still opens the game's place, which says it could not load", async () => {
  const { c, fail } = atPitch()
  act(() => c.play())
  await fail()
  expect(c.loading).toBe(false)
  expect(c.game).not.toBeNull()
})

it("asks for nothing where there is no pitch, with no city, or while the street is not the player's", () => {
  const code = chunk()
  const c = mount(code.load)
  act(() => c.play()) // no city yet
  act(() => c.bind(bound(null).b))
  act(() => c.hooks.near(true))
  act(() => c.play()) // no pitch here
  act(() => c.bind(bound().b))
  c.blockedRef.current = true
  act(() => c.hooks.play()) // photo mode, a ride, a sheet
  expect(code.load).not.toHaveBeenCalled()
  expect(c.loading).toBe(false)
  expect(c.game).toBeNull()
})

it('ends the game when the district goes, or the stage does', async () => {
  const { c, b, arrive } = atPitch()
  act(() => c.play())
  await arrive()
  act(() => c.hooks.left())
  expect(c.game).toBeNull()
  expect(c.near).toBe(false)
  act(() => c.hooks.near(true))
  act(() => c.play())
  await arrive()
  expect(c.game).not.toBeNull()
  act(() => c.bind(null))
  expect(c.game).toBeNull()
  expect(b).toBeDefined()
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
