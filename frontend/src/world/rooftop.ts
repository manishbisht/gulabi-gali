import * as THREE from 'three'
import { footprint } from './kit'
import { bake, box, FLOOR_H, merge } from './kit/parts'
import type { AABB, BuildingSpec, RoofDef, Vec2 } from './types'

/*
 * A district's rooftop viewpoint: a stair up the side of one building to a railed strip along the front of its
 * roof. E (or the button) at the stair's foot climbs, behind a short fade; on the roof the player walks only
 * inside the strip, and E again comes back down to the stair's foot.
 *
 * The others are told nothing new: a move carries x and z only, and the strip lies inside the building's
 * footprint, where nobody on the street can stand, so a client that sees someone there draws them on the roof
 * (`roofHeight`). The climb is a hop in x and z of at most `MAX_HOP`, no longer than the one-second burst the
 * server's speed check allows a walker after standing still (8 m). That burst refills at only 4 m/s while walking
 * (0.8 m/s at a jog), so a hop soon after another (down straight after climbing) can still be refused as too
 * fast. A refusal puts the player back where the server last heard of them, and where that is decides where they
 * are: on the strip they are up on the roof (nobody on the street can stand there), anywhere else on the street.
 */

/** The climb shows, and E climbs, this close to the stair's foot. */
export const STAIR_RANGE = 2
/** The furthest the climb or the way down moves the player in x and z, in metres. Under the server's 8 m burst. */
export const MAX_HOP = 7
/** How long the screen takes to fade out before the player is moved, and to fade back in (the `.fade` CSS's 300 ms). */
export const ROOF_FADE_MS = 300

/** How far the roof's top surface sits above the last floor, by style (the slab a shop or a modern block has). */
const TOP: Partial<Record<BuildingSpec['style'], number>> = { haveli: 0, shop: 0.45, modern: 0.3 }
/** Kept off the roof's corners: a haveli's front chhatris stand there. */
const INSET: Partial<Record<BuildingSpec['style'], number>> = { haveli: 1.6, shop: 0.3, modern: 0.3 }
/** The strip: at most this long along the front, this deep, and this far in from the front edge. */
const STRIP_L = 4
const STRIP_D = 2.6
const STRIP_IN = 0.25
/** The stair's flight: this wide off the side wall, and starting this far back from the front. */
const FLIGHT_W = 1.1
const FLIGHT_IN = 0.3
/** Where the stair's foot is: this far out past the side wall and in front of the building line. */
const FOOT_SIDE = 0.55
const FOOT_OUT = 0.6

/**
 * The viewpoint on `b`'s roof, with its stair against the side wall `side` (+1: the building's own +x side,
 * its right as you face its front; -1 its left). That side must face open ground. Up there the view turns to
 * `view` (a landmark, say); by default it looks straight out from the front.
 */
export function roofOver(b: BuildingSpec, side: 1 | -1, view?: Vec2): RoofDef {
  const top = TOP[b.style]
  const inset = INSET[b.style]
  if (top === undefined || inset === undefined) throw new Error(`No roof to stand on: ${b.style}`)
  const t = THREE.MathUtils.degToRad(b.rot ?? 0)
  // the building is turned by -rot about y (see buildBlock): its +x and its front (+z) in the world
  const along = { x: Math.round(Math.cos(t)), z: Math.round(Math.sin(t)) }
  const out = { x: -Math.round(Math.sin(t)), z: Math.round(Math.cos(t)) }
  const at = (lx: number, lz: number): Vec2 => ({
    x: b.x + along.x * lx + out.x * lz,
    z: b.z + along.z * lx + out.z * lz,
  })
  const box2 = (lx0: number, lz0: number, lx1: number, lz1: number): AABB => {
    const p = at(lx0, lz0)
    const q = at(lx1, lz1)
    return {
      minX: Math.min(p.x, q.x),
      maxX: Math.max(p.x, q.x),
      minZ: Math.min(p.z, q.z),
      maxZ: Math.max(p.z, q.z),
    }
  }
  const hw = b.w / 2
  const hd = b.d / 2
  const y = b.floors * FLOOR_H + top
  const length = Math.min(STRIP_L, b.w - 2 * inset - 0.4)
  if (length < 3) throw new Error(`Too narrow a roof: ${b.w} m`)
  const front = hd - STRIP_IN
  const end = side * (hw - inset)
  const area = box2(end, front, end - side * length, front - STRIP_D)
  const run = Math.min(b.d - 1, y * 0.9)
  const flight = box2(side * hw, hd - FLIGHT_IN, side * (hw + FLIGHT_W), hd - FLIGHT_IN - run)
  const landing = at(end - (side * length) / 2, front - STRIP_D / 2)
  return {
    y,
    area,
    landing,
    view: view ?? { x: landing.x + out.x * 20, z: landing.z + out.z * 20 },
    stair: at(side * (hw + FOOT_SIDE), hd + FOOT_OUT),
    out,
    side: { x: along.x * side, z: along.z * side },
    flight,
    run,
    building: footprint(b),
  }
}

