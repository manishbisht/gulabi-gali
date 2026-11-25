import * as THREE from 'three'
import { bakeHex, box, chhatri, merge } from '../kit/parts'
import type { AABB, Vec2 } from '../types'

/*
 * Galta Ji's gorge, drawn: the rocky slopes either side (and at its head), the kunds' stepped edges with a pair of
 * pavilions standing in the main one, and a few monkeys sitting about. One mesh, one draw call, a few thousand
 * triangles; nothing here is a collider (the district's `rocks` and `water` are).
 *
 * The slopes are one height field over a grid whose lines include every edge of the rock and of the open ground,
 * so each cell is wholly rock or wholly open and neighbouring boxes share their vertices (no cracks). A vertex's
 * height grows with its distance from the open ground: nothing at the foot, where the colliders start, then a
 * steep climb that levels out 20-30 m up. Toward the ridge's west edge the rock sinks to nothing, so the view from
 * the ridge top runs along the crest and down to the city below.
 */

/** The grid's step, in metres, and how near an edge a plain grid line may come before the edge stands in for it. */
const STEP = 4
const SNAP = 1.4
/** The slopes' crest height varies between these, in metres. */
const TOP_MIN = 19
const TOP_MAX = 29
/** How fast the slope climbs off the open ground: within this many metres it is two thirds of the way up. */
const RISE = 7
/** Over this far from the ridge's west edge the rock sinks to nothing. */
const TAPER = 24

const ROCK = '#8C6C4D'
const ROCK_LIGHT = '#A2825F'
const ROCK_FOOT = '#7D6249'
const SCRUB = '#77814E'
const FUR = '#8A5A33'
const FACE = '#D9B48F'

export interface GorgeSpec {
  /** The rock (the district's colliders for it). */
  rocks: AABB[]
  /** The open ground the slopes rise from: their foot runs along its edges. */
  open: AABB[]
  /** The ridge's west edge: the rock sinks to nothing toward it. */
  westEdge: number
  /** The kunds (water): each gets a stepped edge, three steps down to the water. */
  kunds: AABB[]
  /** Pavilions standing in the water, each on its own small plinth. */
  pavilions: Vec2[]
  /** Monkeys sitting about: where (`y` the top of what they sit on), and which way they face. */
  monkeys: { x: number; y: number; z: number; ry: number }[]
}

