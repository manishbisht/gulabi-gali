import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { AqiBand, CitySnapshot } from '../net/protocol'
import { applySky, skyParams } from './sky'
import type { Stage } from '../engine/stage'
import type { District } from '../world/district'

const base = {
  sunrise: '2026-11-14T01:14:00.000Z',
  sunset: '2026-11-14T12:04:00.000Z',
  aqiBand: 'good',
  condition: 'clear',
  stale: false,
} as CitySnapshot
const noon = new Date('2026-11-14T06:39:00Z')

describe('skyParams', () => {
  it('noon sun is high, midnight is below the horizon', () => {
    expect(skyParams(base, noon).sunElevationDeg).toBeCloseTo(70, 0)
    expect(skyParams(base, new Date('2026-11-14T18:30:00Z')).sunElevationDeg).toBe(-10)
  })

  it('swings from east to west', () => {
    expect(skyParams(base, new Date(base.sunrise)).sunAzimuthDeg).toBeCloseTo(90)
    expect(skyParams(base, noon).sunAzimuthDeg).toBeCloseTo(180)
    expect(skyParams(base, new Date(base.sunset)).sunAzimuthDeg).toBeCloseTo(270)
  })

  it('uses IST regardless of device timezone', () => {
    // 23:00 IST = 17:30Z; the instant is what matters, not the device's local hour
    vi.stubEnv('TZ', 'America/New_York')
    try {
      expect(skyParams(base, new Date('2026-11-14T17:30:00Z')).nightLights).toBe(true)
      expect(skyParams(base, noon).nightLights).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('lights come on 20 minutes before sunset and stay until 20 minutes after sunrise', () => {
    const at = (iso: string) => skyParams(base, new Date(iso)).nightLights
    expect(at('2026-11-14T11:45:00Z')).toBe(true)
    expect(at('2026-11-14T11:30:00Z')).toBe(false)
    expect(at('2026-11-14T01:30:00Z')).toBe(true)
    expect(at('2026-11-14T01:40:00Z')).toBe(false)
  })

  it('haze follows AQI, thicker in fog', () => {
    const d = (aqiBand: AqiBand, condition: CitySnapshot['condition'] = 'clear') =>
      skyParams({ ...base, aqiBand, condition }, noon).fogDensity
    expect([d('good'), d('moderate'), d('poor'), d('unhealthy'), d('severe')]).toEqual([
      0.004, 0.008, 0.014, 0.02, 0.03,
    ])
    expect(d('good', 'fog')).toBeCloseTo(0.004 * 1.6)
  })

  it('dust tints the horizon, rain darkens the sky and switches on rain', () => {
    expect(skyParams({ ...base, condition: 'dust' }, noon)).toMatchObject({
      skyHorizon: '#d9b98c',
      dust: true,
    })
    const clear = new THREE.Color(skyParams(base, noon).skyTop)
    const wet = skyParams({ ...base, condition: 'rain' }, noon)
    expect(wet.rain).toBe(true)
    expect(skyParams({ ...base, condition: 'storm' }, noon).rain).toBe(true)
    expect(new THREE.Color(wet.skyTop).r).toBeCloseTo(clear.r * 0.65, 1)
  })

  it('is darker and dimmer at night than at noon', () => {
    const night = skyParams(base, new Date('2026-11-14T18:30:00Z'))
    const day = skyParams(base, noon)
    expect(night.sunIntensity).toBeLessThan(day.sunIntensity)
    expect(night.ambientIntensity).toBeLessThan(day.ambientIntensity)
    expect(new THREE.Color(night.skyTop).getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(
      new THREE.Color(day.skyTop).getHSL({ h: 0, s: 0, l: 0 }).l,
    )
  })
})

describe('applySky', () => {
  it('sets fog, lights and the night glow of tagged materials', () => {
    const scene = new THREE.Scene()
    const hemi = new THREE.HemisphereLight()
    const sun = new THREE.DirectionalLight()
    const glow = new THREE.MeshLambertMaterial()
    glow.userData.nightGlow = 1.5
    const root = new THREE.Group()
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), glow))
    const stage = { scene } as Stage
    const district = { root, lights: { hemi, sun } } as unknown as District
    applySky(stage, district, skyParams(base, new Date('2026-11-14T18:30:00Z')))
    expect(scene.fog).toBeInstanceOf(THREE.FogExp2)
    expect((scene.fog as THREE.FogExp2).density).toBe(0.004)
    expect(glow.emissiveIntensity).toBe(1.5)
    applySky(stage, district, skyParams(base, noon))
    expect(glow.emissiveIntensity).toBe(0)
    expect(hemi.intensity).toBeCloseTo(skyParams(base, noon).ambientIntensity)
  })
})
