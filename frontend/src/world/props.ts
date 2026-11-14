import * as THREE from 'three'
import { PALETTE } from './palette'
import { archOpening, bake, box, cylinder, merge } from './kit/parts'
import type { AABB, PropSpec, Vec2 } from './types'

type Kind = PropSpec['kind']

/** Footprint of each kind before turning: w across its front, d front to back. */
const SIZE: Record<Kind, { w: number; d: number }> = {
  tapri: { w: 2.4, d: 1.6 },
  tree: { w: 0.8, d: 0.8 }, // the trunk; the canopy is overhead
  lamp: { w: 0.4, d: 0.4 },
  auto: { w: 1.4, d: 2.7 },
  bench: { w: 2, d: 0.7 },
  'poster-wall': { w: 4.2, d: 0.5 },
  station: { w: 3.6, d: 5.4 },
}

const blob = (r: number, x: number, y: number, z: number) => {
  const g = new THREE.IcosahedronGeometry(r, 0)
  g.translate(x, y, z)
  return bake(g, 'grass')
}

/** Every model faces +z with its base on y = 0, centred on its footprint. */
const MODELS: Record<Kind, () => THREE.BufferGeometry> = {
  // Chai stall: counter, kettle, posts and a marigold awning.
  tapri: () =>
    merge([
      box(2.2, 1.0, 1.2, 0, 0, 0.1, 'terracotta'),
      box(2.3, 0.08, 1.3, 0, 1.0, 0.1, 'white'),
      cylinder(0.14, 0.18, 0.3, 6, -0.5, 1.08, 0.2, 'marigold'),
      box(2.2, 2.2, 0.15, 0, 0, -0.7, 'teal'),
      box(0.1, 2.3, 0.1, -1.1, 0, 0.75, 'white'),
      box(0.1, 2.3, 0.1, 1.1, 0, 0.75, 'white'),
      box(2.6, 0.12, 1.9, 0, 2.3, 0, 'marigold'),
      box(2.6, 0.35, 0.08, 0, 2.0, 0.92, 'terracotta'),
    ]),
  // Neem: a slim trunk under a few chunky leaf clumps.
  tree: () =>
    merge([
      cylinder(0.18, 0.28, 2.8, 5, 0, 0, 0, 'terracotta'),
      blob(1.7, 0, 3.6, 0),
      blob(1.2, 0.9, 3.0, 0.5),
      blob(1.1, -0.8, 3.2, -0.4),
    ]),
  // Black iron post with a lantern.
  lamp: () =>
    merge([
      cylinder(0.12, 0.16, 0.4, 6, 0, 0, 0, 'road'),
      cylinder(0.06, 0.06, 3.6, 5, 0, 0.4, 0, 'road'),
      cylinder(0.02, 0.28, 0.25, 4, 0, 4.45, 0, 'road'),
    ]),
  // Jaipur CNG auto: green body, yellow canopy, three wheels; nose to +z.
  auto: () => {
    const wheel = (x: number, z: number) => {
      const g = new THREE.CylinderGeometry(0.28, 0.28, 0.18, 6).rotateZ(Math.PI / 2).translate(x, 0.28, z)
      return bake(g, 'road')
    }
    return merge([
      box(1.3, 0.75, 2.5, 0, 0.25, 0, 'grass'),
      box(1.0, 0.5, 0.5, 0, 0.25, 1.1, 'grass'),
      box(1.36, 0.1, 2.0, 0, 1.0, -0.2, 'road'),
      box(0.08, 0.85, 0.08, -0.62, 1.0, 0.75, 'road'),
      box(0.08, 0.85, 0.08, 0.62, 1.0, 0.75, 'road'),
      box(1.1, 0.6, 0.06, 0, 1.15, 0.78, 'teal'),
      box(1.44, 0.18, 2.2, 0, 1.85, -0.15, 'marigold'),
      box(1.3, 0.85, 0.08, 0, 1.0, -1.2, 'marigold'),
      wheel(0, 1.05),
      wheel(-0.62, -0.85),
      wheel(0.62, -0.85),
    ])
  },
  // Stone bench.
  bench: () =>
    merge([
      box(2, 0.12, 0.6, 0, 0.45, 0, 'white'),
      box(0.2, 0.45, 0.5, -0.8, 0, 0, 'sandstone'),
      box(0.2, 0.45, 0.5, 0.8, 0, 0, 'sandstone'),
    ]),
  // A free-standing wall for posters: an empty board in a white frame, both faces.
  'poster-wall': () =>
    merge([
      box(4.2, 2.8, 0.4, 0, 0, 0, 'white'),
      box(3.7, 1.9, 0.44, 0, 0.6, 0, 'sandstone'),
      box(4.4, 0.18, 0.6, 0, 2.8, 0, 'terracotta'),
    ]),
  // Metro entrance: a pink-and-white portal over stairs going down, opening to +z.
  station: () =>
    merge([
      box(0.3, 2.8, 5.4, -1.65, 0, 0, 'white'),
      box(0.3, 2.8, 5.4, 1.65, 0, 0, 'white'),
      box(3.6, 2.8, 0.3, 0, 0, -2.55, 'white'),
      box(3.0, 0.04, 5.0, 0, 0.02, 0.1, 'road'),
      box(3.9, 0.3, 5.7, 0, 2.8, 0, 'pink'),
      box(3.9, 0.55, 0.12, 0, 2.9, 2.86, 'pink'),
      box(1.6, 0.3, 0.13, 0, 3.0, 2.88, 'white'),
      ...archOpening(2.8, 2.0, 0.6, 0, 0, 2.7, 'road'),
    ]),
}

