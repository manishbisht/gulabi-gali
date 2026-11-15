import * as THREE from 'three'
import { archOpening, bake, bakeHex, box, chhatri, cylinder, dome, merge } from '../kit/parts'
import type { PaletteKey } from '../palette'

/**
 * Footprint, centred on the model's origin: the hill, and in its south-east corner the gate at the foot of the
 * ramp. The palace looks south (+z), down over the lake.
 */
export const AMER_FORT = { w: 86, d: 48 }
/** The palace's middle up on the hill, and the gate's, from the model's origin. */
export const PALACE = { x: -7, z: -1 }
export const GATE = { x: 35, z: 20.5 }

type Parts = THREE.BufferGeometry[]

const ROCK = '#9A7B57'
/** The hill's flat top, where the palace stands. */
const TOP = 9

/** A low-poly hill: an n-sided frustum, squashed to an ellipse of radii `rx` by `rz` at its foot. */
function knoll(rx: number, rz: number, h: number, top: number, seg: number, x: number, z: number) {
  const g = new THREE.CylinderGeometry(top, 1, 1, seg, 1)
  g.scale(rx, h, rz).translate(x, h / 2, z)
  return bakeHex(g, ROCK)
}

/** A run of wall from `a` to `b` (each x, y, z: y its foot), `h` tall: the walls that climb the ridge. */
function run(parts: Parts, a: THREE.Vector3Like, b: THREE.Vector3Like, h: number, color: PaletteKey) {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = Math.hypot(dx, dz)
  const g = new THREE.BoxGeometry(len, h, 1)
  g.translate(0, h / 2, 0)
  g.rotateZ(Math.atan2(b.y - a.y, len))
  g.rotateY(Math.atan2(-dz, dx))
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  parts.push(bake(g, color))
}

/**
 * The ramp up from the gate: a walled causeway of stepped blocks rising along the hill's south-east slope from
 * the gate to the palace terrace, with a parapet on its lake side.
 */
function ramp(parts: Parts) {
  const from = { x: GATE.x - 6, z: GATE.z - 4, h: 1.2 }
  const to = { x: 12, z: 8, h: TOP - 0.6 }
  const dx = to.x - from.x
  const dz = to.z - from.z
  const steps = 9
  const seg = Math.hypot(dx, dz) / steps
  const yaw = Math.atan2(-dz, dx)
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps
    const h = from.h + ((to.h - from.h) * (i + 1)) / steps
    const at = (g: THREE.BufferGeometry) => g.rotateY(yaw).translate(from.x + dx * t, 0, from.z + dz * t)
    parts.push(bake(at(new THREE.BoxGeometry(seg + 0.05, h, 3.6).translate(0, h / 2, 0)), 'sandstone'))
    parts.push(bake(at(new THREE.BoxGeometry(seg + 0.05, 0.9, 0.35).translate(0, h + 0.45, -1.65)), 'ochre'))
  }
}

/** The gate at the foot of the ramp: a pol between two turrets, its doors shut, a chhatri over the arch. */
function gate(parts: Parts) {
  const { x, z } = GATE
  const H = 7
  parts.push(box(10, H, 5, x, 0, z, 'ochre'))
  parts.push(box(10.3, 0.35, 5.3, x, H, z, 'white'))
  parts.push(...archOpening(4, 4.4, 2, x, 0, z + 2.51, 'terracotta'))
  for (let i = 0; i < 5; i++) parts.push(box(1, 0.8, 0.5, x - 4 + i * 2, H + 0.35, z + 2.3, 'ochre'))
  for (const s of [-1, 1]) {
    parts.push(cylinder(1.4, 1.6, H + 2, 8, x + s * 6, 0, z + 0.4, 'sandstone'))
    parts.push(cylinder(1.6, 1.6, 0.3, 8, x + s * 6, H + 2, z + 0.4, 'white'))
    parts.push(dome(1.3, x + s * 6, H + 2.3, z + 0.4, 'white', 8))
  }
  parts.push(...chhatri(x, H + 0.35, z, 2.4, 'sandstone'))
}

/**
 * The palace on the hilltop: a long sandstone front of arches over the lake between round corner bastions,
 * a second, ochre storey with a tall white gateway in its middle, and a pavilion on top ringed by chhatris.
 */
