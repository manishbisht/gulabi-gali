import * as THREE from 'three'
import { bakeHex, box, merge } from './kit/parts'
import { PALETTE } from './palette'
import type { AABB, DistrictDef, PitchDef, Vec2 } from './types'

/*
 * Gali cricket's pitch, in the lane: chalked creases, a stack of bricks for stumps and a kid who bowls. A
 * district has one when its def says where (`DistrictDef.cricket`), so another is data only. Walk up and
 * "Cricket khelo" (E) opens the game, which is its own lazy chunk (`ui/Cricket.tsx`); this file is the little
 * that stands in the street all day: two meshes with one material, and two small colliders.
 *
 * Priority of E (see `createInteraction`): everything else first, a street animal last; the pitch is between.
 */

/** "Cricket khelo" is offered this close to the pitch (to the line from the stumps to the bowler). */
export const PITCH_RANGE = 2.5
/** Half the chalked strip's width. */
export const PITCH_HALF_WIDTH = 0.8
/** How far in front of the stumps the batting crease is chalked: where the bat meets the ball. */
export const CREASE_M = 0.9
/** The stumps and the bowler, as colliders: half a side each. */
const BODY = 0.25
/** The chalk lies just over the lane's paving. */
const CHALK_Y = 0.05
const CHALK = '#EFE9DC'
const BRICK_DARK = '#9C4A37'
const SKIN = '#B9825A'
const HAIR = '#2A1D24'

/** The pitch's own axes: from the stumps (`x`, `z`) the bowler is `length` metres along (`fx`, `fz`). */
export interface PitchFrame {
  x: number
  z: number
  fx: number
  fz: number
  length: number
}

export function pitchFrame(p: PitchDef): PitchFrame {
  const dx = p.bowler.x - p.stumps.x
  const dz = p.bowler.z - p.stumps.z
  const length = Math.hypot(dx, dz) || 1
  return { x: p.stumps.x, z: p.stumps.z, fx: dx / length, fz: dz / length, length }
}

/** How far `pos` is from the pitch: from the line between the stumps and the bowler. */
export function pitchDistance(p: PitchDef, pos: Vec2): number {
  const dx = p.bowler.x - p.stumps.x
  const dz = p.bowler.z - p.stumps.z
  const len2 = dx * dx + dz * dz || 1
  const u = Math.max(0, Math.min(1, ((pos.x - p.stumps.x) * dx + (pos.z - p.stumps.z) * dz) / len2))
  return Math.hypot(pos.x - (p.stumps.x + dx * u), pos.z - (p.stumps.z + dz * u))
}

/** Whether "Cricket khelo" is in reach at `pos` in this district. */
export const pitchNear = (def: Pick<DistrictDef, 'cricket'>, pos: Vec2): boolean =>
  !!def.cricket && pitchDistance(def.cricket, pos) <= PITCH_RANGE

const around = (at: Vec2): AABB => ({
  minX: at.x - BODY,
  maxX: at.x + BODY,
  minZ: at.z - BODY,
  maxZ: at.z + BODY,
})

/** What nobody walks or drives through: the brick stumps and the kid. The chalk is only chalk. */
export const pitchColliders = (p: PitchDef): AABB[] => [around(p.stumps), around(p.bowler)]

/**
 * A kid of about ten, 1.2 m tall, standing on y = 0 at the origin and facing -z: one merged, vertex-coloured
 * piece. The bowler wears one shirt and the game's fielders another (`games/cricketView.ts`).
 */
export function kidGeometry(shirt: string = PALETTE.marigold): THREE.BufferGeometry {
  const part = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string) => {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(x, y + h / 2, z)
    return bakeHex(g, hex)
  }
  return merge([
    part(0.1, 0.42, 0.11, -0.08, 0, 0, SKIN),
    part(0.1, 0.42, 0.11, 0.08, 0, 0, SKIN),
    part(0.3, 0.17, 0.19, 0, 0.4, 0, PALETTE.road),
    part(0.32, 0.36, 0.19, 0, 0.57, 0, shirt),
    part(0.08, 0.34, 0.09, -0.21, 0.57, 0, SKIN),
    part(0.08, 0.34, 0.09, 0.21, 0.57, 0, SKIN),
    part(0.22, 0.22, 0.22, 0, 0.94, 0, SKIN),
    part(0.24, 0.07, 0.24, 0, 1.14, 0, HAIR),
    part(0.24, 0.14, 0.06, 0, 1.02, 0.1, HAIR),
  ])
}

