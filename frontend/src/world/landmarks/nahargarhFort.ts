import * as THREE from 'three'
import { archOpening, box, chhatri, cylinder, dome, merge } from '../kit/parts'
import type { PaletteKey } from '../palette'

/**
 * Footprint, centred on the model's origin: the curtain wall's square on the ridge, its gateway in the middle of
 * the south (+z) face, where the road comes up.
 */
export const NAHARGARH_FORT = { w: 64, d: 36 }
/** The gateway's middle, from the model's origin. */
export const GATE = { x: 0, z: 18 }

type Parts = THREE.BufferGeometry[]

/** The curtain wall: its height, and how thick it is. */
const WALL_H = 6
const THICK = 1.6
/** The merlons along every wall top: one this far apart. */
const MERLON_STEP = 2.2

/** A straight run of curtain wall from (x0, z0) to (x1, z1) along x or z, with merlons along its top. */
function curtain(parts: Parts, x0: number, z0: number, x1: number, z1: number) {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0)
  const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0)
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const [w, d] = alongX ? [len, THICK] : [THICK, len]
  parts.push(box(w, WALL_H, d, cx, 0, cz, 'sandstone'))
  parts.push(box(w + 0.2, 0.3, d + 0.2, cx, WALL_H, cz, 'ochre'))
  const n = Math.max(2, Math.floor(len / MERLON_STEP))
  const step = len / n
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + step * (i + 0.5)
    parts.push(
      alongX
        ? box(step * 0.55, 0.9, THICK * 0.7, cx + t, WALL_H + 0.3, cz, 'sandstone')
        : box(THICK * 0.7, 0.9, step * 0.55, cx, WALL_H + 0.3, cz + t, 'sandstone'),
    )
  }
}

/** A round bastion at a corner of the curtain: taller than the wall, capped and crowned with a small dome. */
function bastion(parts: Parts, x: number, z: number, r: number) {
  const h = WALL_H + 2
  parts.push(cylinder(r, r + 0.4, h, 8, x, 0, z, 'ochre'))
  parts.push(cylinder(r + 0.25, r + 0.25, 0.35, 8, x, h, z, 'white'))
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    parts.push(box(0.9, 0.8, 0.9, x + Math.cos(a) * r * 0.85, h + 0.35, z + Math.sin(a) * r * 0.85, 'ochre'))
  }
}

/**
 * The gateway in the south face: a tall pol between two turrets, its doors shut under a pointed arch, a row of
 * small jharokha arches over it and a chhatri on top.
 */
function gateway(parts: Parts) {
  const { x } = GATE
  const front = GATE.z - 0.2 // just inside the footprint
  const H = 9
  parts.push(box(10, H, 4.4, x, 0, front - 2.2, 'ochre'))
  parts.push(box(10.4, 0.35, 4.6, x, H, front - 2.2, 'white'))
  parts.push(...archOpening(4.2, 4.6, 2.2, x, 0, front + 0.01, 'terracotta'))
  for (const wx of [-3, 0, 3]) parts.push(...archOpening(1, 1.1, 0.5, x + wx, 7, front + 0.01, 'teal'))
  for (let i = 0; i < 5; i++) parts.push(box(1, 0.8, 0.6, x - 4 + i * 2, H + 0.35, front - 0.4, 'ochre'))
  for (const s of [-1, 1]) {
    parts.push(cylinder(1.7, 1.9, H + 1.5, 8, x + s * 6.4, 0, front - 1.9, 'sandstone'))
    parts.push(cylinder(1.9, 1.9, 0.3, 8, x + s * 6.4, H + 1.5, front - 1.9, 'white'))
    parts.push(dome(1.5, x + s * 6.4, H + 1.8, front - 1.9, 'white', 8))
  }
  parts.push(...chhatri(x, H + 0.35, front - 2.2, 2.6, 'ochre'))
}

/**
 * The palace inside the walls (after Madhavendra Bhawan): a plain two-storey block in lime-white with ochre
 * bands, rows of small arched windows, and chhatris along its roof, standing well above the curtain wall.
 */
function palace(parts: Parts) {
  const x = 0
  const z = -4
  const band = (w: number, d: number, y: number, c: PaletteKey) => parts.push(box(w, 0.35, d, x, y, z, c))
  parts.push(box(34, 7, 20, x, 0, z, 'white'))
  band(34.4, 20.4, 7, 'ochre')
  for (let i = 0; i < 9; i++)
    parts.push(...archOpening(1.4, 1.8, 0.7, x - 14 + i * 3.5, 4, z + 10.01, 'teal'))
  parts.push(box(26, 5, 14, x, 7.35, z, 'white'))
  band(26.4, 14.4, 12.35, 'ochre')
  for (let i = 0; i < 7; i++)
    parts.push(...archOpening(1.2, 1.5, 0.6, x - 10.5 + i * 3.5, 9.2, z + 7.01, 'teal'))
  for (const cx of [-12, 0, 12]) parts.push(...chhatri(x + cx, 12.7, z + 5.4, 2.2, 'ochre'))
  for (const cx of [-12, 12]) parts.push(...chhatri(x + cx, 12.7, z - 5.4, 2.2, 'ochre'))
}

/**
 * Nahargarh Fort on its ridge: a square of crenellated curtain wall with round bastions at its corners, the
 * gateway in the south face and the palace rising inside. Original low-poly forms, floodlit after dark.
 */
export function buildNahargarhFort(): THREE.Group {
  // the wall's line, in from the footprint's edge so the corner bastions stay inside it
  const hw = NAHARGARH_FORT.w / 2 - 3.2
  const hd = NAHARGARH_FORT.d / 2 - 3.2
  const parts: Parts = []
  // the south face, either side of the gateway; then the other three
  curtain(parts, -hw, hd, GATE.x - 5, hd)
  curtain(parts, GATE.x + 5, hd, hw, hd)
  curtain(parts, -hw, -hd, hw, -hd)
  curtain(parts, -hw, -hd, -hw, hd)
  curtain(parts, hw, -hd, hw, hd)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bastion(parts, sx * hw, sz * hd, 2.6)
  for (const sx of [-1, 1]) bastion(parts, sx * hw * 0.5, -hd, 2) // two more along the back, on the ridge
  gateway(parts)
  palace(parts)

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: '#FFC27A',
    emissiveIntensity: 0,
  })
  material.userData.nightGlow = 0.3 // floodlit after dark; `applySky` turns it up
  const mesh = new THREE.Mesh(merge(parts), material)
  mesh.name = 'nahargarh-fort'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
