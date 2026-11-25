import * as THREE from 'three'
import type { DistrictId } from '../net/protocol'
import { buildBlock } from './kit'
import { bake, merge } from './kit/parts'
import { PALETTE } from './palette'
import { buildProps, type ParkedAutos } from './props'
import { buildRoof } from './rooftop'
import { buildSignposts } from './signposts'
import { touchableColliders } from './touchableBoxes'
import type { AABB, DistrictDef, Paving, Vec2 } from './types'

/** The seven districts, in the order the travel sheet lists them: the metro's four, then the bus's three. */
export const DISTRICTS: DistrictId[] = [
  'walled-city',
  'mi-road',
  'university',
  'malviya-nagar',
  'amer',
  'nahargarh',
  'galta',
]

/** Each district is its own chunk, fetched only when the player goes there. */
const SOURCES: Record<DistrictId, () => Promise<{ default: DistrictDef }>> = {
  'walled-city': () => import('./districts/walledCity'),
  'mi-road': () => import('./districts/miRoad'),
  university: () => import('./districts/university'),
  'malviya-nagar': () => import('./districts/malviyaNagar'),
  amer: () => import('./districts/amer'),
  nahargarh: () => import('./districts/nahargarh'),
  galta: () => import('./districts/galta'),
}

export interface District {
  def: DistrictDef
  /** Everything the district draws, lights included. Add it to the scene. */
  root: THREE.Group
  /** Buildings, landmark footprints, props, the standing touchables and an outer boundary. */
  colliders: AABB[]
  /** The parked autos, which can be driven away. */
  autos: ParkedAutos
  /** The tall colliders (buildings and landmarks): the chase camera pulls in rather than enter them. */
  occluders: AABB[]
  /** One sky/ground fill and one sun. The live sky drives both; the sun casts shadows only at tier 2. */
  lights: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight }
  /** Keeps the sun's shadow box centred on `p` (where the player is) without turning the sun. */
  focus(p: Vec2): void
  dispose(): void
}

/** Building blocks are merged per cell of this size: few draw calls, still culled off-screen. */
const CELL = 60
/** The sun's shadow box: half-width around the player, in metres. */
const SHADOW_REACH = 45

/** A district's definition alone, built into nothing (the link previews' build reads its places from it). */
export async function loadDef(id: DistrictId): Promise<DistrictDef> {
  const source = SOURCES[id] as (typeof SOURCES)[DistrictId] | undefined
  if (!source) throw new Error(`No such district: ${id}`)
  return (await source()).default
}

export async function loadDistrict(id: DistrictId): Promise<District> {
  const def = await loadDef(id)
  const root = new THREE.Group()
  root.name = def.id

  root.add(buildGround(def))

  const cells = new Map<string, DistrictDef['buildings']>()
  for (const b of def.buildings) {
    const key = `${Math.floor(b.x / CELL)},${Math.floor(b.z / CELL)}`
    cells.set(key, [...(cells.get(key) ?? []), b])
  }
  const colliders: AABB[] = []
  for (const specs of cells.values()) {
    const block = buildBlock(specs)
    block.mesh.castShadow = true
    block.mesh.receiveShadow = true
    root.add(block.mesh)
    colliders.push(...block.colliders)
  }

  // A landmark that fails to build must not strand the ground, blocks and the other landmarks: free them first.
  const built = await Promise.allSettled(def.landmarks.map((l) => l.build()))
  const failed = built.find((r) => r.status === 'rejected')
  if (failed) {
    for (const r of built) if (r.status === 'fulfilled') root.add(r.value)
    disposeTree(root)
    throw failed.reason
  }
  for (const r of built) if (r.status === 'fulfilled') root.add(r.value)
  colliders.push(...def.landmarks.map((l) => l.footprint))
  colliders.push(...(def.rocks ?? []))
  const occluders = [...colliders]

  const props = buildProps(def.props)
  root.add(props.group)
  colliders.push(...props.colliders)
  const signs = buildSignposts(def)
  root.add(signs.group)
  colliders.push(...signs.colliders)
  // the bells, pumps and diya stands are drawn by the session (touchables.ts); they are solid from here
  colliders.push(...touchableColliders(def.touchables))
  if (def.roof) {
    root.add(buildRoof(def.roof))
    colliders.push(def.roof.flight)
  }
  colliders.push(...(def.water ?? []))
  if (def.scenery) root.add(def.scenery())
  colliders.push(...boundary(def.size / 2))

  const hemi = new THREE.HemisphereLight('#E4EEF4', PALETTE.sandstone, 1.6)
  const sun = new THREE.DirectionalLight('#FFF7EE', 2.2)
  sun.position.set(40, 70, 45)
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_REACH,
    right: SHADOW_REACH,
    top: SHADOW_REACH,
    bottom: -SHADOW_REACH,
    near: 1,
    far: 220,
  })
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.03
  root.add(hemi, sun, sun.target)

  return {
    def,
    root,
    colliders,
    autos: props.autos,
    occluders,
    lights: { hemi, sun },
    focus(p) {
      const offset = sun.position.clone().sub(sun.target.position)
      sun.target.position.set(p.x, 0, p.z)
      sun.position.copy(sun.target.position).add(offset)
    },
    dispose() {
      root.removeFromParent()
      disposeTree(root)
      sun.dispose()
      hemi.dispose()
    },
  }
}

/** Frees the geometry and materials of everything under `root`. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    if (o instanceof THREE.InstancedMesh) o.dispose() // its per-instance buffers
    ;(o.geometry as THREE.BufferGeometry).dispose()
    const m = o.material as THREE.Material | THREE.Material[]
    for (const mat of Array.isArray(m) ? m : [m]) {
      ;(mat as THREE.MeshLambertMaterial).map?.dispose() // a canvas's lettering (the signposts)
      mat.dispose()
    }
  })
}

/** Four slabs just outside the district's edges, so nothing walks off the map. */
function boundary(half: number): AABB[] {
  const t = 10
  return [
    { minX: -half - t, maxX: -half, minZ: -half - t, maxZ: half + t },
    { minX: half, maxX: half + t, minZ: -half - t, maxZ: half + t },
    { minX: -half, maxX: half, minZ: -half - t, maxZ: -half },
    { minX: -half, maxX: half, minZ: half, maxZ: half + t },
  ]
}

/** The ground and its paving, merged into one mesh. A patch lies a little above any it overlaps. */
function buildGround(def: DistrictDef): THREE.Mesh {
  const quad = (r: AABB, y: number, color: Paving['color']) => {
    const g = new THREE.PlaneGeometry(r.maxX - r.minX, r.maxZ - r.minZ)
    g.rotateX(-Math.PI / 2)
    g.translate((r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2)
    return bake(g, color)
  }
  const span = def.size * 2.5 // reaches past the walls to the horizon
  // on a ridge the ground stops at its edge, where the scenery's slope falls away to the plain below
  const west = def.ridgeWest ?? -span / 2
  const parts = [quad({ minX: west, maxX: span / 2, minZ: -span / 2, maxZ: span / 2 }, 0, def.ground)]
  const levels: number[] = []
  def.paving.forEach((p, i) => {
    const under = def.paving.slice(0, i).map((q, j) => (overlap(p, q) ? levels[j]! : 0))
    levels.push(Math.max(0, ...under) + 1)
    parts.push(quad(p, levels[i]! * 0.02, p.color))
  })
  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.name = 'ground'
  mesh.receiveShadow = true
  return mesh
}

const overlap = (a: AABB, b: AABB) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