/** `roofOver` the district's building standing at `at`. */
export function roofAt(buildings: readonly BuildingSpec[], at: Vec2, side: 1 | -1, view?: Vec2): RoofDef {
  const b = buildings.find((s) => inside(at, footprint(s)))
  if (!b) throw new Error(`No building at ${at.x},${at.z} to climb`)
  return roofOver(b, side, view)
}

/** Whether `p` is inside `a` grown by `m`. */
export const inside = (p: Vec2, a: AABB, m = 0) =>
  p.x >= a.minX - m && p.x <= a.maxX + m && p.z >= a.minZ - m && p.z <= a.maxZ + m

/**
 * How high a body at (x, z) stands: on the roof inside its strip, else on the street (0). The strip is inside the
 * building, where nobody on the street can stand, so this is how the others are drawn up there too.
 */
export function roofHeight(roof: RoofDef | undefined, x: number, z: number): number {
  if (!roof) return 0
  const a = roof.area
  return x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ ? roof.y : 0
}

/** Four slabs round the strip: on the roof they are the only walls, so the player walks nowhere else. */
export function roofWalls(roof: RoofDef): AABB[] {
  const { minX, maxX, minZ, maxZ } = roof.area
  const t = 10
  return [
    { minX: minX - t, maxX: minX, minZ: minZ - t, maxZ: maxZ + t },
    { minX: maxX, maxX: maxX + t, minZ: minZ - t, maxZ: maxZ + t },
    { minX, maxX, minZ: minZ - t, maxZ: minZ },
    { minX, maxX, minZ: maxZ, maxZ: maxZ + t },
  ]
}

/** One railing run along the edge `r` (a line: zero-wide on one axis), its posts at both ends. */
function railing(r: AABB, y: number): THREE.BufferGeometry[] {
  const w = Math.max(0.06, r.maxX - r.minX)
  const d = Math.max(0.06, r.maxZ - r.minZ)
  const cx = (r.minX + r.maxX) / 2
  const cz = (r.minZ + r.maxZ) / 2
  return [
    box(w, 0.06, d, cx, y + 0.9, cz, 'marigold'),
    box(w, 0.06, d, cx, y + 0.45, cz, 'marigold'),
    box(0.08, 0.9, 0.08, r.minX, y, r.minZ, 'white'),
    box(0.08, 0.9, 0.08, r.maxX, y, r.maxZ, 'white'),
  ]
}

/**
 * The stair, and the strip's dari and railing, as one vertex-coloured mesh: a steep masonry flight against the
 * side wall from the front of the building up to the roof, a marigold handrail, a marigold patch at its foot and
 * a pennant at its head (the marks that say it can be climbed). Its collider is `roof.flight`.
 */