/** A small hash of a point: the same value for the same place, every visit. */
function hash(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/** How far `p` is from the box `a` (0 inside or on its edge). */
function distance(x: number, z: number, a: AABB): number {
  const dx = Math.max(a.minX - x, 0, x - a.maxX)
  const dz = Math.max(a.minZ - z, 0, z - a.maxZ)
  return Math.hypot(dx, dz)
}

/** Grid lines from `lo` to `hi`, every `STEP`, with each edge in `edges` standing in for the plain lines near it. */
function lines(lo: number, hi: number, edges: number[]): number[] {
  const inside = [...new Set(edges.filter((e) => e >= lo && e <= hi))]
  const out = [...inside]
  for (let v = lo; v <= hi + 1e-6; v += STEP) if (inside.every((e) => Math.abs(e - v) >= SNAP)) out.push(v)
  return out.sort((a, b) => a - b)
}

/** The slopes' height at (x, z). */
function height(x: number, z: number, spec: GorgeSpec): number {
  let d = Infinity
  for (const o of spec.open) d = Math.min(d, distance(x, z, o))
  if (d <= 1e-6) return 0
  const top = TOP_MIN + (TOP_MAX - TOP_MIN) * (0.5 + 0.5 * Math.sin(x * 0.045 + z * 0.031))
  const jag = (hash(x, z) - 0.5) * 3.5 * Math.min(1, d / STEP)
  const h = top * (1 - Math.exp(-d / RISE)) + jag
  const taper = THREE.MathUtils.clamp((x - spec.westEdge) / TAPER, 0, 1)
  return Math.max(0.2, h) * taper
}

/** The rock: one height field over the cells inside `rocks`, flat-shaded, coloured by height. */
function slopes(spec: GorgeSpec): THREE.BufferGeometry {
  const { rocks, open } = spec
  const all = [...rocks, ...open]
  const lo = (k: 'minX' | 'minZ') => Math.min(...rocks.map((r) => r[k]))
  const hi = (k: 'maxX' | 'maxZ') => Math.max(...rocks.map((r) => r[k]))
  const xs = lines(
    lo('minX'),
    hi('maxX'),
    all.flatMap((r) => [r.minX, r.maxX]),
  )
  const zs = lines(
    lo('minZ'),
    hi('maxZ'),
    all.flatMap((r) => [r.minZ, r.maxZ]),
  )
  const hs = new Float32Array(xs.length * zs.length)
  xs.forEach((x, i) => zs.forEach((z, j) => (hs[i * zs.length + j] = height(x, z, spec))))
  const isRock = (x: number, z: number) =>
    rocks.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ)

  const pos: number[] = []
  const col: number[] = []
  const c = new THREE.Color()
  const tri = (a: number[], b: number[], d: number[]) => {
    pos.push(...a, ...b, ...d)
    const mean = (a[1]! + b[1]! + d[1]!) / 3
    const n = hash(a[0]! + d[0]!, a[2]! + b[2]!)
    c.set(mean < 2.5 ? ROCK_FOOT : mean > 11 && n < 0.4 ? SCRUB : n < 0.55 ? ROCK : ROCK_LIGHT)
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b)
  }
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < zs.length; j++) {
      const x0 = xs[i]!
      const x1 = xs[i + 1]!
      const z0 = zs[j]!
      const z1 = zs[j + 1]!
      if (!isRock((x0 + x1) / 2, (z0 + z1) / 2)) continue
      const v = (ii: number, jj: number) => [xs[ii]!, hs[ii * zs.length + jj]!, zs[jj]!]
      const a = v(i, j)
      const b = v(i + 1, j)
      const p = v(i + 1, j + 1)
      const q = v(i, j + 1)
      // counter-clockwise seen from above, so the faces look up
      tri(a, q, p)
      tri(a, p, b)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

/** A kund's edge: three steps down to the water, inside its box (where nobody walks). */
function steps(k: AABB): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  const W = 0.9
  ;[0.36, 0.24, 0.12].forEach((h, i) => {
    const r = { minX: k.minX + i * W, maxX: k.maxX - i * W, minZ: k.minZ + i * W, maxZ: k.maxZ - i * W }
    const w = r.maxX - r.minX
    const d = r.maxZ - r.minZ
    const tint = i % 2 ? 'white' : 'sandstone'
    out.push(box(w, h, W, (r.minX + r.maxX) / 2, 0, r.minZ + W / 2, tint))
    out.push(box(w, h, W, (r.minX + r.maxX) / 2, 0, r.maxZ - W / 2, tint))
    out.push(box(W, h, d - 2 * W, r.minX + W / 2, 0, (r.minZ + r.maxZ) / 2, tint))
    out.push(box(W, h, d - 2 * W, r.maxX - W / 2, 0, (r.minZ + r.maxZ) / 2, tint))
  })
  return out
}

/** A monkey sitting up, tail curled round on the ground; its front is +z, its base at y = 0. */
export function seatedMonkey(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const add = (g: THREE.BufferGeometry, hex: string, x: number, y: number, z: number, tilt = 0) => {
    if (tilt) g.rotateX(tilt)
    g.translate(x, y, z)
    parts.push(bakeHex(g, hex))
  }
  add(new THREE.BoxGeometry(0.34, 0.24, 0.42), FUR, 0, 0.12, 0) // haunches
  add(new THREE.BoxGeometry(0.3, 0.42, 0.26), FUR, 0, 0.42, 0.04, -0.2) // back, sitting up
  add(new THREE.BoxGeometry(0.26, 0.24, 0.24), FUR, 0, 0.74, 0.12) // head
  add(new THREE.BoxGeometry(0.18, 0.13, 0.05), FACE, 0, 0.73, 0.25) // face
  add(new THREE.BoxGeometry(0.07, 0.32, 0.07), FUR, -0.12, 0.2, 0.2) // arms down in front
  add(new THREE.BoxGeometry(0.07, 0.32, 0.07), FUR, 0.12, 0.2, 0.2)
  add(new THREE.BoxGeometry(0.5, 0.05, 0.06), FUR, -0.12, 0.03, -0.26) // the tail along the ground
  return merge(parts)
}

/** Galta Ji's gorge: the slopes, the kunds' steps and pavilions, and the monkeys, as one mesh named `gorge`. */
export function buildGorge(spec: GorgeSpec): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [slopes(spec)]
  for (const k of spec.kunds) parts.push(...steps(k))
  for (const p of spec.pavilions) {
    parts.push(box(2.8, 0.5, 2.8, p.x, 0, p.z, 'sandstone'))
    parts.push(...chhatri(p.x, 0.5, p.z, 2.4, 'pink'))
  }
  for (const m of spec.monkeys) {
    const g = seatedMonkey()
    g.rotateY(m.ry)
    g.translate(m.x, m.y, m.z)
    parts.push(g)
  }
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  const mesh = new THREE.Mesh(merge(parts), material)
  mesh.name = 'gorge'
  mesh.receiveShadow = true
  return mesh
}