/** The auto's model on its own: a fresh geometry (and so the caller's to dispose) for a driven or remote auto. */
export const buildAutoGeometry = (): THREE.BufferGeometry => MODELS.auto()

/** Glowing bits, drawn apart from the vertex-coloured model so they can light up after dark. */
const BULBS: Partial<Record<Kind, () => THREE.BufferGeometry>> = {
  lamp: () => new THREE.BoxGeometry(0.36, 0.45, 0.36).translate(0, 4.225, 0),
  tapri: () => new THREE.SphereGeometry(0.16, 6, 4).translate(0, 2.05, 0.6),
}

/** Warm emissive bulb material; `applySky` raises its emissive intensity at night (userData.nightGlow). */
function bulbMaterial() {
  const m = new THREE.MeshLambertMaterial({
    color: PALETTE.marigold,
    emissive: PALETTE.marigold,
    emissiveIntensity: 0,
  })
  m.userData.nightGlow = 1.6
  return m
}

/** The axis-aligned box around a w × d rectangle turned by `rot` degrees about its centre. */
function turnedBox(s: PropSpec): AABB {
  const { w, d } = SIZE[s.kind]
  const a = THREE.MathUtils.degToRad(s.rot ?? 0)
  const c = Math.abs(Math.cos(a))
  const n = Math.abs(Math.sin(a))
  const hx = (w * c + d * n) / 2
  const hz = (w * n + d * c) / 2
  return { minX: s.at.x - hx, maxX: s.at.x + hx, minZ: s.at.z - hz, maxZ: s.at.z + hz }
}

/**
 * The parked autos, which can be driven off. Taking one hides its instance and parks its collider far
 * away; leaving it where it was driven to puts both back there. Only this client's view: nobody else
 * is told.
 */
export interface ParkedAutos {
  /** The index of the nearest parked auto within `range` of `pos`, or -1. A driven one is not parked. */
  nearest(pos: Vec2, range: number): number
  /** Where parked auto `i` stands (x, z) and faces (radians about y, 0 faces +z). */
  pose(i: number): { x: number; z: number; ry: number }
  /** Auto `i` is driven away: hidden, and no longer in anyone's way. */
  take(i: number): void
  /** Auto `i` is left at this pose: drawn there, and solid there. */
  leave(i: number, x: number, z: number, ry: number): void
}

