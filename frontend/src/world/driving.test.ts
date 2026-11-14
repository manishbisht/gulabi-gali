import { describe, expect, it, vi } from 'vitest'
import { resetHorn } from '../audio/horn'
import { createDriving, MOUNT_RANGE } from './driving'
import type { ParkedAutos } from './props'
import type { Vec2 } from './types'

const STATION = { x: 50, z: 60 }

function setup(exit: Vec2 | null = { x: 4, z: 0 }) {
  const log: string[] = []
  const autos: ParkedAutos = {
    nearest: (pos, range) => (Math.hypot(pos.x - 1, pos.z) <= range ? 0 : -1),
    pose: () => ({ x: 1, z: 0, ry: 0.5 }),
    take: (i) => void log.push(`take ${i}`),
    leave: (i, x, z, ry) => void log.push(`leave ${i} ${x} ${z} ${ry}`),
  }
  let driving = false
  const player = {
    position: () => ({ x: 0, z: 0 }),
    driving: () => driving,
    mount: vi.fn(() => void (driving = true)),
    dismount: vi.fn(() => void (driving = false)),
    ridePose: () => ({ x: 9, z: 9, ry: 1 }),
    exitPoint: () => exit,
  }
  const hooks = { near: vi.fn(), driving: vi.fn(), blocked: vi.fn(), rescued: vi.fn() }
  const stand = vi.fn()
  const d = createDriving({ autos, player, stand, station: STATION, hooks })
  return { d, log, player, hooks, stand }
}

describe('createDriving', () => {
  it('says when an auto is in reach, and only when that changes', () => {
    const { d, hooks } = setup()
    d.update({ x: 0, z: 0 })
    d.update({ x: 0.5, z: 0 })
    expect(hooks.near.mock.calls).toEqual([[true]])
    d.update({ x: 20, z: 0 })
    expect(hooks.near.mock.calls).toEqual([[true], [false]])
    expect(MOUNT_RANGE).toBe(2.5)
  })

  it('mount stands the player up, hides the auto and starts driving; exit leaves it where it was left', () => {
    const { d, log, player, hooks, stand } = setup()
    d.mount() // nothing in reach: nothing happens
    expect(player.mount).not.toHaveBeenCalled()
    d.update({ x: 0, z: 0 })
    d.mount()
    expect(stand).toHaveBeenCalledOnce()
    expect(player.mount).toHaveBeenCalledWith(1, 0, 0.5)
    expect(log).toEqual(['take 0'])
    expect(d.driving()).toBe(true)
    expect(hooks.driving).toHaveBeenLastCalledWith(true)
    // while driving, no auto is "in reach" (the one under us is not parked)
    d.update({ x: 0, z: 0 })
    expect(d.near()).toBe(false)

    d.exit()
    expect(log).toEqual(['take 0', 'leave 0 9 9 1'])
    expect(player.dismount).toHaveBeenCalledWith({ x: 4, z: 0 })
    expect(d.driving()).toBe(false)
    expect(hooks.driving).toHaveBeenLastCalledWith(false)
  })

  it('with no clear place to get out, stays in the auto and says so', () => {
    const { d, log, player, hooks } = setup(null)
    d.update({ x: 0, z: 0 })
    d.mount()
    d.exit()
    expect(hooks.blocked).toHaveBeenCalledOnce()
    expect(player.dismount).not.toHaveBeenCalled()
    expect(log).toEqual(['take 0']) // the auto is not put down anywhere
    expect(d.driving()).toBe(true)
    expect(hooks.rescued).not.toHaveBeenCalled()
  })

  it('boxed in twice running, the player is set down at the station with a toast', () => {
    const { d, log, player, hooks } = setup(null)
    d.update({ x: 0, z: 0 })
    d.mount()
    d.exit()
    d.exit()
    expect(hooks.blocked).toHaveBeenCalledOnce()
    expect(player.dismount).toHaveBeenCalledWith(STATION)
    expect(hooks.rescued).toHaveBeenCalledOnce()
    expect(log).toEqual(['take 0', 'leave 0 9 9 1'])
    expect(d.driving()).toBe(false)
    expect(hooks.driving).toHaveBeenLastCalledWith(false)
  })

  it('a try that finds room in between starts the count again', () => {
    const { d, player, hooks } = setup(null)
    const spot = { current: null as Vec2 | null }
    player.exitPoint = () => spot.current
    d.update({ x: 0, z: 0 })
    d.mount()
    d.exit() // boxed in once
    spot.current = { x: 4, z: 0 }
    d.exit() // out, normally
    expect(player.dismount).toHaveBeenLastCalledWith({ x: 4, z: 0 })
    expect(hooks.rescued).not.toHaveBeenCalled()
  })

  it('mounting wakes the audio from the gesture; a honk on foot does nothing', () => {
    const ctx = vi.fn(function (this: Record<string, unknown>) {
      Object.assign(this, {
        currentTime: 0,
        state: 'running',
        destination: {},
        resume: async () => {},
        close: async () => {},
        createOscillator: () => ({ frequency: {}, connect() {}, start() {}, stop() {} }),
        createGain: () => ({
          gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
        }),
      })
    })
    vi.stubGlobal('AudioContext', ctx)
    resetHorn()
    const { d } = setup()
    d.honk() // on foot
    expect(ctx).not.toHaveBeenCalled()
    d.update({ x: 0, z: 0 })
    d.mount() // mounting wakes the audio from the gesture
    expect(ctx).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
    resetHorn()
  })

  it('disposing while driving tells React it is over', () => {
    const { d, hooks } = setup()
    d.update({ x: 0, z: 0 })
    d.mount()
    d.dispose()
    expect(hooks.driving).toHaveBeenLastCalledWith(false)
  })
})
