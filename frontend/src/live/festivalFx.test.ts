import { describe, expect, it } from 'vitest'
import type { SkyParams } from './sky'
import { festivalParticleCount, festivalSky } from './festivalFx'

describe('festivalParticleCount', () => {
  it('scales particles by quality tier', () => {
    expect([2, 1, 0].map((q) => festivalParticleCount('sankranti', q as 0 | 1 | 2))).toEqual([120, 60, 25])
    expect([2, 1, 0].map((q) => festivalParticleCount('holi', q as 0 | 1 | 2))).toEqual([80, 40, 15])
    expect(festivalParticleCount('gangaur', 2)).toBe(0)
    expect(festivalParticleCount('teej', 0)).toBe(0)
    expect(festivalParticleCount('jlf', 1)).toBe(0)
  })
})

describe('festivalSky', () => {
  const sunset = '2026-11-14T12:04:00.000Z'
  const day = { nightLights: false } as SkyParams
  it('keeps diwali lights on from sunset, whatever the sky rule says', () => {
    expect(festivalSky(day, 'diwali', sunset, new Date('2026-11-14T12:04:00Z')).nightLights).toBe(true)
    expect(festivalSky(day, 'diwali', sunset, new Date('2026-11-14T15:00:00Z')).nightLights).toBe(true)
  })
  it('leaves daytime and other festivals alone', () => {
    expect(festivalSky(day, 'diwali', sunset, new Date('2026-11-14T06:00:00Z')).nightLights).toBe(false)
    expect(festivalSky(day, 'holi', sunset, new Date('2026-11-14T15:00:00Z')).nightLights).toBe(false)
    expect(festivalSky(day, null, sunset, new Date('2026-11-14T15:00:00Z')).nightLights).toBe(false)
  })
})
