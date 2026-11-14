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

  describe('parked autos', () => {
    const two: PropSpec[] = [
      { kind: 'lamp', at: { x: 50, z: 50 } },
      { kind: 'auto', at: { x: 0, z: 0 } },
      { kind: 'auto', at: { x: 20, z: 0 }, rot: 90 },
    ]
    const scale = (mesh: THREE.InstancedMesh, i: number) => {
      const m = new THREE.Matrix4()
      mesh.getMatrixAt(i, m)
      return new THREE.Vector3().setFromMatrixScale(m).x
    }

    it('finds the nearest one that is still parked', () => {
      const { autos } = buildProps(two)
      expect(autos.nearest({ x: 1, z: 1 }, 2.5)).toBe(0)
      expect(autos.nearest({ x: 18.5, z: 0 }, 2.5)).toBe(1)
      expect(autos.nearest({ x: 10, z: 0 }, 2.5)).toBe(-1)
      autos.take(0)
      expect(autos.nearest({ x: 1, z: 1 }, 2.5)).toBe(-1)
    })

    it('hides a taken auto and clears its collider, then puts both back where it was left', () => {
      const { group, colliders, autos } = buildProps(two)
      const mesh = group.children.find((c) => c.name === 'auto') as THREE.InstancedMesh
      const mine = colliders[1]!
      autos.take(0)
      expect(scale(mesh, 0)).toBe(0)
      expect(scale(mesh, 1)).toBe(1) // the other is untouched
      expect(mine.minX).toBeGreaterThan(1e6) // nobody bumps into a driven auto's ghost

      autos.leave(0, 30, 8, Math.PI / 2) // left turned a quarter
      expect(scale(mesh, 0)).toBe(1)
      const m = new THREE.Matrix4()
      mesh.getMatrixAt(0, m)
      const at = new THREE.Vector3().setFromMatrixPosition(m)
      expect([at.x, at.z]).toEqual([30, 8])
      // a quarter turn puts its long side along x
      expect(mine.maxX - mine.minX).toBeCloseTo(2.7)
      expect(mine.maxZ - mine.minZ).toBeCloseTo(1.4)
      expect((mine.minX + mine.maxX) / 2).toBeCloseTo(30)
      expect(autos.pose(0)).toEqual({ x: 30, z: 8, ry: Math.PI / 2 })
      expect(autos.nearest({ x: 30, z: 9 }, 2.5)).toBe(0)
    })

    it('has nothing to drive in a district with no autos', () => {
      const { autos } = buildProps([{ kind: 'lamp', at: { x: 0, z: 0 } }])
      expect(autos.nearest({ x: 0, z: 0 }, 100)).toBe(-1)
    })
  })
})
