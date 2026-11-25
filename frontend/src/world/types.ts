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
  /** The dressing room's choices, as on the wire (see `AvatarLookWire`): absent, the older fields say. */
  tone?: number
  hat?: number
  hatC?: number
  dup?: number
  dupC?: number
  hair?: number
}
export interface PropSpec {
  /** `station`: a metro entrance; `bus-stop`: the bus stand of a district the metro does not reach (`byBus`). */
  kind: 'tapri' | 'tree' | 'lamp' | 'auto' | 'bench' | 'poster-wall' | 'station' | 'bus-stop'
  at: Vec2
  /** Degrees, the same turn as `BuildingSpec.rot`: 90 sends the front (+z) to -x. */
  rot?: number
}
/** A street show (see shows.ts): the puppet stage, the bowed-instrument player, the evening's dancers. */
export type ShowKind = 'kathputli' | 'ravanhatta' | 'dancers'
export interface ShowSpec {
  kind: ShowKind
  /** The middle of the ground it takes: open, clear of every collider and of everything E answers to. */
  at: Vec2
  /** Degrees, the same turn as `PropSpec.rot`: its front (+z) is where the audience stands. */
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
/** A district's rooftop viewpoint (see rooftop.ts `roofOver`): a stair up one building to a strip of its roof. */
export interface RoofDef {
  /** The roof's top, in metres above the street. */
  y: number
  /** The strip the player walks on up there: their middle stays inside it (less their radius). */
  area: AABB
  /** Where the climb sets the player: the middle of the strip. */
  landing: Vec2
  /** What the player and the view turn to on arriving up there. */
  view: Vec2
  /** The stair's foot, on the street: E here climbs, and coming down sets the player here. */
  stair: Vec2
  /** Out of the building's front, toward the street (unit, along x or z). */
  out: Vec2
  /** Out of the side wall the stair stands against (unit). */
  side: Vec2
  /**
   * The way the player faces at the stair's foot (coming down, or sent there by a link): `out` by default, the
   * street the building fronts. Where the chase camera, 7 m behind, would then sit in the stair's flight or
   * against a wall (Nahargarh's bastion), up the stair, so it hangs over the open ground in front instead.
   */
  foot?: Vec2
  /** The stair's flight beside that wall: a collider. Its low end is at the front. */
  flight: AABB
  /** How far back the flight runs from its low end. */
  run: number
  /** The building's footprint. */
  building: AABB
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
  /** The main crossings, where a signpost points the way to each landmark and the metro (see signposts.ts). */
  signposts?: Vec2[]
  /** The rooftop viewpoint (see rooftop.ts). */
  roof?: RoofDef
  /**
   * The rooftop viewpoint's name, when it is a place in its own right (Nahargarh's sunset point): then the
   * signposts point at its stair, the map shows it, and a link can stand someone there (place id `viewpoint`).
   */
  roofName?: { hi: string; en: string }
  /** Open water nobody walks into (Amer's lake): colliders with no building, drawn by the district's paving. */
  water?: AABB[]
  /**
   * Rock nobody walks into (Galta Ji's gorge walls): colliders the camera pulls in front of, as it does a
   * building's, drawn by the district's `scenery`.
   */
  rocks?: AABB[]
  /**
   * A ridge's edge (Nahargarh): west of this x the ground falls away, so the ground stops here and `scenery`
   * draws what lies below. It is the district's west wall: nobody walks past it.
   */
  ridgeWest?: number
  /**
   * Scenery drawn and never walked or hit (Nahargarh's city below the ridge; Galta Ji's gorge walls, whose
   * colliders are `rocks`, and its kunds' steps, inside `water`).
   */
  scenery?: () => THREE.Group
  /** The street shows (see shows.ts): at most one of a kind, only where one fits. */
  shows?: ShowSpec[]
  /** New Year's string lights (see festivalFx.ts): strands hung between building fronts, both ends `y` m up. */
  stringLights?: StringLight[]
}
/** One strand of string lights, sagging between its two ends. */
export interface StringLight {
  a: Vec2
  b: Vec2
  y: number
}
