import * as THREE from 'three'
import { archOpening, box, chhatri, cylinder, dome, merge } from '../kit/parts'

/** Footprint, centred on the model's origin. The gate faces +z, out to MI Road. */
export const RAM_NIWAS_GATE = { w: 14, d: 4 }

/**
 * The gate of Ram Niwas Bagh: an ochre gateway with a tall arch (its iron gates shut; walkers use the
 * gaps either side), a parapet with a chhatri, and an octagonal domed post at each end.
 */
export function buildRamNiwasGate(): THREE.Group {
  const { w, d } = RAM_NIWAS_GATE
  const H = 7.4
  const body = w - 4.4 // between the end posts
  const zf = d / 2 - 0.3
  const parts: THREE.BufferGeometry[] = [
    box(body, H, d - 0.6, 0, 0, 0, 'ochre'),
    box(body + 0.3, 0.45, d - 0.3, 0, 0, 0, 'white'),
    box(body + 0.4, 0.3, d - 0.2, 0, 5.3, 0, 'white'),
    box(body + 0.5, 0.35, d, 0, H, 0, 'white'),
  ]
  // the arch and its two niches, front and back
  for (const side of [1, -1]) {
    const openings = [
      archOpening(3.4, 3.6, 1.3, 0, 0.45, 0, 'road'),
      archOpening(1.1, 1.8, 0.5, -3.2, 1.6, 0, 'terracotta'),
      archOpening(1.1, 1.8, 0.5, 3.2, 1.6, 0, 'terracotta'),
    ].flat()
    for (const g of openings) {
      if (side < 0) g.rotateY(Math.PI)
      g.translate(0, 0, side * (zf + 0.005))
      parts.push(g)
    }
  }
  // a signboard band over the arch, the parapet and the chhatri
  parts.push(box(4.6, 0.7, 0.12, 0, 6.1, zf + 0.06, 'white'))
  parts.push(box(body + 0.3, 0.6, 0.25, 0, H + 0.35, zf, 'ochre'))
  parts.push(box(body + 0.3, 0.6, 0.25, 0, H + 0.35, -zf, 'ochre'))
  parts.push(...chhatri(0, H + 0.35, 0, 2.4, 'ochre'))
  // octagonal end posts with little domes
  for (const x of [-(w / 2 - 1.2), w / 2 - 1.2]) {
    parts.push(cylinder(1.1, 1.2, 6.2, 8, x, 0, 0, 'ochre'))
    parts.push(cylinder(1.3, 1.3, 0.35, 8, x, 0, 0, 'white'))
    parts.push(cylinder(1.35, 1.35, 0.3, 8, x, 6.2, 0, 'white'))
    parts.push(dome(1.05, x, 6.5, 0, 'sandstone', 8))
    parts.push(cylinder(0.04, 0.1, 0.6, 4, x, 7.5, 0, 'marigold'))
  }
  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.name = 'ram-niwas-gate'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
