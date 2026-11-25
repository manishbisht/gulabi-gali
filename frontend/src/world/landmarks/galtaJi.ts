import * as THREE from 'three'
import { archOpening, bake, box, chhatri, dome, merge, spire } from '../kit/parts'
import type { PaletteKey } from '../palette'
import { seatedMonkey } from './galtaGorge'

/**
 * Footprint, centred on the model's origin, its front (+z) the long side: the temple's plinth and the steps down
 * from it. In the district it is turned to face west, across the path, at the main kund.
 */
export const GALTA_JI = { w: 32, d: 15 }

type Parts = THREE.BufferGeometry[]

/** The plinth's top. */
const PLINTH_H = 1.2

/**
 * A pavilion with a curved Bangla roof (bangaldar) set on `y`: four slim posts under a half-barrel whose ridge
 * runs along x, flattened so it reads as the drooping curve and not a tunnel.
 */
function bangla(parts: Parts, x: number, y: number, z: number, w: number, d: number, roof: PaletteKey) {
  const h = 2.2
  const px = w / 2 - 0.15
  const pz = d / 2 - 0.15
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) parts.push(box(0.22, h, 0.22, x + sx * px, y, z + sz * pz, 'white'))
  parts.push(box(w, 0.2, d, x, y + h, z, 'sandstone'))
  const r = d / 2 + 0.2
  const barrel = new THREE.CylinderGeometry(r, r, w + 0.4, 8, 1, false, 0, Math.PI)
  barrel.rotateZ(Math.PI / 2) // its axis along x, the half-round on top
  barrel.scale(1, 0.55, 1)
  barrel.translate(x, y + h + 0.2, z)
  parts.push(bake(barrel, roof))
  parts.push(dome(0.22, x, y + h + 0.2 + r * 0.55, z, 'marigold', 4))
}

/**
 * Galta Ji's main temple (after the Galtaji temple over the main kund): a haveli-like temple in pink sandstone on a
 * plinth, its front an arcade of painted arches under a muted ochre frieze; an upper storey of small arched windows;
 * on its roof two pavilions with curved Bangla roofs, chhatris at the corners, and a small shikhara over the
 * sanctum at the back. Two monkeys sit on the plinth. Original low-poly forms, softly lit after dark.
 */
export function buildGaltaJi(): THREE.Group {
  const parts: Parts = []
  // the plinth, and its steps down to the path along the middle of the front
  parts.push(box(GALTA_JI.w, PLINTH_H, 13, 0, 0, -1, 'sandstone'))
  parts.push(box(14, 0.8, 1, 0, 0, 6, 'white'))
  parts.push(box(14, 0.4, 1, 0, 0, 7, 'white'))

  // the ground storey: the arcade of painted arches, a frieze over it, the cornice
  const front1 = 4
  parts.push(box(30, 4.6, 11, 0, PLINTH_H, -1.5, 'pink'))
  for (let i = 0; i < 7; i++)
    parts.push(...archOpening(2.2, 2.3, 0.9, -12 + i * 4, PLINTH_H + 0.3, front1 + 0.01, 'terracotta'))
  parts.push(box(30.2, 0.5, 0.1, 0, PLINTH_H + 3.7, front1 + 0.02, 'ochre'))
  parts.push(box(30.6, 0.35, 11.6, 0, PLINTH_H + 4.6, -1.5, 'white'))
  const roof1 = PLINTH_H + 4.95

  // the upper storey: a row of small arched windows, and its cornice
  const front2 = 2
  parts.push(box(24, 4, 9, 0, roof1, -2.5, 'pink'))
  for (let i = 0; i < 6; i++)
    parts.push(...archOpening(1.4, 1.6, 0.7, -10 + i * 4, roof1 + 1.1, front2 + 0.01, 'teal'))
  parts.push(box(24.2, 0.4, 0.1, 0, roof1 + 3.1, front2 + 0.02, 'ochre'))
  parts.push(box(24.4, 0.35, 9.4, 0, roof1 + 4, -2.5, 'white'))
  const roof2 = roof1 + 4.35

  // chhatris on the lower roof's front corners, and on the upper roof's back corners
  for (const sx of [-1, 1]) {
    parts.push(...chhatri(sx * 13.6, roof1, 2.6, 2.2, 'pink'))
    parts.push(...chhatri(sx * 10.4, roof2, -5.6, 2, 'pink'))
  }
  // the two Bangla-roofed pavilions on the upper roof
  for (const sx of [-1, 1]) bangla(parts, sx * 6.5, roof2, -0.4, 4, 2.6, 'ochre')
  // the sanctum's small shikhara at the back, with its kalash
  parts.push(box(6, 2, 4.4, 0, roof2, -4.6, 'pink'))
  parts.push(spire(2.6, 5.5, 8, 0, roof2 + 2, -4.6, 'pink'))
  parts.push(dome(0.45, 0, roof2 + 7.4, -4.6, 'marigold', 6))

  // two monkeys on the plinth's front corners, minding their own business
  for (const sx of [-1, 1]) {
    const m = seatedMonkey()
    m.rotateY(sx * 0.5)
    m.translate(sx * 14.6, PLINTH_H, 4.6)
    parts.push(m)
  }

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: '#FFC27A',
    emissiveIntensity: 0,
  })
  material.userData.nightGlow = 0.3 // softly lit after dark; `applySky` turns it up
  const mesh = new THREE.Mesh(merge(parts), material)
  mesh.name = 'galta-ji'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}
