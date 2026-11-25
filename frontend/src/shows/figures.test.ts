import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { SHOW_KINDS, SHOW_RADIUS } from '../world/shows'
import { createShowRig, DANCERS, showMaterial, type ShowRig, type Tier } from './figures'

const TIERS: Tier[] = [0, 1, 2]

const meshesOf = (rig: ShowRig) => rig.group.children as THREE.InstancedMesh[]
/** Every instance matrix of a rig, flattened: what a step may or may not have changed. */
const pose = (rig: ShowRig) => meshesOf(rig).flatMap((m) => [...m.instanceMatrix.array].map((v) => v + 0))
const versions = (rig: ShowRig) => meshesOf(rig).map((m) => m.instanceMatrix.version)

describe('the shows’ figures', () => {
  it.each(SHOW_KINDS)('%s: instanced pieces on one material, four draw calls at most', (kind) => {
    const material = showMaterial()
    for (const tier of TIERS) {
      const rig = createShowRig(kind, tier, material)
      const meshes = meshesOf(rig)
      expect(rig.calls).toBe(meshes.length)
      expect(meshes.length).toBeGreaterThan(0)
      expect(meshes.length).toBeLessThanOrEqual(4)
      for (const m of meshes) {
        expect(m).toBeInstanceOf(THREE.InstancedMesh)
        expect(m.material).toBe(material)
        // tinted per instance or left white: every piece compiles the one program
        expect(m.instanceColor).not.toBeNull()
        expect(m.castShadow).toBe(false)
      }
      rig.dispose()
    }
  })

  it('the lowest tier is thinner: fewer pieces, two dancers instead of three', () => {
    const material = showMaterial()
    const calls = (kind: (typeof SHOW_KINDS)[number], tier: Tier) => createShowRig(kind, tier, material).calls
    expect(calls('dancers', 0)).toBeLessThan(calls('dancers', 2))
    expect(calls('dancers', 2)).toBe(4)
    expect(calls('kathputli', 2)).toBe(3)
    expect(calls('ravanhatta', 2)).toBe(3)
    expect(DANCERS).toEqual([2, 3, 3])
    const count = (tier: Tier) =>
      meshesOf(createShowRig('dancers', tier, material)).find((m) => m.name === 'show-dancers')!.count
    expect(count(0)).toBe(2)
    expect(count(2)).toBe(3)
  })

  it.each(SHOW_KINDS)(
    '%s: idle, a step moves nothing; performing, it does, and stays on its ground',
    (kind) => {
      const material = showMaterial()
      for (const tier of TIERS) {
        const rig = createShowRig(kind, tier, material)
        const idle = pose(rig)
        rig.step(0.5, 0, 0, 0)
        expect(pose(rig)).toEqual(idle)
        for (let i = 0; i < 90; i++) rig.step(1 / 30, 1, 0, 0.4)
        const moving = pose(rig)
        expect(moving).not.toEqual(idle)
        expect(moving.every(Number.isFinite)).toBe(true)
        // a clap: they bow, wherever in the performance they are
        rig.step(0, 1, 1, 0.4)
        expect(pose(rig)).not.toEqual(moving)
        const m4 = new THREE.Matrix4()
        const at = new THREE.Vector3()
        for (const m of meshesOf(rig))
          for (let i = 0; i < m.count; i++) {
            m.getMatrixAt(i, m4)
            // never mirrored: a mirrored instance would be drawn inside out
            expect(m4.determinant()).toBeGreaterThan(0)
            at.setFromMatrixPosition(m4)
            expect(Math.hypot(at.x, at.z)).toBeLessThan(SHOW_RADIUS[kind])
          }
        rig.dispose()
      }
    },
  )

  it('no cloth sway on the lowest tier: the puppets do not swing on their strings, the skirts do not flare', () => {
    const material = showMaterial()
    const euler = new THREE.Euler()
    const m4 = new THREE.Matrix4()
    const swing = (tier: Tier) => {
      const rig = createShowRig('kathputli', tier, material)
      let most = 0
      for (let i = 0; i < 60; i++) {
        rig.step(1 / 30, 1, 0, 0)
        meshesOf(rig)
          .find((m) => m.name === 'show-kathputli-puppets')!
          .getMatrixAt(0, m4)
        most = Math.max(most, Math.abs(euler.setFromRotationMatrix(m4, 'XYZ').z))
      }
      return most
    }
    expect(swing(0)).toBeLessThan(1e-6)
    expect(swing(2)).toBeGreaterThan(0.1)
    const names = (tier: Tier) => meshesOf(createShowRig('dancers', tier, material)).map((m) => m.name)
    expect(names(0)).not.toContain('show-dancers-skirts')
    expect(names(1)).toContain('show-dancers-skirts')
  })

  it('writes only its own buffers, and frees them on dispose', () => {
    const material = showMaterial()
    const dispose = vi.spyOn(material, 'dispose')
    const scene = new THREE.Group()
    const rig = createShowRig('dancers', 2, material)
    scene.add(rig.group)
    const before = versions(rig)
    rig.step(1 / 60, 1, 0, 0)
    // the drummer's own piece is placed once and never written again
    const after = versions(rig)
    const drummer = meshesOf(rig).findIndex((m) => m.name === 'show-dancers-dholak')
    expect(after[drummer]).toBe(before[drummer])
    expect(after.filter((v, i) => v !== before[i]).length).toBe(3)
    const freed = meshesOf(rig).map((m) => vi.spyOn(m.geometry, 'dispose'))
    rig.dispose()
    expect(scene.children).toHaveLength(0)
    for (const f of freed) expect(f).toHaveBeenCalledOnce()
    // the material is the caller's: shared by every show in the district
    expect(dispose).not.toHaveBeenCalled()
  })
})
