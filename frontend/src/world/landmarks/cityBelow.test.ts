import * as THREE from 'three'
import { expect, it } from 'vitest'
import { skyParams } from '../../live/sky'
import type { AqiBand, CitySnapshot } from '../../net/protocol'
import { buildCityBelow, CITY_FOG, cityFogFactor } from './cityBelow'

const BANDS: AqiBand[] = ['good', 'moderate', 'poor', 'unhealthy', 'severe']
const day = {
  sunrise: '2026-11-14T01:14:00.000Z',
  sunset: '2026-11-14T12:04:00.000Z',
  condition: 'clear',
  stale: false,
} as CitySnapshot
const noon = new Date('2026-11-14T06:39:00Z')
const density = (aqiBand: AqiBand) => skyParams({ ...day, aqiBand }, noon).fogDensity
/** The street's own fog at the same density and distance, for comparison. */
const sceneFog = (d: number, m: number) => 1 - Math.exp(-((d * m) ** 2))

/** From the sunset point: the nearest houses below, and the far side of the city. */
const NEAR = 100
const FAR = 260

it('the city below is hazier the worse the air, and still fades out far off on the worst days', () => {
  const near = BANDS.map((b) => cityFogFactor(density(b), NEAR))
  expect(near).toEqual([...near].sort((a, b) => a - b))
  expect(new Set(near).size).toBe(BANDS.length)
  expect(cityFogFactor(density('severe'), FAR)).toBeGreaterThan(0.9)
})

it('stays legible on a poor or unhealthy day, where the street fog would all but hide it', () => {
  for (const b of ['poor', 'unhealthy'] as const) {
    expect(cityFogFactor(density(b), NEAR), b).toBeLessThan(0.6)
    expect(sceneFog(density(b), NEAR), b).toBeGreaterThan(0.85)
  }
  expect(cityFogFactor(density('moderate'), NEAR)).toBeLessThan(0.15)
})

it("both meshes' shaders take the scene fog's density scaled down, as a constant, in one program of their own", () => {
  const city = buildCityBelow(-100, 100)
  const mats: THREE.Material[] = []
  city.traverse((o) => {
    if (o instanceof THREE.Mesh) mats.push(o.material as THREE.Material)
  })
  expect(mats).toHaveLength(2)
  for (const m of mats) {
    const shader = {
      fragmentShader: 'void main() {\n#include <fog_fragment>\n}',
    } as THREE.WebGLProgramParametersWithUniforms
    m.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
    expect(shader.fragmentShader).not.toContain('#include <fog_fragment>')
    expect(shader.fragmentShader).toContain(`fogDensity * fogDensity * ${(CITY_FOG * CITY_FOG).toFixed(4)}`)
    expect(m.customProgramCacheKey()).toBe('city-below-thin-fog')
    // it is still fogged: the scene's fog colour and density reach it
    expect((m as THREE.MeshLambertMaterial).fog).toBe(true)
  }
  city.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
  })
})
