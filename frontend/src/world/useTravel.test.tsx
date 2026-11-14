// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FADE_MS, savedDistrict, STATION_RANGE, useTravel, type Swap } from './useTravel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function mount() {
  const out = {} as ReturnType<typeof useTravel>
  function Probe() {
    Object.assign(out, useTravel())
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe />))
  return out
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.useRealTimers())

describe('savedDistrict', () => {
  it('starts in the Walled City', () => {
    expect(savedDistrict()).toBe('walled-city')
  })

  it('reopens in the district last travelled to', () => {
    localStorage.setItem('gg-district', 'university')
    expect(savedDistrict()).toBe('university')
  })

  it('falls back to the Walled City for an id it does not know', () => {
    localStorage.setItem('gg-district', 'atlantis')
    expect(savedDistrict()).toBe('walled-city')
  })
})

describe('travelTo', () => {
  it('fades to black, swaps the district, persists it and fades back', async () => {
    vi.useFakeTimers()
    const travel = mount()
    const swap = vi.fn<Swap>(async () => {})
    travel.bind(swap)
    let done: Promise<void>
    act(() => void (done = travel.travelTo('mi-road')))
    expect(travel.fading).toBe(true)
    expect(swap).not.toHaveBeenCalled() // the screen goes black first
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
    await act(() => done)
    expect(swap).toHaveBeenCalledWith('mi-road')
    expect(localStorage.getItem('gg-district')).toBe('mi-road')
    expect(travel.fading).toBe(false)
  })

  it('ignores further taps while a trip is under way', async () => {
    vi.useFakeTimers()
    const travel = mount()
    let arrive = () => {}
    const swap = vi.fn<Swap>(() => new Promise<void>((r) => (arrive = r)))
    travel.bind(swap)
    let first: Promise<void>
    act(() => void (first = travel.travelTo('university')))
    act(() => void travel.travelTo('malviya-nagar'))
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
    act(() => void travel.travelTo('mi-road'))
    arrive()
    await act(() => first)
    expect(swap).toHaveBeenCalledTimes(1)
    expect(swap).toHaveBeenCalledWith('university')
    expect(localStorage.getItem('gg-district')).toBe('university')
    // once there, the next trip goes
    const next = travel.travelTo('mi-road')
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
    arrive()
    await act(() => next)
    expect(swap).toHaveBeenLastCalledWith('mi-road')
  })

  it('remembers nothing when the new district fails to load, and can try again', async () => {
    vi.useFakeTimers()
    const travel = mount()
    travel.bind(() => Promise.reject(new Error('offline')))
    const trip = travel.travelTo('university')
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
    await act(() => trip)
    expect(localStorage.getItem('gg-district')).toBeNull()
    expect(travel.fading).toBe(false)
    const swap = vi.fn(async () => {})
    travel.bind(swap)
    const again = travel.travelTo('university')
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
    await act(() => again)
    expect(swap).toHaveBeenCalled()
  })
})

describe('trackStation', () => {
  const station = { x: 10, z: 10 }

  it('offers the metro within reach of the station, and E opens and closes the sheet', () => {
    const travel = mount()
    act(() => void travel.trackStation({ x: 10 + STATION_RANGE + 1, z: 10 }, station, false))
    expect(travel.nearStation).toBe(false)
    let near = false
    act(() => void (near = travel.trackStation({ x: 10 + STATION_RANGE - 0.5, z: 10 }, station, false)))
    expect(near).toBe(true)
    expect(travel.nearStation).toBe(true)
    expect(travel.sheetOpen).toBe(false)
    act(() => void travel.trackStation({ x: 11, z: 10 }, station, true))
    expect(travel.sheetOpen).toBe(true)
    act(() => void travel.trackStation({ x: 11, z: 10 }, station, true))
    expect(travel.sheetOpen).toBe(false)
  })

  it('E far from the station does nothing, and walking away closes the sheet', () => {
    const travel = mount()
    act(() => void travel.trackStation({ x: 40, z: 40 }, station, true))
    expect(travel.sheetOpen).toBe(false)
    act(() => void travel.trackStation({ x: 10, z: 11 }, station, false))
    act(() => travel.openSheet())
    expect(travel.sheetOpen).toBe(true)
    act(() => void travel.trackStation({ x: 30, z: 11 }, station, false))
    expect(travel.sheetOpen).toBe(false)
    expect(travel.nearStation).toBe(false)
  })
})
