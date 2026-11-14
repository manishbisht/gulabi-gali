import * as THREE from 'three'
import { archOpening, bake, box, chhatri, cylinder, dome, merge } from '../kit/parts'

/** Footprint, centred on the model's origin. The facade faces +z. */
export const ALBERT_HALL = { w: 34, d: 20 }

const PLINTH = 1
const STOREY = 4.2
const WING_W = 10.5
const WING_D = 16
const CORE_W = 13
const CORE_D = 18
const CORE_H = PLINTH + 3 * STOREY

type Parts = THREE.BufferGeometry[]

/** A two-storey wing with an arcaded verandah on its front, a white chhajja over each storey. */
function wing(parts: Parts, cx: number) {
  const zf = WING_D / 2
  parts.push(box(WING_W, 2 * STOREY, WING_D, cx, PLINTH, 0, 'sandstone'))
  for (let s = 0; s < 2; s++) {
    const y = PLINTH + s * STOREY
    for (let i = 0; i < 3; i++) {
      const x = cx - WING_W / 2 + (WING_W / 3) * (i + 0.5)
      parts.push(...archOpening(2.2, 2.3, 0.9, x, y + 0.4, zf + 0.005, 'road'))
    }
    parts.push(box(WING_W + 0.3, 0.22, 1.1, cx, y + STOREY - 0.3, zf + 0.3, 'white'))
  }
  // parapet, and two chhatris on the roofline
  const top = PLINTH + 2 * STOREY
  parts.push(box(WING_W + 0.2, 0.6, 0.25, cx, top, zf - 0.1, 'white'))
  parts.push(...chhatri(cx - WING_W / 4, top, zf - 1.2, 1.5, 'sandstone'))
  parts.push(...chhatri(cx + WING_W / 4, top, zf - 1.2, 1.5, 'sandstone'))
}

/**
 * Albert Hall, in Ram Niwas Bagh: Indo-Saracenic, with arcaded wings either side of a three-storey core,
 * a porch under a great arch, octagonal corner towers and a central dome on a drum, ringed by chhatris.
 * One merged, vertex-coloured mesh, floodlit after dark.
 */
export function buildAlbertHall(): THREE.Group {
  const { w, d } = ALBERT_HALL
  const parts: Parts = [
    box(w, PLINTH, d, 0, 0, 0, 'white'),
    box(9, PLINTH * 0.5, 2, 0, 0, d / 2 + 0.6, 'white'), // the front steps
  ]
  const wingX = CORE_W / 2 + WING_W / 2
  wing(parts, -wingX)
  wing(parts, wingX)

  // corner towers at the wings' outer front corners
  for (const x of [-(w / 2 - 1.8), w / 2 - 1.8]) {
    const tz = WING_D / 2 - 1.4
    parts.push(cylinder(1.6, 1.7, CORE_H - 2, 8, x, PLINTH, tz, 'sandstone'))
    parts.push(cylinder(1.85, 1.85, 0.3, 8, x, PLINTH + STOREY - 0.3, tz, 'white'))
    parts.push(cylinder(1.85, 1.85, 0.35, 8, x, CORE_H - 2 + PLINTH - 0.35, tz, 'white'))
    parts.push(dome(1.6, x, CORE_H - 1, tz, 'white', 8))
    parts.push(cylinder(0.05, 0.12, 0.8, 4, x, CORE_H + 0.55, tz, 'marigold'))
  }

  // the core: three storeys, arched windows over a projecting porch
  const zc = CORE_D / 2
  parts.push(box(CORE_W, CORE_H - PLINTH, CORE_D, 0, PLINTH, 0, 'sandstone'))
  parts.push(box(CORE_W + 0.4, 0.3, CORE_D + 0.4, 0, CORE_H - 0.3, 0, 'white'))
  for (const x of [-4, 0, 4]) {
    parts.push(...archOpening(1.8, 2.2, 0.8, x, PLINTH + 2 * STOREY + 0.5, zc + 0.005, 'road'))
  }
  parts.push(box(CORE_W + 0.3, 0.22, 1.0, 0, PLINTH + 2 * STOREY - 0.2, zc + 0.3, 'white'))
  // the porch: a deep box with the great arch on its face and a balcony on top
  const porchD = d / 2 - zc + 1.5
  const porchZ = d / 2 - porchD / 2
  const porchH = 1.6 * STOREY
  parts.push(box(9, porchH, porchD, 0, PLINTH, porchZ, 'sandstone'))
  parts.push(...archOpening(4.4, 3.6, 1.5, 0, PLINTH + 0.3, d / 2 + 0.005, 'road'))
  parts.push(...archOpening(1.4, 2.4, 0.6, -3.3, PLINTH + 0.3, d / 2 + 0.005, 'road'))
  parts.push(...archOpening(1.4, 2.4, 0.6, 3.3, PLINTH + 0.3, d / 2 + 0.005, 'road'))
  parts.push(box(9.4, 0.3, porchD + 0.4, 0, PLINTH + porchH, porchZ, 'white'))
  parts.push(box(9.4, 0.7, 0.2, 0, PLINTH + porchH + 0.3, d / 2 + 0.1, 'white'))
  parts.push(...chhatri(-3.6, PLINTH + porchH + 0.3, porchZ, 1.4, 'sandstone'))
  parts.push(...chhatri(3.6, PLINTH + porchH + 0.3, porchZ, 1.4, 'sandstone'))

  // the crown: an octagonal drum with a band of arches, the great dome and its finial
  parts.push(cylinder(4, 4.2, 3.2, 8, 0, CORE_H, 0, 'sandstone'))
  parts.push(cylinder(4.5, 4.5, 0.35, 8, 0, CORE_H + 3.2, 0, 'white'))
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    const pane = new THREE.PlaneGeometry(1.2, 1.9)
    pane.rotateY(a)
    pane.translate(Math.sin(a) * 4.0, CORE_H + 1.5, Math.cos(a) * 4.0)
    parts.push(bake(pane, 'road'))
  }
  parts.push(dome(4.3, 0, CORE_H + 3.55, 0, 'white', 8))
  parts.push(cylinder(0.08, 0.2, 1.4, 6, 0, CORE_H + 3.55 + 4.2, 0, 'marigold'))
  // corner chhatris around the drum
  for (const [x, z] of [
    [-5, 7],
    [5, 7],
    [-5, -7],
    [5, -7],
  ] as const) {
    parts.push(...chhatri(x, CORE_H, z, 1.8, 'sandstone'))
  }

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: '#FFB070',
    emissiveIntensity: 0,
  })
  material.userData.nightGlow = 0.4 // floodlit after dark; `applySky` turns it up
  const mesh = new THREE.Mesh(merge(parts), material)
  mesh.name = 'albert-hall'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
