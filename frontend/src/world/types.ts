import type * as THREE from 'three'
import type { DistrictId } from '../net/protocol'
import type { PaletteKey } from './palette'

export type Vec2 = { x: number; z: number }
export interface AABB {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}
export type BuildingStyle = 'haveli' | 'shop' | 'modern' | 'temple' | 'wall'
export interface BuildingSpec {
  x: number
  z: number
  w: number
  d: number
  floors: 1 | 2 | 3 | 4
  style: BuildingStyle
  tint?: PaletteKey
  rot?: 0 | 90 | 180 | 270
}
export type AvatarLook = {
  skin: 0 | 1 | 2 | 3 | 4
  outfit: PaletteKey
  head: 'none' | 'safa' | 'cap' | 'dupatta' | 'bun'
}
export interface PropSpec {
  kind: 'tapri' | 'tree' | 'lamp' | 'auto' | 'bench' | 'poster-wall' | 'station'
  at: Vec2
  /** Degrees, the same turn as `BuildingSpec.rot`: 90 sends the front (+z) to -x. */
  rot?: number
}
/** A flat patch of ground colour (a road, a kerb line, a paved court). Later patches lie on top. */
export interface Paving extends AABB {
  color: PaletteKey
}
export interface LandmarkDef {
  id: string
  name: { hi: string; en: string }
  story: { hi: string; en: string }
  at: Vec2
  radius: number
  build: () => Promise<THREE.Group>
  footprint: AABB
}
export interface NpcDef {
  id: string
  name: string
  role: { hi: string; en: string }
  status: { hi: string; en: string }
  look: AvatarLook
  route: Vec2[]
  speed: number
}
export interface DistrictDef {
  id: DistrictId
  name: { hi: string; en: string }
  size: number
  spawn: Vec2
  station: Vec2
  /** Where people gather: Holi colour rises here. Open ground, clear of buildings and landmarks. */
  centre: Vec2
  /**
   * The festival procession's loop along the main street, closed (the last leg returns to the first point),
   * clear of every collider by at least 1.3 m. Gangaur and Teej walk it.
   */
  processionRoute: Vec2[]
  /** Spawn points of the street animals: 3-5 dogs, 2-3 cats and one cow, on open ground. */
  animals: { dogs: Vec2[]; cats: Vec2[]; cow: Vec2 }
  ground: PaletteKey
  paving: Paving[]
  buildings: BuildingSpec[]
  landmarks: LandmarkDef[]
  npcs: NpcDef[]
  props: PropSpec[]
}
