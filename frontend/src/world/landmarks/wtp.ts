import * as THREE from 'three'
import { bake, box, merge } from '../kit/parts'

/** Footprint, centred on the model's origin. The entrances face +z, out to JLN Marg. */
export const WTP = { w: 36, d: 22 }

const STOREY = 3.6
const STOREYS = 4
const H = STOREY * STOREYS
const GAP = 8 // the street between the two blocks, which the bridge crosses
const RISE = 6 // of the curved roof

type Parts = THREE.BufferGeometry[]

/** One glass block: white floor bands, mullions on the street face, an entrance under a canopy. */
function block(parts: Parts, cx: number, w: number, d: number) {
  const zf = d / 2
  parts.push(box(w, H, d, cx, 0, 0, 'glass'))
  for (let k = 1; k <= STOREYS; k++) parts.push(box(w + 0.2, 0.4, d + 0.2, cx, k * STOREY - 0.4, 0, 'white'))
  for (let x = -w / 2 + 1.5; x <= w / 2 - 1.4; x += 3) {
    parts.push(box(0.18, H - STOREY, 0.16, cx + x, STOREY, zf + 0.08, 'white'))
  }
  // the street storey: a white frame round dark doors, under a deep canopy
  parts.push(box(w * 0.5, 2.8, 0.1, cx, 0, zf + 0.05, 'white'))
  parts.push(box(w * 0.5 - 1, 2.4, 0.12, cx, 0, zf + 0.06, 'road'))
  parts.push(box(w * 0.6, 0.3, 2.4, cx, 3.2, zf + 1.1, 'white'))
}

/** The curved roof: a vault across the whole width, so its curve is what you see from JLN Marg. */
function vault(chord: number, len: number): THREE.BufferGeometry {
  const r = (chord * chord) / 4 / (2 * RISE) + RISE / 2
  const half = Math.asin(chord / 2 / r)
  const shape = new THREE.Shape()
  const segs = 10
  for (let i = 0; i <= segs; i++) {
    const a = -half + (2 * half * i) / segs
    const p = new THREE.Vector2(Math.sin(a) * r, Math.cos(a) * r - (r - RISE))
    if (i === 0) shape.moveTo(p.x, p.y)
    else shape.lineTo(p.x, p.y)
  }
  shape.lineTo(chord / 2, -0.3)
  shape.lineTo(-chord / 2, -0.3)
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false })
  g.translate(0, H + 0.3, -len / 2) // the profile spans x; the vault runs back along z
  return bake(g, 'white')
}

/**
 * World Trade Park: two glass blocks, north and south in the real mall and side by side here, joined
 * by a bridge of restaurants over the street between them, under one curved silver roof. Its lights
 * come on after dark.
 */
export function buildWtp(): THREE.Group {
  const { w, d } = WTP
  const bw = (w - GAP) / 2
  const parts: Parts = []
  block(parts, -(GAP / 2 + bw / 2), bw, d)
  block(parts, GAP / 2 + bw / 2, bw, d)
  // the street between: glass screens front and back, and the bridge across at the third storey
  parts.push(box(GAP, 2 * STOREY, 0.3, 0, 0, d / 2 - 2, 'glass'))
  parts.push(box(GAP, 2 * STOREY, 0.3, 0, 0, -d / 2 + 2, 'glass'))
  parts.push(box(GAP, 0.4, 0.4, 0, 2 * STOREY, d / 2 - 2, 'white'))
  parts.push(box(GAP + 0.2, STOREY, d - 6, 0, 2 * STOREY + 0.6, 0, 'glass'))
  parts.push(box(GAP + 0.3, 0.5, d - 5.8, 0, 2 * STOREY + 0.6, 0, 'white'))
  parts.push(box(GAP + 0.3, 0.35, d - 5.8, 0, 3 * STOREY + 0.6, 0, 'marigold')) // the bridge's lit band
  // the name board, high on the west block
  parts.push(box(9, 2.4, 0.3, -(GAP / 2 + bw / 2), H - STOREY + 0.4, d / 2 + 0.2, 'pink'))
  parts.push(box(7.6, 1.2, 0.34, -(GAP / 2 + bw / 2), H - STOREY + 1, d / 2 + 0.2, 'white'))
  parts.push(vault(w + 1, d + 1))
  // a skylight band along the crown
  const sky = new THREE.PlaneGeometry(3, d - 1).rotateX(-Math.PI / 2).translate(0, H + 0.3 + RISE + 0.03, 0)
  parts.push(bake(sky, 'glass'))

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: '#9FD4FF',
    emissiveIntensity: 0,
  })
  material.userData.nightGlow = 0.3 // lit up after dark; `applySky` turns it up
  const mesh = new THREE.Mesh(merge(parts), material)
  mesh.name = 'wtp'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