export function buildRoof(roof: RoofDef): THREE.Mesh {
  const { flight, out, side, y, run, area } = roof
  const parts: THREE.BufferGeometry[] = []
  // the flight: solid steps from the street up to the roof, the lowest at the front; it climbs away from `out`
  const wide = side.x !== 0 // its width lies along x, its run along z
  const width = wide ? flight.maxX - flight.minX : flight.maxZ - flight.minZ
  const mid = wide ? (flight.minX + flight.maxX) / 2 : (flight.minZ + flight.maxZ) / 2
  const front = out.x > 0 ? flight.maxX : out.x < 0 ? flight.minX : out.z > 0 ? flight.maxZ : flight.minZ
  const climb = { x: -out.x, z: -out.z }
  const steps = Math.ceil(y / 0.4)
  const tread = run / steps
  for (let i = 0; i < steps; i++) {
    const at = front + (climb.x || climb.z) * (i + 0.5) * tread
    const h = (y * (i + 1)) / steps
    parts.push(
      wide ? box(width, h, tread, mid, 0, at, 'sandstone') : box(tread, h, width, at, 0, mid, 'sandstone'),
    )
  }
  // the handrail along its open edge, a hand's height over the nosings
  const rim = mid + (wide ? side.x : side.z) * (width / 2 - 0.05)
  const foot = wide ? { x: rim, z: front } : { x: front, z: rim }
  const rail = new THREE.BoxGeometry(Math.hypot(run, y), 0.08, 0.08)
  rail.rotateZ(Math.atan2(y, run))
  rail.rotateY(Math.atan2(-climb.z, climb.x))
  rail.translate(foot.x + (climb.x * run) / 2, y / 2 + 0.9, foot.z + (climb.z * run) / 2)
  parts.push(bake(rail, 'marigold'), box(0.1, 0.9, 0.1, foot.x, 0, foot.z, 'marigold'))
  // the marks: a patch at the foot, and a pennant on a pole at the head
  parts.push(box(1.2, 0.03, 1.2, roof.stair.x, 0, roof.stair.z, 'marigold'))
  const head = { x: foot.x + climb.x * run, z: foot.z + climb.z * run }
  parts.push(box(0.08, 2.4, 0.08, head.x, y, head.z, 'white'))
  const pennant = new THREE.BoxGeometry(0.04, 0.5, 0.8).rotateY(Math.atan2(out.x, out.z))
  parts.push(bake(pennant.translate(head.x + out.x * 0.4, y + 2.05, head.z + out.z * 0.4), 'marigold'))
  // the strip: a dari to stand on, and a railing on its open sides (the front, and its two ends)
  const cx = (area.minX + area.maxX) / 2
  const cz = (area.minZ + area.maxZ) / 2
  parts.push(box(area.maxX - area.minX, 0.04, area.maxZ - area.minZ, cx, y, cz, 'pink'))
  const lip = out.x > 0 ? area.maxX : out.x < 0 ? area.minX : out.z > 0 ? area.maxZ : area.minZ
  const edges: AABB[] =
    out.x !== 0
      ? [
          { minX: lip, maxX: lip, minZ: area.minZ, maxZ: area.maxZ },
          { ...area, maxZ: area.minZ },
          { ...area, minZ: area.maxZ },
        ]
      : [
          { minX: area.minX, maxX: area.maxX, minZ: lip, maxZ: lip },
          { ...area, maxX: area.minX },
          { ...area, minX: area.maxX },
        ]
  for (const e of edges) parts.push(...railing(e, y))
  const mesh = new THREE.Mesh(merge(parts), new THREE.MeshLambertMaterial({ vertexColors: true }))
  mesh.name = 'roof-stair'
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** What the rooftop tells React. Each is called only when its news changes. */
export interface RoofHooks {
  /** The stair's foot is in reach (never while up on the roof). */
  near(on: boolean): void
  /** The player is up on the roof, or back down. */
  up(on: boolean): void
  /** The screen is fading out (true) for a climb or the way down, and back in (false). */
  fade(on: boolean): void
}

/** What the rooftop moves: the player's own body (see player.ts). */
export interface RoofPlayer {
  teleport(x: number, z: number, ry?: number): void
  setFloor(floor: { y: number; walls: AABB[]; under?: AABB } | null): void
}

export interface Rooftop {
  /** Every frame, with where the player stands. */
  update(pos: Vec2): void
  near(): boolean
  up(): boolean
  /** At the foot, climbs; on the roof, comes down. Behind a fade; another press during one does nothing. */
  toggle(): void
  dispose(): void
}

/**
 * The viewpoint's goings up and down. The climb sets the player in the middle of the strip facing `roof.view`,
 * and `face` turns the view that way too; the way down sets them at the stair's foot. Up there the strip's walls
 * are their only ones (`RoofPlayer.setFloor`), so they cannot walk off it. If anything moves them all the same
 * (the server refusing a hop and putting them back where it last heard of them), where they land decides: off
 * the strip, on the street again at once (never left standing in the air); on it, up on the roof again (never
 * left inside the building).
 */
export function createRooftop(opts: {
  roof: RoofDef
  player: RoofPlayer
  hooks: RoofHooks
  /** Turns the view to `yaw` (as `Player.view`: 0 looks along -z, positive turned left). */
  face?(yaw: number): void
}): Rooftop {
  const { roof, player, hooks } = opts
  const floor = { y: roof.y, walls: roofWalls(roof), under: roof.building }
  // up there, the player and the view turn to `roof.view`; at the foot, the player faces the street
  const dx = roof.view.x - roof.landing.x
  const dz = roof.view.z - roof.landing.z
  const foot = roof.foot ?? roof.out
  const facing = Math.atan2(foot.x, foot.z)
  const viewing = Math.atan2(dx, dz)
  const looking = Math.atan2(-dx, -dz)
  let near = false
  let up = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const setNear = (on: boolean) => {
    if (on !== near) hooks.near(on)
    near = on
  }
  const setUp = (on: boolean) => {
    if (on !== up) hooks.up(on)
    up = on
  }

  /** Where the player last stood, even mid-fade. */
  const at: Vec2 = { x: Infinity, z: Infinity }
  const inReach = () => Math.hypot(at.x - roof.stair.x, at.z - roof.stair.z) <= STAIR_RANGE

  function move() {
    if (up) {
      player.setFloor(null)
      player.teleport(roof.stair.x, roof.stair.z, facing)
      setUp(false)
      setNear(true) // at the foot before the screen clears: the button stays put under a finger or the focus
      return
    }
    // walked away from the foot while the screen went dark: the hop up would be longer than `MAX_HOP` allows
    if (!inReach()) return
    setNear(false)
    player.setFloor(floor)
    player.teleport(roof.landing.x, roof.landing.z, viewing)
    opts.face?.(looking)
    setUp(true)
  }

  return {
    update(pos) {
      at.x = pos.x
      at.z = pos.z
      // Where the player stands says where they are, even mid-fade: a refused hop puts them back where the
      // server last heard of them. Off the strip they are on the street; on it, up on the roof (never in the air,
      // never inside the walls).
      const onStrip = inside(pos, roof.area, 0.01)
      if (up && !onStrip) {
        player.setFloor(null)
        setUp(false)
      } else if (!up && onStrip) {
        player.setFloor(floor)
        setUp(true)
      }
      if (timer) return // mid-fade: the button keeps what it says under the black
      setNear(!up && inReach())
    },
    near: () => near,
    up: () => up,
    toggle() {
      if (timer || (!up && !near)) return
      hooks.fade(true)
      timer = setTimeout(() => {
        move()
        timer = setTimeout(() => {
          timer = null
          hooks.fade(false)
        }, ROOF_FADE_MS)
      }, ROOF_FADE_MS)
    },
    dispose() {
      if (timer) {
        clearTimeout(timer)
        timer = null
        hooks.fade(false)
      }
      // the district goes with its player: only React needs telling
      if (up) hooks.up(false)
      if (near) hooks.near(false)
      up = near = false
    },
  }
}