/**
 * The pitch as it stands in the lane: `cricket-pitch` (the chalk and the brick stumps, one merged mesh) and
 * `cricket-bowler` (the kid, their own mesh so the game can make them run in). Built along +z from the stumps
 * and turned to lie where the def says. Both share one material; the district's `disposeTree` frees them.
 */
export function buildPitch(p: PitchDef): THREE.Group {
  const f = pitchFrame(p)
  const group = new THREE.Group()
  group.name = 'cricket'
  group.position.set(f.x, 0, f.z)
  group.rotation.y = Math.atan2(f.fx, f.fz)
  const chalk = (w: number, d: number, x: number, z: number) => {
    const g = new THREE.BoxGeometry(w, 0.012, d)
    g.translate(x, CHALK_Y, z)
    return bakeHex(g, CHALK)
  }
  const W = PITCH_HALF_WIDTH
  const parts: THREE.BufferGeometry[] = [
    // the two creases, and the strip's long edges drawn by a hurried hand: short of the creases at both ends
    chalk(W * 2, 0.07, 0, CREASE_M),
    chalk(W * 2, 0.07, 0, f.length - 0.5),
    chalk(0.05, f.length - 1.9, -W, f.length / 2 + 0.2),
    chalk(0.05, f.length - 1.9, W, f.length / 2 + 0.2),
  ]
  // the stumps: bricks stacked two by two, each course laid across the one below
  for (let course = 0; course < 6; course++) {
    const across = course % 2 === 0
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(across ? 0.21 : 0.1, 0.085, across ? 0.1 : 0.21)
      g.translate(across ? 0 : s * 0.055, 0.0425 + course * 0.09, across ? s * 0.055 : 0)
      parts.push(bakeHex(g, (course + (s > 0 ? 1 : 0)) % 3 === 0 ? BRICK_DARK : PALETTE.terracotta))
    }
  }
  // a brick at the bowler's end too, to bowl from
  parts.push(box(0.21, 0.085, 0.1, W * 0.6, 0, f.length - 0.5, 'terracotta'))
  const material = new THREE.MeshLambertMaterial({ vertexColors: true })
  const pitch = new THREE.Mesh(merge(parts), material)
  pitch.name = 'cricket-pitch'
  pitch.receiveShadow = true
  const bowler = new THREE.Mesh(kidGeometry(), material)
  bowler.name = 'cricket-bowler'
  bowler.position.set(0, 0, f.length)
  bowler.castShadow = true
  group.add(pitch, bowler)
  return group
}

/** What the pitch tells React (see useCricket). `near` is called only when its news changes. */
export interface CricketHooks {
  /** The pitch is in reach. */
  near(on: boolean): void
  /** E by the pitch, with nothing else wanting the key: open the game. */
  play(): void
  /** The district with the pitch is going: a game that is up ends with it. */
  left(): void
}

/** Watches for the player coming up to the pitch: allocates nothing per frame. */
export function createPitch(pitch: PitchDef, hooks: CricketHooks) {
  let near = false
  return {
    update(pos: Vec2) {
      const on = pitchDistance(pitch, pos) <= PITCH_RANGE
      if (on !== near) hooks.near(on)
      near = on
    },
    dispose() {
      if (near) hooks.near(false)
      near = false
      hooks.left()
    },
  }
}

type Played = (runs: number) => void
const played = new Set<Played>()

/**
 * A round of gali cricket just ended (three outs or the last ball), with `runs` on the board: the one place
 * the rest of the page hears of it (the day's goals hang off this). Local to the page; nothing is sent.
 */
export function cricketPlayed(runs: number): void {
  for (const fn of [...played])
    try {
      fn(runs)
    } catch {
      // one broken listener must not break the game's ending
    }
}

/** Listens for finished rounds; returns the way to stop. */
export function onCricketPlayed(fn: Played): () => void {
  played.add(fn)
  return () => void played.delete(fn)
}
