import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Stage } from '../engine/stage'
import type { District } from '../world/district'
import { FLOOR_H } from '../world/kit/parts'
import type { BuildingSpec } from '../world/types'
import type { SkyParams } from './sky'
import { createFestivalFx, festivalParticleCount, festivalSky, roofDiyas } from './festivalFx'

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

describe('roofDiyas', () => {
  const at = (b: BuildingSpec) => roofDiyas([b], 1000)

  it('lines the parapets of havelis, shops and modern blocks alike', () => {
    const haveli = at({ x: 0, z: 0, w: 8, d: 10, floors: 3, style: 'haveli' })
    expect(haveli.length).toBeGreaterThan(0)
    expect(haveli.every((d) => Math.abs(d.y - (3 * FLOOR_H + 0.75)) < 1e-9)).toBe(true)
    expect(haveli.every((d) => Math.abs(Math.abs(d.z) - 5.01) < 1e-9)).toBe(true) // front and back edges
    const shop = at({ x: 0, z: 0, w: 8, d: 10, floors: 2, style: 'shop' })
    expect(shop.length).toBe(haveli.length)
    expect(shop[0]!.y).toBeCloseTo(2 * FLOOR_H + 0.5)
    const modern = at({ x: 0, z: 0, w: 8, d: 10, floors: 4, style: 'modern' })
    expect(modern[0]!.y).toBeCloseTo(4 * FLOOR_H + 0.35)
  })

  it('turns with the building and skips walls and temples', () => {
    const turned = at({ x: 10, z: 0, w: 8, d: 10, floors: 2, style: 'shop', rot: 90 })
    // turned 90°, the long edges run north–south, 5 m either side of x = 10
    expect(turned.every((d) => Math.abs(Math.abs(d.x - 10) - 5.01) < 1e-9)).toBe(true)
    expect(at({ x: 0, z: 0, w: 8, d: 1, floors: 2, style: 'wall' })).toEqual([])
    expect(at({ x: 0, z: 0, w: 8, d: 8, floors: 2, style: 'temple' })).toEqual([])
  })

  it('spreads a small budget over the whole district', () => {
    const row = Array.from({ length: 10 }, (_, i): BuildingSpec => ({
      x: i * 20,
      z: 0,
      w: 8,
      d: 10,
      floors: 2,
      style: 'haveli',
    }))
    const spots = roofDiyas(row, 5)
    expect(spots).toHaveLength(5)
    expect(Math.max(...spots.map((d) => d.x)) - Math.min(...spots.map((d) => d.x))).toBeGreaterThan(100)
  })
})

describe('createFestivalFx', () => {
  it('throws Holi colour around the district centre', () => {
    const scene = new THREE.Scene()
    const centre = { x: 40, z: -30 }
    const district = { def: { size: 200, buildings: [], centre } } as unknown as District
    const fx = createFestivalFx({ scene } as Stage, district)
    fx.set('holi', 2)
    fx.update(0.5)
    const puffs = scene.getObjectByName('holi-puffs') as THREE.InstancedMesh
    expect(puffs.visible).toBe(true)
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    for (let i = 0; i < puffs.count; i++) {
      p.setFromMatrixPosition((puffs.getMatrixAt(i, m), m))
      expect(Math.hypot(p.x - centre.x, p.z - centre.z)).toBeLessThan(9)
    }
    fx.dispose()
    expect(scene.getObjectByName('festival-fx')).toBeUndefined()
  })
})
