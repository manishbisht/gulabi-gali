import * as THREE from 'three'
import { archOpening, bake, box, cylinder, dome, merge } from '../kit/parts'

/**
 * Footprint, centred on the model's origin: the palace where it rises out of the lake. Its front, the face with
 * the pavilion, is +z; the district turns it to face the shore it is seen from.
 */
export const JAL_MAHAL = { w: 16, d: 14 }

type Parts = THREE.BufferGeometry[]

/**
 * What shows above the water: the top storey alone (the other four stay under a full lake), tall and arcaded,
 * and above it the roof terrace's pavilions, set back from its edge.
 */
const BODY_H = 4.2
/** The body's walls, in from the footprint's edge so the corner towers stand inside it. */
const BODY = { w: 14, d: 12 }
const TOWER_R = 1.3
/** The roof: its parapet's top, and the open galleries set back along its back and sides. */
const ROOF = BODY_H + 0.3
const GALLERY = { h: 2, deep: 1.6, back: 1.6 }

/**
 * Arches along one face: `n` of them, evenly spaced, on the face that looks along `a` (radians about y, 0 looking
 * +z), `half` out from the middle. `archOpening` draws on a +z face; each is turned and set out.
 */
function arcade(
  parts: Parts,
  a: number,
  half: number,
  length: number,
  n: number,
  y: number,
  w: number,
  h: number,
) {
  const step = length / n
  for (let i = 0; i < n; i++) {
    const along = -length / 2 + step * (i + 0.5)
    for (const g of archOpening(w, h, w / 2, along, y, 0.02, 'terracotta')) {
      g.rotateY(a)
      g.translate(Math.sin(a) * half, 0, Math.cos(a) * half)
      parts.push(g)
    }
  }
}

/** An octagonal chhatri on a corner tower: a drum of eight sides under a white dome and a gilt finial. */
function cornerChhatri(parts: Parts, x: number, z: number) {
  const y = ROOF + 0.3
  parts.push(cylinder(TOWER_R + 0.15, TOWER_R + 0.15, 0.2, 8, x, y, z, 'white'))
  parts.push(cylinder(TOWER_R * 0.8, TOWER_R * 0.8, 1.8, 8, x, y + 0.2, z, 'ochre'))
  parts.push(cylinder(TOWER_R, TOWER_R, 0.18, 8, x, y + 2, z, 'white'))
  parts.push(dome(TOWER_R * 0.85, x, y + 2.18, z, 'white', 8))
  parts.push(cylinder(0.04, 0.1, 0.5, 4, x, y + 2.18 + TOWER_R * 0.85 - 0.05, z, 'marigold'))
}

/**
 * Jal Mahal in Man Sagar: a symmetrical sandstone palace of five storeys, four of them under a full lake, so only
 * the top one shows, arcaded on every face. On its roof terrace, set back from a low parapet round the garden:
 * open galleries along the back and sides, an octagonal domed chhatri on each corner tower, and over the middle
 * of the front a pavilion under a curved bangaldar roof. Original low-poly forms, floodlit after dark.
 */
