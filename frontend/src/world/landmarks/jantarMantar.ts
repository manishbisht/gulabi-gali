import * as THREE from 'three'
import { bake, box, cylinder, merge } from '../kit/parts'
import type { PaletteKey } from '../palette'

/** The instruments' footprint, centred on the model's origin. North is -z. */
export const JANTAR_MANTAR = { w: 22, d: 24 }

/** Jaipur's latitude: the Samrat Yantra's gnomon points at the pole star, so it rises at this angle. */
const LATITUDE = THREE.MathUtils.degToRad(26.9)

type Parts = THREE.BufferGeometry[]

/** A wall shaped as a right triangle: base `len` along z, rising to `h` at the north (-z) end. */
function wedge(len: number, h: number, thick: number, x: number, z: number, color: PaletteKey) {
  const shape = new THREE.Shape([
    new THREE.Vector2(-len / 2, 0),
    new THREE.Vector2(len / 2, 0),
    new THREE.Vector2(-len / 2, h),
  ])
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false })
  g.translate(0, 0, -thick / 2)
  g.rotateY(-Math.PI / 2) // shape x → world z, so the high end lands at -z
  g.translate(x, 0, z)
  return bake(g, color)
}

/**
 * Samrat Yantra, the great sundial: a stepped gnomon along the meridian, and the dial, a half ring
 * in the plane of the equator hanging from it.
 */
function samratYantra(parts: Parts) {
  const len = 22
  const h = len * Math.tan(LATITUDE)
  parts.push(wedge(len, h, 3, 0, 0, 'sandstone'))
  parts.push(box(3.4, 0.4, len + 0.4, 0, 0, 0, 'white'))
  // the stairs up the hypotenuse
  const steps = 14
  for (let i = 0; i < steps; i++) {
    const z = len / 2 - (len / steps) * (i + 0.5)
    const y = (h * (len / 2 - z)) / len
    parts.push(box(1.4, 0.3, len / steps, 0, y - 0.1, z, 'white'))
  }
  // the dial: a band on a circle of radius R centred on the gnomon edge, in the equatorial plane
  const R = 7
  const cz = -2.5
  const cy = (h * (len / 2 - cz)) / len
  const toWorld = new THREE.Matrix4()
    .makeTranslation(0, cy, cz)
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI + LATITUDE))
  const segs = 10
  const chord = 2 * R * Math.sin(Math.PI / segs / 2) + 0.1
  for (let i = 0; i < segs; i++) {
    const a = (Math.PI / segs) * (i + 0.5)
    const band = new THREE.BoxGeometry(chord, 0.45, 2.6)
      .rotateZ(a - Math.PI / 2)
      .translate(R * Math.cos(a), R * Math.sin(a), 0)
      .applyMatrix4(toWorld)
    parts.push(bake(band, i % 2 ? 'white' : 'sandstone'))
  }
  // piers holding the dial ends up where they meet the ground
  parts.push(box(1.2, cy, 1.2, -R, 0, cz, 'sandstone'))
  parts.push(box(1.2, cy, 1.2, R, 0, cz, 'sandstone'))
}

/** Ram Yantra: an open-roofed ring of pillars round a central post. */
function ramYantra(parts: Parts, x: number, z: number) {
  const r = 2.6
  parts.push(cylinder(r + 0.3, r + 0.3, 0.3, 8, x, 0, z, 'white'))
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    parts.push(box(0.5, 3, 0.5, x + r * Math.cos(a), 0.3, z + r * Math.sin(a), 'sandstone'))
  }
  parts.push(cylinder(r + 0.3, r + 0.3, 0.35, 8, x, 3.3, z, 'sandstone'))
  parts.push(cylinder(0.25, 0.25, 3.4, 6, x, 0.3, z, 'white'))
}

/** Jai Prakash Yantra: a sunken bowl, seen as a ringed rim with cross-wires above it. */
function jaiPrakash(parts: Parts, x: number, z: number) {
  const r = 3.2
  parts.push(cylinder(r, r + 0.2, 0.8, 10, x, 0, z, 'sandstone'))
  parts.push(cylinder(r - 0.4, r - 0.4, 0.04, 10, x, 0.8, z, 'teal'))
  parts.push(box(0.12, 1.6, 0.12, x - r, 0.8, z, 'road'), box(0.12, 1.6, 0.12, x + r, 0.8, z, 'road'))
  parts.push(box(2 * r, 0.05, 0.05, x, 2.35, z, 'road'))
}

/** Nadi Valaya Yantra: a dial on a pedestal, tilted to the equator. */
function nadiValaya(parts: Parts, x: number, z: number) {
  parts.push(box(2.2, 1.6, 1.4, x, 0, z, 'sandstone'))
  const dial = new THREE.CylinderGeometry(1.5, 1.5, 0.3, 10)
    .rotateX(Math.PI / 2 - LATITUDE)
    .translate(x, 2.9, z)
  parts.push(bake(dial, 'white'))
  const rod = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4)
    .rotateX(Math.PI / 2 - LATITUDE)
    .translate(x, 2.9, z)
  parts.push(bake(rod, 'road'))
}

/** Jantar Mantar: the Samrat Yantra with three smaller instruments tucked around it. */
export function buildJantarMantar(): THREE.Group {
  const parts: Parts = []
  samratYantra(parts)
  ramYantra(parts, 7.6, -8.6)
  jaiPrakash(parts, -7.3, 7.8)
  nadiValaya(parts, 7.4, 8.4)
  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.name = 'jantar-mantar'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
