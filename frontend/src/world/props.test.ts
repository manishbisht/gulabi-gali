import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { buildProps } from './props'
import type { PropSpec } from './types'

describe('buildProps', () => {
  it('draws each kind as one InstancedMesh with one instance per prop', () => {
    const props: PropSpec[] = [
      { kind: 'lamp', at: { x: 0, z: 0 } },
      { kind: 'lamp', at: { x: 10, z: 0 } },
      { kind: 'lamp', at: { x: 20, z: 0 } },
      { kind: 'tapri', at: { x: 0, z: 10 } },
    ]
    const { group } = buildProps(props)
    const meshes = group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)
    expect(meshes.map((m) => m.count).sort()).toEqual([1, 3])
    const lamps = meshes.find((m) => m.count === 3)!
    const m = new THREE.Matrix4()
    lamps.getMatrixAt(2, m)
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(20)
  })

  it('builds every kind with a collider around where it stands', () => {
    const kinds: PropSpec['kind'][] = ['tapri', 'tree', 'lamp', 'auto', 'bench', 'poster-wall', 'station']
    const { group, colliders } = buildProps(kinds.map((kind, i) => ({ kind, at: { x: i * 10, z: 5 } })))
    expect(group.children).toHaveLength(kinds.length)
    expect(colliders).toHaveLength(kinds.length)
    colliders.forEach((c, i) => {
      expect(c.minX).toBeLessThan(i * 10)
      expect(c.maxX).toBeGreaterThan(i * 10)
      expect(c.minZ).toBeLessThan(5)
      expect(c.maxZ).toBeGreaterThan(5)
    })
  })

  it('turns the collider with the prop (rot in degrees, like buildings)', () => {
    const straight = buildProps([{ kind: 'auto', at: { x: 0, z: 0 } }]).colliders[0]!
    const turned = buildProps([{ kind: 'auto', at: { x: 0, z: 0 }, rot: 90 }]).colliders[0]!
    expect(turned.maxX - turned.minX).toBeCloseTo(straight.maxZ - straight.minZ)
    expect(turned.maxZ - turned.minZ).toBeCloseTo(straight.maxX - straight.minX)
  })

  it('returns an empty group for no props', () => {
    const { group, colliders } = buildProps([])
    expect(group.children).toHaveLength(0)
    expect(colliders).toEqual([])
  })
})
