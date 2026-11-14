import type * as THREE from 'three'
import type { PaletteKey } from '../palette'
import type { BuildingSpec } from '../types'
import { box, chhatri, cylinder, dome, FLOOR_H, merge, spire } from './parts'

type Parts = THREE.BufferGeometry[]

const front = (s: BuildingSpec) => s.d / 2 // +z is the street face

/** Pink-city haveli: white line-work bands, jharokha bays on upper floors, parapet and chhatris. */
export function haveli(s: BuildingSpec) {
  const base: PaletteKey = s.tint ?? 'pink'
  const H = s.floors * FLOOR_H
  const parts: Parts = [box(s.w, H, s.d, 0, 0, 0, base), box(s.w + 0.2, 0.4, s.d + 0.2, 0, 0, 0, 'white')]
  const zf = front(s)
  // door
  parts.push(box(1.4, 2.4, 0.2, 0, 0, zf, 'terracotta'))
  for (let f = 1; f < s.floors; f++) {
    const y = f * FLOOR_H
    parts.push(box(s.w + 0.2, 0.18, s.d + 0.2, 0, y - 0.09, 0, 'white'))
    // jharokha: projecting oriel bay with its own little roof
    parts.push(box(2.2, 1.8, 0.7, 0, y + 0.7, zf + 0.25, 'white'))
    parts.push(box(1.5, 1.1, 0.12, 0, y + 1.0, zf + 0.64, 'teal'))
    parts.push(box(2.5, 0.16, 1.0, 0, y + 2.5, zf + 0.3, base))
    // flank windows
    if (s.w >= 7) {
      parts.push(box(0.9, 1.3, 0.1, -s.w / 3, y + 1.0, zf + 0.04, 'teal'))
      parts.push(box(0.9, 1.3, 0.1, s.w / 3, y + 1.0, zf + 0.04, 'teal'))
    }
  }
  // parapet + chhatris on the corners
  const pw = s.w + 0.2
  const pd = s.d + 0.2
  parts.push(box(pw, 0.7, 0.18, 0, H, pd / 2 - 0.09, 'white'))
  parts.push(box(pw, 0.7, 0.18, 0, H, -pd / 2 + 0.09, 'white'))
  parts.push(box(0.18, 0.7, pd - 0.36, -pw / 2 + 0.09, H, 0, 'white'))
  parts.push(box(0.18, 0.7, pd - 0.36, pw / 2 - 0.09, H, 0, 'white'))
  const cx = s.w / 2 - 0.9
  const cz = s.d / 2 - 0.9
  parts.push(...chhatri(-cx, H + 0.7, cz, 1.4, base))
  parts.push(...chhatri(cx, H + 0.7, cz, 1.4, base))
  return merge(parts)
}

/** Arcaded shopfront: ground-floor arches with shutters, plain upper floors under a signboard strip. */
export function shop(s: BuildingSpec) {
  const base: PaletteKey = s.tint ?? 'sandstone'
  const H = s.floors * FLOOR_H
  const zf = front(s)
  const bays = Math.max(2, Math.round(s.w / 3))
  const bw = s.w / bays
  const shutter: PaletteKey = s.tint === 'teal' ? 'marigold' : 'teal'
  const parts: Parts = [box(s.w, H, s.d, 0, 0, 0, base), box(s.w + 0.2, 0.3, s.d + 0.2, 0, 0, 0, 'white')]
  for (let i = 0; i < bays; i++) {
    const x = -s.w / 2 + bw * (i + 0.5)
    parts.push(box(bw - 0.9, 2.1, 0.16, x, 0.3, zf + 0.04, shutter))
    // arch head: a six-sided disc standing in front of the shutter
    const arch = cylinder((bw - 0.6) / 2, (bw - 0.6) / 2, 0.2, 6, 0, 0, 0, 'white')
    arch.rotateX(Math.PI / 2)
    arch.translate(x, 2.4, zf + 0.06)
    parts.push(arch)
    parts.push(box(0.35, 2.7, 0.3, -s.w / 2 + bw * i + (i === 0 ? 0.18 : 0), 0, zf + 0.08, 'white'))
  }
  parts.push(box(0.35, 2.7, 0.3, s.w / 2 - 0.18, 0, zf + 0.08, 'white'))
  parts.push(box(s.w + 0.3, 0.5, 0.5, 0, 2.9, zf + 0.15, 'terracotta')) // signboard
  for (let f = 1; f < s.floors; f++) {
    parts.push(box(s.w + 0.2, 0.15, s.d + 0.2, 0, f * FLOOR_H - 0.07, 0, 'white'))
    parts.push(box(1, 1.3, 0.1, -s.w / 4, f * FLOOR_H + 1, zf + 0.04, 'teal'))
    parts.push(box(1, 1.3, 0.1, s.w / 4, f * FLOOR_H + 1, zf + 0.04, 'teal'))
  }
  parts.push(box(s.w + 0.2, 0.45, s.d + 0.2, 0, H, 0, 'white'))
  return merge(parts)
}

