import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { storage } from '../storage'
import { PALETTE } from '../world/palette'
import { buildAvatar, loadOrCreateLook, randomLook } from './avatar'

function triangleCount(group: THREE.Group): number {
  let n = 0
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const g = o.geometry as THREE.BufferGeometry
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3
  })
  return n
}

describe('avatar', () => {
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
