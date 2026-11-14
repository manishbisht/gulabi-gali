import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { storage } from '../storage'
import { PALETTE } from '../world/palette'
import { buildAvatar, disposeAvatarCache, loadOrCreateLook, randomLook } from './avatar'

function triangleCount(group: THREE.Object3D): number {
  let n = 0
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const g = o.geometry as THREE.BufferGeometry
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3
  })
  return n
}

function drawCalls(root: THREE.Object3D): number {
  let n = 0
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) n++
  })
  return n
}

describe('avatar', () => {
  it('an avatar is a single draw call', () => {
    for (const head of ['none', 'safa', 'cap', 'dupatta', 'bun'] as const) {
      const a = buildAvatar({ skin: 2, outfit: 'teal', head })
      expect(a).toBeInstanceOf(THREE.Mesh)
      expect(drawCalls(a)).toBe(1)
      expect(a.getObjectByProperty('isGroup', true)).toBeUndefined()
      expect(a.geometry.getAttribute('color')).toBeDefined()
    }
  })

  it('two identical looks share geometry and material; different looks do not', () => {
    const look = { skin: 1, outfit: 'pink', head: 'safa' } as const
    const a = buildAvatar(look)
    const b = buildAvatar({ ...look })
    expect(b.geometry).toBe(a.geometry)
    expect(b.material).toBe(a.material)
    expect(buildAvatar({ ...look, skin: 3 }).geometry).not.toBe(a.geometry)
  })

  it('casts a shadow by default (the local player) and not when asked', () => {
    const look = { skin: 0, outfit: 'pink', head: 'none' } as const
    expect(buildAvatar(look).castShadow).toBe(true)
    expect(buildAvatar(look, { castShadow: false }).castShadow).toBe(false)
  })

  it('stays under the triangle budget for every head', () => {
    for (const head of ['none', 'safa', 'cap', 'dupatta', 'bun'] as const)
      expect(triangleCount(buildAvatar({ skin: 2, outfit: 'teal', head }))).toBeLessThan(600)
  })

  it('gives each head its own geometry', () => {
    const count = (head: 'none' | 'safa') => triangleCount(buildAvatar({ skin: 0, outfit: 'pink', head }))
    expect(count('safa')).toBeGreaterThan(count('none'))
  })

  it('randomLook is deterministic for a given rand and always valid', () => {
    expect(randomLook(() => 0)).toEqual({ skin: 0, outfit: 'pink', head: 'none' })
    const top = randomLook(() => 0.999999)
    expect([0, 1, 2, 3, 4]).toContain(top.skin)
    expect(Object.keys(PALETTE)).toContain(top.outfit)
  })

  it('loadOrCreateLook creates once, persists under gg-look, and ignores junk', () => {
    storage.set('gg-look', '{"nope":1}')
    const made = loadOrCreateLook()
    expect(storage.getJSON('gg-look', null)).toEqual(made)
    expect(loadOrCreateLook()).toEqual(made)
  })
})

describe('disposeAvatarCache', () => {
  const look = { skin: 1, outfit: 'pink', head: 'cap' } as const

  it('disposes the cached geometry and material, and the next avatar is fresh and usable', () => {
    const old = buildAvatar(look)
    const geoDispose = vi.fn()
    const matDispose = vi.fn()
    old.geometry.addEventListener('dispose', geoDispose)
    ;(old.material as THREE.Material).addEventListener('dispose', matDispose)
    disposeAvatarCache()
    expect(geoDispose).toHaveBeenCalledTimes(1)
    expect(matDispose).toHaveBeenCalledTimes(1)
    const fresh = buildAvatar(look)
    expect(fresh.geometry).not.toBe(old.geometry)
    expect(fresh.material).not.toBe(old.material)
    expect(fresh.geometry.getAttribute('position').count).toBeGreaterThan(0)
    expect(buildAvatar({ ...look }).geometry).toBe(fresh.geometry) // caching works again
  })

  it('is safe to call twice', () => {
    disposeAvatarCache()
    expect(() => disposeAvatarCache()).not.toThrow()
  })
})
