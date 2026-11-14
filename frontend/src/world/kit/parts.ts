import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, type PaletteKey } from '../palette'

export const FLOOR_H = 3.2

/** Flat-shaded, non-indexed, uv-less piece with a single colour baked into every vertex. */
function bake(g: THREE.BufferGeometry, color: PaletteKey): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g
  flat.deleteAttribute('uv')
  const c = new THREE.Color(PALETTE[color])
  const n = flat.getAttribute('position').count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3)
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  if (flat !== g) g.dispose()
  return flat
}

/** Box with its base at (x, y, z) centre-bottom. */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: PaletteKey) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y + h / 2, z)
  return bake(g, color)
}

export function cylinder(
  rTop: number,
  rBot: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  color: PaletteKey,
) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1)
  g.translate(x, y + h / 2, z)
  return bake(g, color)
}

/** Low-poly hemispherical dome sitting on y. */
export function dome(r: number, x: number, y: number, z: number, color: PaletteKey, seg = 6) {
  const g = new THREE.SphereGeometry(r, seg, 2, 0, Math.PI * 2, 0, Math.PI / 2)
  g.translate(x, y, z)
  return bake(g, color)
}

/** Four-sided (or n-sided) pyramid / spire. */
export function spire(r: number, h: number, seg: number, x: number, y: number, z: number, color: PaletteKey) {
  const g = new THREE.ConeGeometry(r, h, seg, 1, true)
  g.translate(x, y + h / 2, z)
  return bake(g, color)
}

/** Small open-air chhatri: four slim posts under a dome. */
export function chhatri(x: number, y: number, z: number, size: number, body: PaletteKey) {
  const p = size / 2 - 0.08
  const post = (px: number, pz: number) => box(0.16, size * 0.8, 0.16, x + px, y, z + pz, 'white')
  return [
    post(-p, -p),
    post(p, -p),
    post(-p, p),
    post(p, p),
    box(size, 0.12, size, x, y + size * 0.8, z, body),
    dome(size * 0.62, x, y + size * 0.8 + 0.12, z, 'white'),
  ]
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  return merged
}
