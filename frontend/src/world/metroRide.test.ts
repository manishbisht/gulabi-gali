import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DISTRICTS } from './district'
import { DISTRICT_NAMES } from './districtNames'
import { byBus, METRO_STATIONS, playRide, RIDE_MS, rideBy } from './metroRide'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('ride resolves within 5 s and on skip', async () => {
  expect(RIDE_MS).toBeGreaterThanOrEqual(2500)
  expect(RIDE_MS).toBeLessThanOrEqual(5000)

  const ride = playRide('walled-city', 'mi-road')
  let done = false
  void ride.done.then(() => (done = true))
  await vi.advanceTimersByTimeAsync(RIDE_MS - 1)
  expect(done).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(done).toBe(true)

  const skipped = playRide('mi-road', 'university')
  let skippedDone = false
  void skipped.done.then(() => (skippedDone = true))
  await vi.advanceTimersByTimeAsync(100)
  expect(skippedDone).toBe(false)
  skipped.skip()
  await vi.advanceTimersByTimeAsync(0)
  expect(skippedDone).toBe(true)
  skipped.skip() // harmless twice
})

it('every district has a station name in both languages', () => {
  for (const id of DISTRICTS) {
    expect(METRO_STATIONS[id].hi).not.toBe('')
    expect(METRO_STATIONS[id].en).not.toBe('')
  }
  expect(METRO_STATIONS['walled-city'].en).toBe('Badi Chaupar')
  expect(DISTRICT_NAMES['walled-city'].en).toBe('Pink City')
})

it('Amer and Nahargarh have no metro: a bus runs there from every station, and back', () => {
  expect(DISTRICTS.filter(byBus)).toEqual(['amer', 'nahargarh'])
  expect(rideBy('walled-city', 'mi-road')).toBe('metro')
  expect(rideBy('malviya-nagar', 'amer')).toBe('bus')
  expect(rideBy('amer', 'walled-city')).toBe('bus')
  expect(METRO_STATIONS.amer.en).toBe('Amer')
  // up to the ridge and down again, and between the two bus stands, it is the bus too
  expect(rideBy('walled-city', 'nahargarh')).toBe('bus')
  expect(rideBy('nahargarh', 'mi-road')).toBe('bus')
  expect(rideBy('amer', 'nahargarh')).toBe('bus')
  expect(METRO_STATIONS.nahargarh).toEqual({ hi: 'Nahargarh', en: 'Nahargarh' })
})
