import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CitySnapshot } from '../net/protocol'
import { MAX_OPACITY } from './groundFog'
import { airLoad, isWinter, istClock, morningMist, WINTER_MAX, winterFog } from './winter'

/** An instant given as an IST wall-clock time. */
const ist = (local: string) => new Date(`${local}+05:30`)

const base = {
  sunrise: '2027-01-10T01:43:00.000Z',
  sunset: '2027-01-10T12:22:00.000Z',
  aqi: 50,
  aqiBand: 'good',
  condition: 'clear',
  stale: false,
} as CitySnapshot

afterEach(() => vi.unstubAllEnvs())

describe('istClock and isWinter', () => {
  it('reads the IST month and minute', () => {
    expect(istClock(ist('2027-01-10T07:15:00'))).toEqual({ month: 1, minutes: 7 * 60 + 15 })
    // 23:00 UTC on 30 Nov is already 04:30 on 1 Dec in Jaipur
    expect(istClock(new Date('2026-11-30T23:00:00Z'))).toEqual({ month: 12, minutes: 4 * 60 + 30 })
  })

  it('runs from 1 December to the last day of February, by the IST calendar', () => {
    expect(isWinter(ist('2026-11-30T23:59:00'))).toBe(false)
    expect(isWinter(ist('2026-12-01T00:00:00'))).toBe(true)
    expect(isWinter(ist('2027-02-28T23:59:00'))).toBe(true)
    expect(isWinter(ist('2027-03-01T00:00:00'))).toBe(false)
    // a leap year's 29 February is still winter, and 1 March after it is not
    expect(isWinter(ist('2028-02-29T07:00:00'))).toBe(true)
    expect(isWinter(ist('2028-03-01T07:00:00'))).toBe(false)
  })

  it('is the same whatever timezone the device is in', () => {
    const at = [ist('2026-12-01T00:10:00'), ist('2027-03-01T00:10:00'), ist('2027-01-10T07:00:00')]
    const read = () => at.map((t) => [isWinter(t), morningMist(t)])
    const inIndia = read()
    for (const tz of ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
      vi.stubEnv('TZ', tz)
      expect(read()).toEqual(inIndia)
    }
    expect(inIndia).toEqual([
      [true, 0],
      [false, 0],
      [true, 1],
    ])
  })
})

describe('morningMist', () => {
  const at = (time: string) => morningMist(ist(`2027-01-10T${time}`))

  it('is thickest from 05:30 to 08:00 and gone by 10:00', () => {
    expect(at('03:59:00')).toBe(0)
    expect(at('04:45:00')).toBeGreaterThan(0)
    expect(at('04:45:00')).toBeLessThan(1)
    expect(at('05:30:00')).toBe(1)
    expect(at('08:00:00')).toBe(1)
    expect(at('09:00:00')).toBeCloseTo(0.5)
    expect(at('09:59:00')).toBeLessThan(0.01)
    expect(at('10:00:00')).toBe(0)
    expect(at('13:00:00')).toBe(0)
    expect(at('23:00:00')).toBe(0)
  })

  it('thins steadily as the morning goes on', () => {
    let last = 1
    for (let m = 8 * 60; m <= 10 * 60; m += 5) {
      const v = morningMist(new Date(ist('2027-01-10T00:00:00').getTime() + m * 60_000))
      expect(v).toBeLessThanOrEqual(last)
      last = v
    }
  })

  it('is none outside winter, however early', () => {
    expect(morningMist(ist('2027-03-01T06:30:00'))).toBe(0)
    expect(morningMist(ist('2026-11-30T06:30:00'))).toBe(0)
    expect(morningMist(ist('2027-02-28T06:30:00'))).toBe(1)
    expect(morningMist(ist('2028-02-29T06:30:00'))).toBe(1)
  })
})

describe('winterFog', () => {
  const dawn = ist('2027-01-10T06:30:00')

  it('is nothing outside a winter morning', () => {
    for (const t of [ist('2027-01-10T12:00:00'), ist('2027-04-10T06:30:00')])
      expect(winterFog({ ...base, aqi: 400, aqiBand: 'severe', condition: 'fog' }, t)).toEqual({
        density: 0,
        ground: 0,
      })
  })

  it('is light on clean air, thicker on dirty air and in reported fog', () => {
    const d = (s: Partial<CitySnapshot>) => winterFog({ ...base, ...s }, dawn).density
    const clean = d({})
    expect(clean).toBeCloseTo(0.009)
    expect(d({ aqi: 150, aqiBand: 'poor' })).toBeGreaterThan(clean)
    expect(d({ aqi: 200, aqiBand: 'unhealthy' })).toBeGreaterThan(d({ aqi: 150, aqiBand: 'poor' }))
    expect(d({ condition: 'fog' })).toBeGreaterThan(clean)
  })

  it('never passes the cap, so landmarks 25 m off and the players stay in sight', () => {
    const worst = winterFog({ ...base, aqi: 500, aqiBand: 'severe', condition: 'fog' }, dawn)
    expect(worst.density).toBeCloseTo(WINTER_MAX, 9)
    expect(worst.ground).toBeCloseTo(1, 9)
    // what still shows of a landmark 25 m off: through the scene fog (FogExp2), and then through a bank of mist
    // in front of it at its thickest
    const seen = Math.exp(-((25 * worst.density) ** 2)) * (1 - MAX_OPACITY * worst.ground)
    expect(seen).toBeGreaterThanOrEqual(0.6)
  })

  it('fades with the morning, keeping the ground fog in step with the density', () => {
    const s = { ...base, aqi: 180, aqiBand: 'unhealthy' } as CitySnapshot
    const full = winterFog(s, dawn)
    const late = winterFog(s, ist('2027-01-10T09:00:00'))
    expect(late.density).toBeCloseTo(full.density / 2)
    expect(late.ground).toBeCloseTo(late.density / WINTER_MAX)
  })

  it('reads the band when the AQI is missing', () => {
    expect(airLoad({ aqi: null, aqiBand: 'severe' })).toBe(1)
    expect(airLoad({ aqi: null, aqiBand: 'good' })).toBe(0)
    expect(airLoad({ aqi: 150, aqiBand: 'poor' })).toBe(0.5)
    expect(airLoad({ aqi: 20, aqiBand: 'good' })).toBe(0)
  })
})
