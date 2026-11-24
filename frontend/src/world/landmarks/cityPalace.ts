import * as THREE from 'three'
import { archOpening, bake, box, chhatri, cylinder, dome, halfPrism, merge } from '../kit/parts'
import type { PaletteKey } from '../palette'

/**
 * Footprint, centred on the model's origin: the palace's walled precinct. Its gateway is in the middle of the
 * front (+z) wall; Chandra Mahal rises at the back.
 */
export const CITY_PALACE = { w: 60, d: 38 }
/** The gateway's middle, on the front wall, from the model's origin. */
export const PALACE_GATE = { x: 0, z: CITY_PALACE.d / 2 }

type Parts = THREE.BufferGeometry[]

const WALL_H = 5
const THICK = 1.2

/** A run of precinct wall along x or z, with a white coping and a row of kanguras along its top. */
function precinctWall(parts: Parts, x0: number, z0: number, x1: number, z1: number) {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0)
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0)
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const [w, d] = alongX ? [len, THICK] : [THICK, len]
  parts.push(box(w, WALL_H, d, cx, 0, cz, 'pink'))
  parts.push(box(w + 0.15, 0.25, d + 0.15, cx, WALL_H, cz, 'white'))
  const n = Math.max(2, Math.floor(len / 2.4))
  const step = len / n
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + step * (i + 0.5)
    parts.push(
      alongX
        ? box(step * 0.5, 0.6, THICK * 0.6, cx + t, WALL_H + 0.25, cz, 'pink')
        : box(THICK * 0.6, 0.6, step * 0.5, cx, WALL_H + 0.25, cz + t, 'pink'),
    )
  }
}

/**
 * The courtyard gateway in the front wall, after Virendra Pol: a tall pink pol with one great arch, the doors
 * open on the courtyard beyond; white line-work, a smaller arched niche each side, a row of jharokhas above
 * and chhatris on the roof.
 */
function gateway(parts: Parts) {
  const { x } = PALACE_GATE
  const front = PALACE_GATE.z - 0.8 // a little proud of the wall either side; its jharokhas stand out further
  const H = 10
  const W = 13
  const D = 4.4
  parts.push(box(W, H, D, x, 0, front - D / 2, 'pink'))
  parts.push(box(W + 0.4, 0.35, D + 0.2, x, H, front - D / 2, 'white'))
  parts.push(box(W + 0.2, 0.25, 0.3, x, 6.6, front - 0.05, 'white'))
  // the arch: open onto the sunlit courtyard
  parts.push(...archOpening(4.4, 4.2, 2.2, x, 0, front + 0.01, 'sandstone'))
  parts.push(box(5.4, 0.2, 0.25, x, 6.4, front, 'white'))
  // the niches either side, and a jharokha over each
  for (const s of [-1, 1]) {
    parts.push(...archOpening(1.6, 2.6, 0.8, x + s * 4.4, 0.4, front + 0.01, 'terracotta'))
    parts.push(box(1.9, 0.14, 0.8, x + s * 4.4, 7.3, front + 0.3, 'white'))
    parts.push(halfPrism(0.75, 1.4, 3, x + s * 4.4, 7.45, front, 'pink'))
    parts.push(box(2, 0.14, 1, x + s * 4.4, 8.85, front + 0.25, 'white'))
  }
  // a row of small arched windows over the great arch
  for (const wx of [-1.4, 0, 1.4]) parts.push(...archOpening(0.8, 1, 0.4, x + wx, 7.6, front + 0.01, 'teal'))
  // parapet, and chhatris: a big one over the arch, two small at the corners
  for (let i = 0; i < 6; i++) parts.push(box(1, 0.7, 0.5, x - 5 + i * 2, H + 0.35, front - 0.3, 'pink'))
  parts.push(...chhatri(x, H + 0.35, front - D / 2, 2.8, 'pink'))
  for (const s of [-1, 1]) {
    const tx = x + s * (W / 2 + 0.9)
    parts.push(cylinder(1.4, 1.5, H + 1, 8, tx, 0, front - 1.6, 'pink'))
    parts.push(cylinder(1.6, 1.6, 0.3, 8, tx, H + 1, front - 1.6, 'white'))
    parts.push(dome(1.3, tx, H + 1.3, front - 1.6, 'pink', 8))
    parts.push(cylinder(0.04, 0.1, 0.6, 4, tx, H + 2.5, front - 1.6, 'marigold'))
  }
}

/**
 * Chandra Mahal at the back of the precinct: seven storeys, each set back from the one below, in cream with
 * ochre bands and rows of arched windows, the top pavilion under a curved roof, and a flag on a pole above it.
 */