function palace(parts: Parts) {
  const { x, z } = PALACE
  const T = TOP - 0.5
  // the long front, its arcade facing the lake, merlons along its top
  parts.push(box(34, 5, 18, x, T, z, 'sandstone'))
  parts.push(box(34.4, 0.35, 18.4, x, T + 5, z, 'white'))
  for (let i = 0; i < 8; i++)
    parts.push(...archOpening(2, 2.2, 0.8, x - 14 + i * 4, T + 1, z + 9.01, 'terracotta'))
  for (let i = 0; i < 12; i++)
    parts.push(box(1.1, 0.8, 0.5, x - 15.4 + i * 2.8, T + 5.35, z + 8.8, 'sandstone'))
  for (const s of [-1, 1]) {
    parts.push(cylinder(2.2, 2.6, 8, 8, x + s * 17, T, z + 8.6, 'ochre'))
    parts.push(cylinder(2.4, 2.4, 0.3, 8, x + s * 17, T + 8, z + 8.6, 'white'))
    parts.push(dome(2, x + s * 17, T + 8.3, z + 8.6, 'white', 8))
    parts.push(...chhatri(x + s * 14, T + 5.35, z - 7, 2, 'sandstone'))
  }
  // the second storey, and its gateway
  const U = T + 5.35
  parts.push(box(24, 5, 11, x + 2, U, z - 2, 'ochre'))
  parts.push(box(24.4, 0.3, 11.4, x + 2, U + 5, z - 2, 'white'))
  for (const wx of [-9, -6, -3, 7, 10])
    parts.push(...archOpening(1.2, 1.5, 0.5, x + 2 + wx, U + 1.6, z + 3.51, 'teal'))
  parts.push(box(7, 8.4, 1.4, x + 3, U, z + 4, 'white'))
  parts.push(...archOpening(3, 3.6, 1.2, x + 3, U, z + 4.71, 'terracotta'))
  parts.push(box(5, 1.2, 0.1, x + 3, U + 6, z + 4.72, 'teal'))
  parts.push(...chhatri(x + 3, U + 8.4, z + 4, 2.2, 'white'))
  // the pavilion on top, a chhatri on each corner
  const V = U + 5.3
  parts.push(box(12, 3.4, 7, x - 4, V, z - 4, 'sandstone'))
  parts.push(box(12.4, 0.3, 7.4, x - 4, V + 3.4, z - 4, 'white'))
  for (const cx of [-1, 1])
    for (const cz of [-1, 1]) parts.push(...chhatri(x - 4 + cx * 5, V + 3.7, z - 4 + cz * 2.6, 1.6, 'white'))
}

/**
 * Amer Fort on its hill: the rocky hill, its walls climbing the ridge behind, the palace on top looking down
 * over the lake, and the gate and ramp in the south-east corner where the walk up starts. Original low-poly forms,
 * floodlit after dark.
 */
export function buildAmerFort(): THREE.Group {
  const parts: Parts = [
    knoll(35.5, 23.5, TOP, 0.62, 9, PALACE.x, 0),
    knoll(16, 12, 15, 0.45, 7, -27, -10), // the ridge behind, where the walls climb on
  ]
  for (const [bx, bz, r] of [
    [-30, 12, 2.2],
    [18, 15, 1.8],
    [-18, -16, 2],
    [22, -10, 1.6],
  ] as const) {
    const g = new THREE.IcosahedronGeometry(r, 0).translate(bx, TOP * 0.45, bz)
    parts.push(bake(g, 'grass')) // scrub on the slopes
  }
  palace(parts)
  // the walls up the ridge, a bastion where they turn
  run(parts, { x: -24, y: TOP - 1, z: -6 }, { x: -30, y: 14, z: -12 }, 2.4, 'ochre')
  run(parts, { x: -30, y: 14, z: -12 }, { x: -40, y: 6, z: -20 }, 2.4, 'ochre')
  parts.push(cylinder(1.6, 1.8, 3.6, 8, -30, 13, -12, 'sandstone'), dome(1.5, -30, 16.6, -12, 'white'))
  ramp(parts)
  gate(parts)

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: '#FFC27A',
    emissiveIntensity: 0,
  })
  material.userData.nightGlow = 0.22 // floodlit after dark; `applySky` turns it up
  const mesh = new THREE.Mesh(merge(parts), material)
  mesh.name = 'amer-fort'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
