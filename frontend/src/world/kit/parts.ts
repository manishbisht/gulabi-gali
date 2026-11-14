import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { PALETTE, type PaletteKey } from '../palette'

export const FLOOR_H = 3.2

/** Flat-shaded, non-indexed, uv-less piece with a single colour baked into every vertex. */
export function bake(g: THREE.BufferGeometry, color: PaletteKey): THREE.BufferGeometry {
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

/**
 * Arched opening drawn flat on a +z facing wall: a fill rectangle `h` tall with a half-round head of
 * `rise` on top, framed in white line-work. Centre-bottom at (x, y, z); only seen from the front.
 */
export function archOpening(
  w: number,
  h: number,
  rise: number,
  x: number,
  y: number,
  z: number,
  fill: PaletteKey,
) {
  const r = w / 2
  const t = 0.14
  const flat = (g: THREE.BufferGeometry, color: PaletteKey, dz: number) => {
    g.translate(x, 0, z + dz)
    return bake(g, color)
  }
  const head = new THREE.CircleGeometry(r, 4, 0, Math.PI).scale(1, rise / r, 1).translate(0, y + h, 0)
  const frame = new THREE.RingGeometry(r, r + t, 4, 1, 0, Math.PI)
    .scale(1, (rise + t) / (r + t), 1)
    .translate(0, y + h, 0)
  const jamb = (side: number) => new THREE.PlaneGeometry(t, h).translate(side * (r + t / 2), y + h / 2, 0)
  return [
    flat(new THREE.PlaneGeometry(w, h).translate(0, y + h / 2, 0), fill, 0),
    flat(head, fill, 0),
    flat(frame, 'white', 0.01),
    flat(jamb(-1), 'white', 0.01),
    flat(jamb(1), 'white', 0.01),
  ]
}

/** Half of an n-sided prism bulging out towards +z: the body of a jharokha bay. Open top and bottom. */
export function halfPrism(
  r: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  color: PaletteKey,
) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true, -Math.PI / 2, Math.PI)
  g.translate(x, y + h / 2, z)
  return bake(g, color)
}

/** Quarter-sphere cap over a half prism: the little curved roof of a jharokha. */
export function halfDome(r: number, x: number, y: number, z: number, color: PaletteKey, seg = 3) {
  const g = new THREE.SphereGeometry(r, seg, 2, 0, Math.PI, 0, Math.PI / 2)
  g.translate(x, y, z)
  return bake(g, color)
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  return merged
}
