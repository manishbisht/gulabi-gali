import * as THREE from 'three'
import { archOpening, box, chhatri, cylinder, dome, halfPrism, merge } from '../kit/parts'

/** Footprint, centred on the model's origin. The gate faces +z. */
export const TRIPOLIA_GATE = { w: 18, d: 6 }

/**
 * Tripolia, the triple gate: three arches (the middle one tallest) under a storey of jharokhas,
 * with chhatris on the roof and an octagonal tower at each end. The doors stay shut: the gate is
 * kept for the royal family.
 */
export function buildTripoliaGate(): THREE.Group {
  const { w, d } = TRIPOLIA_GATE
  const H = 9.5
  const body = w - 3.4 // between the towers
  const zf = d / 2 - 0.4
  const parts: THREE.BufferGeometry[] = [
    box(body, H, d - 0.8, 0, 0, 0, 'pink'),
    box(body + 0.3, 0.4, d - 0.5, 0, 0, 0, 'white'),
    box(body + 0.3, 0.3, d - 0.5, 0, 6.9, 0, 'white'),
    box(body + 0.5, 0.35, d - 0.3, 0, H, 0, 'white'),
  ]
  // the three arches, on the street face and the back
  for (const side of [1, -1]) {
    const z = side * (zf + 0.005)
    const arches = [
      archOpening(3.6, 3.8, 1.8, 0, 0.4, 0, 'terracotta'),
      archOpening(2.4, 2.8, 1.2, -4.2, 0.4, 0, 'terracotta'),
      archOpening(2.4, 2.8, 1.2, 4.2, 0.4, 0, 'terracotta'),
    ].flat()
    for (const g of arches) {
      if (side < 0) g.rotateY(Math.PI)
      g.translate(0, 0, z)
      parts.push(g)
    }
  }
  // the upper storey: three jharokhas over the arches, with white eaves
  for (const x of [-4.2, 0, 4.2]) {
    parts.push(box(2, 0.15, 0.9, x, 7.25, zf + 0.35, 'white'))
    parts.push(halfPrism(0.85, 1.6, 3, x, 7.4, zf, 'pink'))
    parts.push(box(0.9, 1.0, 0.05, x, 7.6, zf + 0.75, 'road'))
    parts.push(box(2.1, 0.15, 1.1, x, 9.0, zf + 0.3, 'white'))
  }
  // parapet and roof chhatris
  parts.push(box(body + 0.3, 0.7, 0.25, 0, H + 0.35, zf + 0.1, 'white'))
  parts.push(...chhatri(0, H + 0.35, 0, 2.6, 'pink'))
  parts.push(...chhatri(-4.6, H + 0.35, 0, 1.6, 'pink'))
  parts.push(...chhatri(4.6, H + 0.35, 0, 1.6, 'pink'))
  // end towers
  for (const x of [-(w / 2 - 1.5), w / 2 - 1.5]) {
    parts.push(cylinder(1.5, 1.6, H + 1.5, 8, x, 0, 0, 'pink'))
    parts.push(cylinder(1.7, 1.7, 0.3, 8, x, 6.9, 0, 'white'))
    parts.push(cylinder(1.7, 1.7, 0.4, 8, x, H + 1.5, 0, 'white'))
    parts.push(dome(1.4, x, H + 1.9, 0, 'pink', 8))
    parts.push(cylinder(0.05, 0.12, 0.7, 4, x, H + 3.2, 0, 'marigold'))
  }
  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.name = 'tripolia-gate'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
