import * as THREE from 'three'
import { box, cylinder, merge, spire } from '../kit/parts'

/** The fountain basin's footprint; the paved square around it is walkable. */
export const BADI_CHAUPAR = { w: 8.4, d: 8.4, square: 32 }

/** Badi Chaupar: a paved square with a tiered fountain in an octagonal basin at its heart. */
export function buildBadiChaupar(): THREE.Group {
  const s = BADI_CHAUPAR.square
  const r = BADI_CHAUPAR.w / 2
  const parts: THREE.BufferGeometry[] = [
    // paving in steps of 3 cm, so no two layers fight over the same depth
    box(s, 0.05, s, 0, 0, 0, 'white'),
    box(s - 3, 0.08, s - 3, 0, 0, 0, 'sandstone'),
    cylinder(r + 2.4, r + 2.4, 0.11, 8, 0, 0, 0, 'pink'),
    cylinder(r + 1.6, r + 1.6, 0.14, 8, 0, 0, 0, 'white'),
    cylinder(r, r + 0.1, 0.7, 8, 0, 0, 0, 'white'),
    cylinder(r - 0.3, r - 0.3, 0.05, 8, 0, 0.55, 0, 'teal'),
    cylinder(0.5, 0.7, 1.8, 6, 0, 0.6, 0, 'pink'),
    cylinder(1.8, 0.4, 0.4, 8, 0, 2.4, 0, 'white'),
    cylinder(0.3, 0.4, 1.0, 6, 0, 2.8, 0, 'pink'),
    cylinder(1.0, 0.25, 0.3, 8, 0, 3.8, 0, 'white'),
    spire(0.18, 0.9, 4, 0, 4.1, 0, 'marigold'),
  ]
  // water jets falling back into the basin
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    parts.push(spire(0.12, 1.4, 3, Math.cos(a) * 2.4, 0.6, Math.sin(a) * 2.4, 'white'))
  }
  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.name = 'badi-chaupar'
  mesh.receiveShadow = true
  mesh.castShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
