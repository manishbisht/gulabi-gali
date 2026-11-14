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
  rot?: number
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
  ground: PaletteKey
  buildings: BuildingSpec[]
  landmarks: LandmarkDef[]
  npcs: NpcDef[]
  props: PropSpec[]
}
