// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RIDE_MS } from './metroRide'
import { FADE_MS, savedDistrict, STATION_RANGE, useTravel, type Swap } from './useTravel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Whether any render so far showed the coach's "still waiting" line. */
let sawWaiting = false
/** Every different `ride` the hook rendered, in order (a value that flashed and went is here too). */
let rides: (ReturnType<typeof useTravel>['ride'] | 'none')[] = []

function mount() {
  const out = {} as ReturnType<typeof useTravel>
  sawWaiting = false
  rides = []
  function Probe() {
    Object.assign(out, useTravel())
    if (out.ride?.waiting) sawWaiting = true
    const now = out.ride ?? 'none'
    if (JSON.stringify(rides.at(-1)) !== JSON.stringify(now)) rides.push(now)
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
    expect(travel.ride).toEqual({ from: 'walled-city', to: 'mi-road', waiting: false })
    await act(() => vi.advanceTimersByTimeAsync(RIDE_MS))
    await act(() => done)
    expect(travel.ride).toBeNull()
    expect(swap).toHaveBeenCalledWith('mi-road', expect.any(AbortSignal))
    expect(localStorage.getItem('gg-district')).toBe('mi-road')
    expect(travel.fading).toBe(false)
    // the coach is set once when the screen is black and cleared once on arrival: nothing flashed in between
    expect(rides).toEqual(['none', { from: 'walled-city', to: 'mi-road', waiting: false }, 'none'])
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
    await act(() => vi.advanceTimersByTimeAsync(RIDE_MS))
    await act(() => first)
    expect(swap).toHaveBeenCalledTimes(1)
    expect(swap).toHaveBeenCalledWith('university', expect.any(AbortSignal))
    expect(localStorage.getItem('gg-district')).toBe('university')
    // once there, the next trip goes
    const next = travel.travelTo('mi-road')
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
    arrive()
    await act(() => vi.advanceTimersByTimeAsync(RIDE_MS))
    await act(() => next)
    expect(swap).toHaveBeenLastCalledWith('mi-road', expect.any(AbortSignal))
  })

  it('remembers nothing when the new district fails to load, says so, and can try again', async () => {
    vi.useFakeTimers()
    const travel = mount()
    travel.bind(() => Promise.reject(new Error('offline')))
    const trip = travel.travelTo('university')
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
    await act(() => trip)
    expect(localStorage.getItem('gg-district')).toBeNull()
    expect(travel.fading).toBe(false)
    expect(travel.failed).toBe('university')
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(travel.failed).toBeNull() // the message goes away by itself
    const swap = vi.fn(async () => {})
    travel.bind(swap)
    const again = travel.travelTo('university')
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
    await act(() => vi.advanceTimersByTimeAsync(RIDE_MS))
    await act(() => again)
    expect(swap).toHaveBeenCalled()
  })
})

it('remembers nothing when the city closes mid-trip', async () => {
  vi.useFakeTimers()
  const travel = mount()
  let arrive = () => {}
  travel.bind(() => new Promise<void>((r) => (arrive = r)))
  const trip = travel.travelTo('university')
  await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
  travel.bind(null) // App unmounted while the district was loading
  arrive()
  await act(() => vi.advanceTimersByTimeAsync(RIDE_MS))
  await act(() => trip)
  expect(localStorage.getItem('gg-district')).toBeNull()
  expect(travel.failed).toBeNull()
  expect(travel.ride).toBeNull()
})

it('unmounting mid-ride stops the ride clock', async () => {
  vi.useFakeTimers()
  const out = {} as ReturnType<typeof useTravel>
  function Probe() {
    Object.assign(out, useTravel())
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe />))
  out.bind(() => new Promise<void>(() => {}))
  act(() => void out.travelTo('university'))
  await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
  expect(vi.getTimerCount()).toBeGreaterThan(0) // the ride's clock
  act(() => root.unmount())
  expect(vi.getTimerCount()).toBe(0)
})

describe('the ride', () => {
  it('plays while the district loads, and a tap skips the rest of it', async () => {
    vi.useFakeTimers()
    const travel = mount()
    const swap = vi.fn<Swap>(async () => {})
    travel.bind(swap)
    let trip: Promise<void>
    act(() => void (trip = travel.travelTo('mi-road', 'walled-city')))
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
    expect(swap).toHaveBeenCalledWith('mi-road', expect.any(AbortSignal)) // loading starts with the ride, not after it
    expect(travel.ride?.waiting).toBe(false)
    act(() => travel.skipRide())
    await act(() => trip)
    expect(travel.ride).toBeNull()
    expect(localStorage.getItem('gg-district')).toBe('mi-road')
  })

  it('keeps the coach with a waiting line while the district is still loading, then arrives', async () => {
    vi.useFakeTimers()
    const travel = mount()
    let arrive = () => {}
    travel.bind(() => new Promise<void>((r) => (arrive = r)))
    let trip: Promise<void>
    act(() => void (trip = travel.travelTo('university', 'walled-city')))
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
    act(() => travel.skipRide()) // skipping before the load is in just shows the waiting line
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(travel.ride).toEqual({ from: 'walled-city', to: 'university', waiting: true })
    await act(() => vi.advanceTimersByTimeAsync(20_000))
    expect(travel.ride?.waiting).toBe(true)
    arrive()
    await act(() => trip)
    expect(travel.ride).toBeNull()
    expect(localStorage.getItem('gg-district')).toBe('university')
  })

  it('going back from a hung load keeps the old district, saves nothing and says so', async () => {
    vi.useFakeTimers()
    const travel = mount()
    let signal: AbortSignal | undefined
    let arrive = () => {}
    travel.bind((_id, s) => {
      signal = s
      return new Promise<void>((r) => (arrive = r))
    })
    let trip: Promise<void>
    act(() => void (trip = travel.travelTo('university', 'walled-city')))
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS + RIDE_MS))
    expect(travel.ride?.waiting).toBe(true)
    act(() => travel.cancelRide())
    await act(() => trip)
    expect(signal?.aborted).toBe(true)
    expect(travel.ride).toBeNull()
    expect(travel.failed).toBe('university')
    arrive() // too late: the session throws the district away
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(localStorage.getItem('gg-district')).toBeNull()
  })

  it('a failed load ends the ride at once and says so', async () => {
    vi.useFakeTimers()
    const travel = mount()
    travel.bind(() => Promise.reject(new Error('offline')))
    let trip: Promise<void>
    act(() => void (trip = travel.travelTo('university', 'walled-city')))
    await act(() => vi.advanceTimersByTimeAsync(FADE_MS))
    await act(() => trip) // no RIDE_MS wait
    expect(travel.ride).toBeNull()
    expect(travel.failed).toBe('university')
    expect(sawWaiting).toBe(false) // a load that failed never flashes the waiting line
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