/** Where a taken auto's collider waits: nowhere near anything. */
const FAR_AWAY = 1e9

/** Street furniture, one InstancedMesh (one draw call) per kind, plus a collider per prop. */
export function buildProps(props: PropSpec[]): { group: THREE.Group; colliders: AABB[]; autos: ParkedAutos } {
  const group = new THREE.Group()
  const byKind = new Map<Kind, PropSpec[]>()
  for (const p of props) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p])
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const one = new THREE.Vector3(1, 1, 1)
  const bulbs = bulbMaterial() // one material for every lamp and tapri in the district
  for (const [kind, list] of byKind) {
    const mesh = new THREE.InstancedMesh(
      MODELS[kind](),
      new THREE.MeshLambertMaterial({ vertexColors: true }),
      list.length,
    )
    mesh.name = kind
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, -THREE.MathUtils.degToRad(p.rot ?? 0))
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.at.x, 0, p.at.z), q, one))
    })
    mesh.computeBoundingSphere()
    mesh.castShadow = true
    mesh.receiveShadow = true
    const bulbGeometry = BULBS[kind]
    if (bulbGeometry) {
      // A child, sharing the parent's per-instance matrices: one more draw call per kind, no new buffers.
      const bulb = new THREE.InstancedMesh(bulbGeometry(), bulbs, list.length)
      bulb.instanceMatrix = mesh.instanceMatrix
      bulb.name = `${kind}-bulb`
      bulb.frustumCulled = false
      mesh.add(bulb)
    }
    group.add(mesh)
  }
  const colliders = props.map(turnedBox)
  return { group, colliders, autos: parkedAutos(props, colliders, byKind.get('auto') ?? [], group) }
}

function parkedAutos(
  props: PropSpec[],
  colliders: AABB[],
  list: PropSpec[],
  group: THREE.Group,
): ParkedAutos {
  const mesh = group.children.find((c): c is THREE.InstancedMesh => c.name === 'auto')
  // the collider of each auto, by its place in the instanced mesh (the order of `byKind`)
  const solid = list.map((p) => colliders[props.indexOf(p)]!)
  const spot = list.map((p) => ({ x: p.at.x, z: p.at.z, ry: -THREE.MathUtils.degToRad(p.rot ?? 0) }))
  const taken = list.map(() => false)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const at = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const nothing = new THREE.Vector3(0, 0, 0)
  const write = (i: number, shown: boolean) => {
    const { x, z, ry } = spot[i]!
    q.setFromAxisAngle(up, ry)
    mesh?.setMatrixAt(i, m.compose(at.set(x, 0, z), q, shown ? one : nothing))
    if (mesh) mesh.instanceMatrix.needsUpdate = true
  }
  return {
    nearest(pos, range) {
      let best = -1
      let bestD = range
      for (let i = 0; i < spot.length; i++) {
        if (taken[i]) continue
        const d = Math.hypot(spot[i]!.x - pos.x, spot[i]!.z - pos.z)
        if (d <= bestD) {
          best = i
          bestD = d
        }
      }
      return best
    },
    pose: (i) => spot[i]!,
    take(i) {
      taken[i] = true
      write(i, false)
      Object.assign(solid[i]!, { minX: FAR_AWAY, maxX: FAR_AWAY, minZ: FAR_AWAY, maxZ: FAR_AWAY })
    },
    leave(i, x, z, ry) {
      taken[i] = false
      spot[i] = { x, z, ry }
      write(i, true)
      mesh?.computeBoundingSphere() // it may stand outside the old one, and would be culled there
      // the turn the collider is built with is in degrees, clockwise from above: the model turns by -rot
      Object.assign(solid[i]!, turnedBox({ kind: 'auto', at: { x, z }, rot: (-ry * 180) / Math.PI }))
    },
  }
}