/** Plain modern box with slab balconies and window bands. */
export function modern(s: BuildingSpec) {
  const base: PaletteKey = s.tint ?? 'white'
  const H = s.floors * FLOOR_H
  const zf = front(s)
  const parts: Parts = [box(s.w, H, s.d, 0, 0, 0, base), box(s.w + 0.2, 0.3, s.d + 0.2, 0, H, 0, 'sandstone')]
  parts.push(box(1.6, 2.3, 0.2, -s.w / 4, 0, zf, 'teal'))
  for (let f = 1; f < s.floors; f++) {
    const y = f * FLOOR_H
    parts.push(box(s.w * 0.7, 0.2, 1.1, 0, y, zf + 0.5, 'sandstone'))
    parts.push(box(s.w * 0.7, 0.8, 0.1, 0, y + 0.2, zf + 1.0, 'teal'))
    parts.push(box(s.w * 0.55, 1.2, 0.1, 0, y + 1.1, zf + 0.04, 'teal'))
  }
  return merge(parts)
}

/** Temple: sandstone mandapa with a stepped shikhara spire and kalash. */
export function temple(s: BuildingSpec) {
  const base: PaletteKey = s.tint ?? 'sandstone'
  const bodyH = Math.max(1, s.floors) * FLOOR_H
  const zf = front(s)
  const m = Math.min(s.w, s.d)
  const parts: Parts = [
    box(s.w + 0.6, 0.5, s.d + 0.6, 0, 0, 0, 'white'),
    box(s.w, bodyH, s.d, 0, 0.5, 0, base),
    box(1.6, 2.4, 0.2, 0, 0.5, zf, 'marigold'),
    box(s.w + 0.3, 0.3, s.d + 0.3, 0, 0.5 + bodyH, 0, 'white'),
  ]
  const y0 = 0.8 + bodyH
  parts.push(spire(m * 0.5, m * 0.9, 4, 0, y0, 0, base))
  parts.push(spire(m * 0.3, m * 0.7, 4, 0, y0 + m * 0.7, 0, 'sandstone'))
  parts.push(dome(0.35, 0, y0 + m * 1.35, 0, 'marigold'))
  parts.push(cylinder(0.04, 0.04, 0.8, 4, 0, y0 + m * 1.55, 0, 'marigold'))
  return merge(parts)
}

/** Crenellated city-wall segment, long on x. */
export function crenellatedWall(s: BuildingSpec) {
  const base: PaletteKey = s.tint ?? 'pink'
  const H = s.floors * FLOOR_H
  const parts: Parts = [box(s.w, H, s.d, 0, 0, 0, base), box(s.w + 0.2, 0.3, s.d + 0.2, 0, 0, 0, 'white')]
  const merlons = Math.max(2, Math.floor(s.w / 2))
  const step = s.w / merlons
  for (let i = 0; i < merlons; i++) {
    parts.push(box(step * 0.55, 0.9, s.d * 0.8, -s.w / 2 + step * (i + 0.5), H, 0, 'white'))
  }
  return merge(parts)
}