export function buildJalMahal(): THREE.Group {
  const parts: Parts = []
  const hw = BODY.w / 2
  const hd = BODY.d / 2
  // the wet stone at the waterline, the storey above the water, and the cornice under the parapet
  parts.push(box(BODY.w + 0.4, 0.5, BODY.d + 0.4, 0, 0, 0, 'terracotta'))
  parts.push(box(BODY.w, BODY_H, BODY.d, 0, 0, 0, 'sandstone'))
  parts.push(box(BODY.w + 0.4, 0.3, BODY.d + 0.4, 0, BODY_H, 0, 'white'))
  // the parapet round the roof garden
  parts.push(box(BODY.w, 0.6, 0.3, 0, ROOF, hd - 0.15, 'sandstone'))
  parts.push(box(BODY.w, 0.6, 0.3, 0, ROOF, -hd + 0.15, 'sandstone'))
  parts.push(box(0.3, 0.6, BODY.d, hw - 0.15, ROOF, 0, 'sandstone'))
  parts.push(box(0.3, 0.6, BODY.d, -hw + 0.15, ROOF, 0, 'sandstone'))
  parts.push(box(BODY.w - 0.6, 0.08, BODY.d - 0.6, 0, ROOF, 0, 'grass'))
  // the storey's tall arches, on all four faces
  for (const [a, half, length] of [
    [0, hd, BODY.w],
    [Math.PI, hd, BODY.w],
    [Math.PI / 2, hw, BODY.d],
    [-Math.PI / 2, hw, BODY.d],
  ] as const)
    arcade(parts, a, half, length - 2 * TOWER_R, Math.round(length / 2.4), 0.8, 1.1, 2)
  // the roof's open galleries, set back along the back and the two sides, small arches on their outer faces
  const gz = hd - GALLERY.back - GALLERY.deep / 2
  const gx = hw - GALLERY.back - GALLERY.deep / 2
  const backLen = BODY.w - 2 * (GALLERY.back + 2)
  const sideLen = BODY.d - 2 * (GALLERY.back + 2)
  parts.push(box(backLen, GALLERY.h, GALLERY.deep, 0, ROOF, -gz, 'sandstone'))
  parts.push(box(backLen + 0.3, 0.2, GALLERY.deep + 0.3, 0, ROOF + GALLERY.h, -gz, 'white'))
  arcade(parts, Math.PI, gz + GALLERY.deep / 2, backLen, 5, ROOF + 0.3, 0.8, 1)
  for (const s of [-1, 1]) {
    parts.push(box(GALLERY.deep, GALLERY.h, sideLen, s * gx, ROOF, 0, 'sandstone'))
    parts.push(box(GALLERY.deep + 0.3, 0.2, sideLen + 0.3, s * gx, ROOF + GALLERY.h, 0, 'white'))
    arcade(parts, (s * Math.PI) / 2, gx + GALLERY.deep / 2, sideLen, 3, ROOF + 0.3, 0.8, 1)
    parts.push(dome(0.9, s * gx, ROOF + GALLERY.h + 0.2, 0, 'white', 8))
  }
  // the corner towers, a little proud of the body, and their chhatris
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (hw - 0.6)
      const z = sz * (hd - 0.6)
      parts.push(cylinder(TOWER_R, TOWER_R + 0.1, ROOF + 0.3, 8, x, 0, z, 'sandstone'))
      parts.push(cylinder(TOWER_R + 0.12, TOWER_R + 0.12, 0.2, 8, x, BODY_H, z, 'white'))
      cornerChhatri(parts, x, z)
    }
  // the pavilion over the middle of the front, under a curved roof (half a drum laid along x)
  const pz = hd - 1.6
  parts.push(box(4.2, 2.4, 2.6, 0, ROOF, pz, 'sandstone'))
  for (const g of archOpening(1.2, 1.3, 0.6, 0, ROOF + 0.2, pz + 1.32, 'terracotta')) parts.push(g)
  const roof = new THREE.CylinderGeometry(1.6, 1.6, 4.6, 8, 1, false, -Math.PI / 2, Math.PI)
  roof.rotateZ(Math.PI / 2)
  roof.scale(1, 0.7, 1)
  roof.translate(0, ROOF + 2.4, pz)
  parts.push(bake(roof, 'white'))
  for (const x of [-1.6, 0, 1.6]) parts.push(cylinder(0.04, 0.09, 0.45, 4, x, ROOF + 3.5, pz, 'marigold'))

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: '#FFC27A',
    emissiveIntensity: 0,
  })
  material.userData.nightGlow = 0.4 // lit up on the water after dark; `applySky` turns it up
  const mesh = new THREE.Mesh(merge(parts), material)
  mesh.name = 'jal-mahal'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
