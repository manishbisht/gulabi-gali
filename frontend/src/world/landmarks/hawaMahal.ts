import * as THREE from 'three'
import { archOpening, bake, box, cylinder, dome, halfPrism, merge } from '../kit/parts'
import type { PaletteKey } from '../palette'

/** Footprint, centred on the model's origin. The facade faces +z. */
export const HAWA_MAHAL = { w: 28, d: 7 }

const BASE_H = 3.4 // the arcaded street storey
const STOREY_H = 2.2
const FACE_Z = 2.4 // the wall plane the bays bulge out of (they reach 3.3 of the 3.5 half-depth)
/** Storeys of jharokhas per bay, west to east: a stepped pyramid peaking at five in the middle. */
const BAYS = [2, 2, 3, 3, 4, 4, 5, 5, 5, 4, 4, 3, 3, 2, 2]

type Parts = THREE.BufferGeometry[]

/** A half-hexagon slab (closed) bulging to +z: sills and the little eaves (chhajja) of each bay. */
function halfSlab(r: number, h: number, x: number, y: number, z: number, color: PaletteKey) {
  const g = new THREE.CylinderGeometry(r, r, h, 3, 1, false, -Math.PI / 2, Math.PI)
  g.translate(x, y + h / 2, z)
  return bake(g, color)
}

/** One storey of one bay: sill, bulging body, three framed windows and an eave. */
function jharokha(parts: Parts, r: number, x: number, y: number) {
  const bodyH = STOREY_H - 0.34
  parts.push(halfSlab(r + 0.1, 0.16, x, y, FACE_Z, 'white'))
  parts.push(halfPrism(r, bodyH, 3, x, y + 0.16, FACE_Z, 'pink'))
  parts.push(halfSlab(r + 0.14, 0.18, x, y + 0.16 + bodyH, FACE_Z, 'white'))
  const apothem = r * Math.cos(Math.PI / 6)
  for (const deg of [-60, 0, 60]) {
    const a = THREE.MathUtils.degToRad(deg)
    const pane = (w: number, h: number, out: number, color: PaletteKey) => {
      const g = new THREE.PlaneGeometry(w, h)
      g.rotateY(a)
      g.translate(x + Math.sin(a) * (apothem + out), y + 0.62 + h / 2, FACE_Z + Math.cos(a) * (apothem + out))
      return bake(g, color)
    }
    parts.push(pane(r * 0.62, 1.08, 0.01, 'white'), pane(r * 0.4, 0.86, 0.02, 'road'))
  }
}

/**
 * Hawa Mahal, the Palace of Winds: a five-storey honeycomb of jharokhas stepping up to a crown of
 * domes, over an arcade of shops. One merged, vertex-coloured mesh.
 */
export function buildHawaMahal(): THREE.Group {
  const { w, d } = HAWA_MAHAL
  const bayW = w / BAYS.length
  const left = -w / 2
  const parts: Parts = []

  // Street storey: shops under arches, a white plinth and a cornice.
  const backZ = -d / 2
  parts.push(box(w, BASE_H, FACE_Z - backZ, 0, 0, (FACE_Z + backZ) / 2, 'terracotta'))
  parts.push(box(w + 0.3, 0.35, FACE_Z - backZ + 0.3, 0, 0, (FACE_Z + backZ) / 2, 'white'))
  parts.push(box(w + 0.4, 0.3, FACE_Z - backZ + 1.4, 0, BASE_H - 0.3, (FACE_Z + backZ) / 2 + 0.5, 'white'))
  const arches = 9
  for (let i = 0; i < arches; i++) {
    const x = left + (w / arches) * (i + 0.5)
    parts.push(...archOpening(i === 4 ? 2 : 1.6, 1.7, 0.6, x, 0.35, FACE_Z + 0.005, 'road'))
  }

  // Stepped walls behind the bays: full depth low down, one room thick above the second storey.
  const top = Math.max(...BAYS)
  for (let s = 1; s <= top; s++) {
    const first = BAYS.findIndex((h) => h >= s)
    const last = BAYS.length - 1 - [...BAYS].reverse().findIndex((h) => h >= s)
    const span = (last - first + 1) * bayW
    const cx = left + (first + last + 1) * bayW * 0.5
    const depth = s <= 2 ? FACE_Z - backZ : 2.6
    const y = BASE_H + (s - 1) * STOREY_H
    parts.push(box(span, STOREY_H, depth, cx, y, FACE_Z - depth / 2, 'terracotta'))
    parts.push(box(span + 0.2, 0.14, depth + 0.2, cx, y + STOREY_H - 0.14, FACE_Z - depth / 2, 'white'))
  }

  // The honeycomb: wide and narrow bays alternate; white pilasters between them.
  BAYS.forEach((storeys, i) => {
    const x = left + bayW * (i + 0.5)
    const r = i % 2 === 0 ? bayW * 0.48 : bayW * 0.36
    for (let s = 0; s < storeys; s++) jharokha(parts, r, x, BASE_H + s * STOREY_H)
    const roof = BASE_H + storeys * STOREY_H
    // crown: a small dome and finial on every bay, taller over the middle
    const crown = storeys === top ? 0.7 : 0.5
    parts.push(dome(crown, x, roof, FACE_Z - 0.2, 'pink', 6))
    parts.push(cylinder(0.04, 0.09, 0.45, 4, x, roof + crown - 0.05, FACE_Z - 0.2, 'marigold'))
    const tallest = Math.max(storeys, BAYS[i + 1] ?? 0)
    if (i < BAYS.length - 1) {
      parts.push(box(0.12, tallest * STOREY_H, 0.2, left + bayW * (i + 1), BASE_H, FACE_Z + 0.05, 'white'))
    }
  })
  // A pediment over the middle three bays, as on the real crown.
  const peak = BASE_H + top * STOREY_H
  parts.push(box(bayW * 3, 0.9, 0.5, 0, peak, FACE_Z - 0.6, 'pink'))
  parts.push(box(bayW * 3 + 0.2, 0.14, 0.6, 0, peak + 0.9, FACE_Z - 0.6, 'white'))
  parts.push(...archOpening(1.2, 0.3, 0.4, 0, peak + 0.15, FACE_Z - 0.34, 'white'))

  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.name = 'hawa-mahal'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