function chandraMahal(parts: Parts, z: number) {
  // [width, depth, storeys] from the ground up
  const tiers: [number, number, number][] = [
    [30, 12, 3],
    [24, 10, 1],
    [19, 8, 1],
    [14, 6.5, 1],
    [9, 5, 1],
  ]
  const S = 3.1
  let y = 0
  tiers.forEach(([w, d, n], i) => {
    const h = n * S
    const body: PaletteKey = 'white'
    parts.push(box(w, h, d, 0, y, z, body))
    parts.push(box(w + 0.3, 0.3, d + 0.3, 0, y + h, z, 'ochre'))
    // windows on the front, one row per storey
    for (let s = 0; s < n; s++) {
      const count = Math.max(3, Math.floor(w / 2.4))
      const step = w / count
      for (let k = 0; k < count; k++)
        parts.push(
          ...archOpening(
            0.9,
            1.2,
            0.45,
            -w / 2 + step * (k + 0.5),
            y + s * S + 0.7,
            z + d / 2 + 0.01,
            'ochre',
          ),
        )
    }
    // a chhatri on each front corner of the lower tiers
    if (i < 3)
      for (const sx of [-1, 1])
        parts.push(...chhatri(sx * (w / 2 - 1), y + h + 0.3, z + d / 2 - 1, 1.5, 'ochre'))
    y += h + 0.3
  })
  // the top pavilion (Mukut Mahal): a curved bangaldar roof, half a drum laid along x
  const roof = new THREE.CylinderGeometry(2.6, 2.6, 9.4, 8, 1, false, -Math.PI / 2, Math.PI)
  roof.rotateZ(Math.PI / 2)
  roof.scale(1, 0.6, 1)
  roof.translate(0, y, z)
  parts.push(bake(roof, 'white'))
  for (const x of [-3.2, 0, 3.2]) parts.push(cylinder(0.05, 0.12, 0.6, 4, x, y + 1.5, z, 'marigold'))
  // the flagpole, and the flag
  const top = y + 1.6
  parts.push(cylinder(0.06, 0.08, 4, 4, 0, top, z, 'white'))
  const stripes: PaletteKey[] = ['terracotta', 'marigold', 'grass', 'glass', 'white']
  stripes.forEach((c, k) => parts.push(box(2.2, 0.26, 0.05, 1.12, top + 3.75 - (k + 1) * 0.26, z, c)))
}

/**
 * The City Palace from the street: its precinct wall, the courtyard gateway in the middle of the front, low
 * ranges round the courtyard behind it, and Chandra Mahal's tiered silhouette rising at the back. Original
 * low-poly forms, floodlit after dark.
 */
export function buildCityPalace(): THREE.Group {
  const parts: Parts = []
  // the wall's line, in from the footprint's edge so the corner towers stay inside it
  const hw = CITY_PALACE.w / 2 - 1.8
  const hd = CITY_PALACE.d / 2 - 1.8
  const gateHalf = 6.5 + 2.4 // the gateway and its towers
  precinctWall(parts, -hw, hd, PALACE_GATE.x - gateHalf, hd)
  precinctWall(parts, PALACE_GATE.x + gateHalf, hd, hw, hd)
  precinctWall(parts, -hw, -hd, hw, -hd)
  precinctWall(parts, -hw, -hd, -hw, hd)
  precinctWall(parts, hw, -hd, hw, hd)
  // octagonal towers at the front corners
  for (const s of [-1, 1]) {
    parts.push(cylinder(1.6, 1.7, WALL_H + 1.5, 8, s * hw, 0, hd, 'pink'))
    parts.push(cylinder(1.8, 1.8, 0.3, 8, s * hw, WALL_H + 1.5, hd, 'white'))
    parts.push(dome(1.4, s * hw, WALL_H + 1.8, hd, 'pink', 8))
  }
  // the courtyard's ranges, seen over the front wall either side of the gate
  for (const s of [-1, 1]) {
    parts.push(box(18, 7, 6, s * 16, 0, hd - 5, 'pink'))
    parts.push(box(18.3, 0.3, 6.3, s * 16, 7, hd - 5, 'white'))
    for (let k = 0; k < 6; k++)
      parts.push(...archOpening(1, 1.3, 0.5, s * 16 - 7.5 + k * 3, 4.4, hd - 1.99, 'terracotta'))
  }
  gateway(parts)
  chandraMahal(parts, -hd + 8)

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: '#FFB56A',
    emissiveIntensity: 0,
  })
  material.userData.nightGlow = 0.35 // floodlit after dark; `applySky` turns it up
  const mesh = new THREE.Mesh(merge(parts), material)
  mesh.name = 'city-palace'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
