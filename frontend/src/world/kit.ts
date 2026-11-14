import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { AABB, BuildingSpec } from './types'
import { crenellatedWall, haveli, modern, shop, temple } from './kit/styles'

const BUILDERS = { haveli, shop, modern, temple, wall: crenellatedWall }

const emptyGeometry = () => {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3))
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3))
  return g
}

export function footprint(s: BuildingSpec): AABB {
  const swap = s.rot === 90 || s.rot === 270
  const hw = (swap ? s.d : s.w) / 2
  const hd = (swap ? s.w : s.d) / 2
  return { minX: s.x - hw, maxX: s.x + hw, minZ: s.z - hd, maxZ: s.z + hd }
}

/** Merge a whole block of buildings into one vertex-coloured mesh (one draw call) plus their colliders. */
export function buildBlock(specs: BuildingSpec[]): { mesh: THREE.Mesh; colliders: AABB[] } {
  const parts: THREE.BufferGeometry[] = []
  for (const s of specs) {
    const g = BUILDERS[s.style](s)
    g.rotateY(-THREE.MathUtils.degToRad(s.rot ?? 0))
    g.translate(s.x, 0, s.z)
    parts.push(g)
  }
  const geometry = parts.length ? mergeGeometries(parts, false) : emptyGeometry()
  parts.forEach((g) => g.dispose())
  const material = new THREE.MeshLambertMaterial({ vertexColors: true })
  return { mesh: new THREE.Mesh(geometry, material), colliders: specs.map(footprint) }
}
