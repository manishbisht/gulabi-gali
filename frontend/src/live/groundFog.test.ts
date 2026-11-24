import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import { createGroundFog, FOG_BANKS, fogTexture, MAX_OPACITY, onDistrictGround } from './groundFog'
import type { SkyParams } from './sky'

function stageAt(quality: 0 | 1 | 2) {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(30, 5, -12)
  return { scene: new THREE.Scene(), camera, quality } as unknown as Stage & { quality: 0 | 1 | 2 }
}
const sky = (groundFog: number) => ({ groundFog, skyHorizon: '#c8ccd2' }) as SkyParams
const banks = (stage: Stage) => stage.scene.getObjectByName('ground-fog')!

describe('fogTexture', () => {
  it('is a soft disc: opaque white at the middle, clear at the rim and corners', () => {
    const t = fogTexture()
    const d = t.image.data as Uint8Array
    const at = (x: number, y: number) => d[(y * 64 + x) * 4 + 3]!
    expect(at(32, 32)).toBeGreaterThan(250)
    expect(at(0, 0)).toBe(0)
    expect(at(63, 32)).toBeLessThan(5)
    expect(at(48, 32)).toBeLessThan(at(40, 32))
    t.dispose()
  })
})

describe('createGroundFog', () => {
  it('lays a handful of banks around the camera, as thick as the morning', () => {
    const stage = stageAt(2)
    const fog = createGroundFog(stage, { reducedMotion: () => false })
    fog.set(sky(0.5))
    fog.update(1 / 30)
    const group = banks(stage)
    expect(group.visible).toBe(true)
    expect(group.children).toHaveLength(FOG_BANKS)
    expect(group.position.x).toBe(30)
    expect(group.position.z).toBe(-12)
    const sprite = group.children[0] as THREE.Sprite
    expect(sprite.material.opacity).toBeCloseTo(MAX_OPACITY * 0.5)
    // one material and one texture for all of them
    expect(new Set(group.children.map((c) => (c as THREE.Sprite).material)).size).toBe(1)
    for (const c of group.children) {
      const r = Math.hypot(c.position.x, c.position.z)
      expect(r).toBeGreaterThanOrEqual(13 - 1e-6)
      expect(r).toBeLessThanOrEqual(24 + 1e-6)
      expect(c.position.y).toBeLessThan(2)
    }
    fog.dispose()
  })

  it('is not drawn without fog, nor on the lowest quality tier', () => {
    const stage = stageAt(2)
    const fog = createGroundFog(stage, { reducedMotion: () => false })
    fog.set(sky(0))
    fog.update(1 / 30)
    expect(banks(stage).visible).toBe(false)
    fog.set(sky(1))
    ;(stage as { quality: number }).quality = 0
    fog.update(1 / 30)
    expect(banks(stage).visible).toBe(false)
    ;(stage as { quality: number }).quality = 1
    fog.update(1 / 30)
    expect(banks(stage).visible).toBe(true)
    fog.dispose()
  })

  it('drifts slowly, and holds still under reduced motion', () => {
    for (const reduced of [false, true]) {
      const stage = stageAt(2)
      const fog = createGroundFog(stage, { reducedMotion: () => reduced })
      fog.set(sky(1))
      fog.update(1 / 30)
      const first = banks(stage).children[0]!.position.clone()
      for (let i = 0; i < 60; i++) fog.update(1 / 30)
      const moved = banks(stage).children[0]!.position.distanceTo(first)
      if (reduced) expect(moved).toBe(0)
      else {
        expect(moved).toBeGreaterThan(0)
        expect(moved).toBeLessThan(1) // two seconds of drift: barely anything
      }
      fog.dispose()
    }
  })

  it('lies on the ground the player stands on: up on a roof, at the roof', () => {
    const stage = stageAt(2)
    const roofY = 9.6
    const fog = createGroundFog(stage, {
      reducedMotion: () => false,
      floor: (p) => (p.x > 100 ? roofY : 0),
    })
    fog.set(sky(1))
    fog.update(1 / 30, { x: 0, z: 0 })
    expect(banks(stage).position.y).toBe(0)
    fog.update(1 / 30, { x: 120, z: 0 })
    expect(banks(stage).position.y).toBe(roofY)
    fog.dispose()
  })

  it('lays no bank off the district or over water', () => {
    const stage = stageAt(2) // the camera at (30, -12)
    // ground only west of x = 30: the banks east of the camera have none under them
    const fog = createGroundFog(stage, { reducedMotion: () => true, ground: (x) => x < 30 })
    fog.set(sky(1))
    fog.update(1 / 30, { x: 30, z: -10 })
    for (const c of banks(stage).children) expect(c.visible).toBe(c.position.x < 0)
    expect(banks(stage).children.some((c) => c.visible)).toBe(true)
    expect(banks(stage).children.some((c) => !c.visible)).toBe(true)
    fog.dispose()
  })

  it('allocates nothing per frame and lets go of its texture and material', () => {
    const stage = stageAt(2)
    const fog = createGroundFog(stage, { reducedMotion: () => false })
    fog.set(sky(1))
    fog.update(1 / 30)
    const sprite = banks(stage).children[0] as THREE.Sprite
    const pos = sprite.position
    fog.update(1 / 30)
    expect(sprite.position).toBe(pos)
    const material = vi.spyOn(sprite.material, 'dispose')
    const texture = vi.spyOn(sprite.material.map!, 'dispose')
    fog.dispose()
    expect(material).toHaveBeenCalled()
    expect(texture).toHaveBeenCalled()
    expect(stage.scene.getObjectByName('ground-fog')).toBeUndefined()
  })
})

describe('onDistrictGround', () => {
  const def = { size: 200, water: [{ minX: 10, maxX: 40, minZ: 10, maxZ: 40 }] }
  it('is the district square, less its water', () => {
    expect(onDistrictGround(def, 0, 0)).toBe(true)
    expect(onDistrictGround(def, 99, -99)).toBe(true)
    expect(onDistrictGround(def, 101, 0)).toBe(false)
    expect(onDistrictGround(def, 0, -101)).toBe(false)
    expect(onDistrictGround(def, 20, 20)).toBe(false)
    expect(onDistrictGround({ size: 200 }, 20, 20)).toBe(true)
  })
})
