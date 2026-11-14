import * as THREE from 'three'
import { archOpening, box, chhatri, cylinder, dome, merge } from '../kit/parts'

/** Footprint, centred on the model's origin. The gate faces +z, out to JLN Marg. */
export const UNIVERSITY_GATE = { w: 18, d: 5 }

/**
 * The Rajasthan University gate on JLN Marg: a red-sandstone gateway, a tall arch between two lower
 * wings with arches of their own, a white name board, chhatris on top. Floodlit after dark.
 */
export function buildUniversityGate(): THREE.Group {
  const { w, d } = UNIVERSITY_GATE
  const H = 9.4
  const coreW = 8
  const wingW = (w - coreW) / 2 - 0.6
  const wingH = 6
  const zf = d / 2 - 0.4
  const parts: THREE.BufferGeometry[] = [
    box(coreW, H, d - 0.8, 0, 0, 0, 'terracotta'),
    box(coreW + 0.3, 0.45, d - 0.5, 0, 0, 0, 'white'),
    box(coreW + 0.5, 0.35, d - 0.3, 0, H, 0, 'white'),
  ]
  for (const side of [-1, 1]) {
    const x = side * (coreW / 2 + wingW / 2)
    parts.push(box(wingW, wingH, d - 0.8, x, 0, 0, 'terracotta'))
    parts.push(box(wingW + 0.3, 0.4, d - 0.5, x, 0, 0, 'white'))
    parts.push(box(wingW + 0.4, 0.3, d - 0.4, x, wingH, 0, 'white'))
    parts.push(...chhatri(x, wingH + 0.3, 0, 1.6, 'sandstone'))
    // domed post at each end
    const px = side * (w / 2 - 0.6)
    parts.push(cylinder(0.6, 0.7, wingH + 1.2, 8, px, 0, 0, 'terracotta'))
    parts.push(cylinder(0.8, 0.8, 0.3, 8, px, wingH + 1.2, 0, 'white'))
    parts.push(dome(0.6, px, wingH + 1.5, 0, 'sandstone', 6))
  }
  // arches front and back: the great one in the core, a smaller one in each wing
  for (const face of [1, -1]) {
    const openings = [
      archOpening(4, 4.6, 1.6, 0, 0.45, 0, 'road'),
      archOpening(2, 2.6, 0.8, -(coreW / 2 + wingW / 2), 0.4, 0, 'road'),
      archOpening(2, 2.6, 0.8, coreW / 2 + wingW / 2, 0.4, 0, 'road'),
    ].flat()
    for (const g of openings) {
      if (face < 0) g.rotateY(Math.PI)
      g.translate(0, 0, face * (zf + 0.005))
      parts.push(g)
    }
  }
  // the name board, the core's parapet and its three chhatris
  parts.push(box(6.4, 1.0, 0.15, 0, 6.7, zf + 0.08, 'white'))
  parts.push(box(5.6, 0.18, 0.18, 0, 7.1, zf + 0.16, 'terracotta'))
  parts.push(box(coreW + 0.3, 0.6, 0.25, 0, H + 0.35, zf, 'terracotta'))
  parts.push(...chhatri(0, H + 0.35, 0, 2.4, 'sandstone'))
  parts.push(...chhatri(-2.8, H + 0.35, 0, 1.4, 'sandstone'))
  parts.push(...chhatri(2.8, H + 0.35, 0, 1.4, 'sandstone'))

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: '#FFB070',
    emissiveIntensity: 0,
  })
  material.userData.nightGlow = 0.4 // floodlit after dark; `applySky` turns it up
  const mesh = new THREE.Mesh(merge(parts), material)
  mesh.name = 'university-gate'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
