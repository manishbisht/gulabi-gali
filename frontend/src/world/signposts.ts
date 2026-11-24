import * as THREE from 'three'
import type { Lang } from '../i18n/strings'
import { stopName } from './metroRide'
import { bake, box, merge } from './kit/parts'
import { PALETTE } from './palette'
import type { AABB, DistrictDef, Vec2 } from './types'

/*
 * Direction boards at a district's main crossings (`DistrictDef.signposts`): one arrow-shaped board per landmark
 * and one for the metro (and one for a named viewpoint's stair), each turned to point straight at it, with its name in both languages and how far it
 * is. Everything is read from the district's own data, so a landmark that moves takes its boards with it. A
 * district's posts are two meshes in all: the wood and paint (vertex colours), and the lettering (one canvas
 * shared by every board).
 */

/** One board: where it points, what it says, and how it is turned. */
export interface Board {
  /** The landmark's id, `metro`, or `viewpoint`. */
  id: string
  name: Record<Lang, string>
  to: Vec2
  /** Metres to `to`, to the nearest 10 (at least 10). */
  metres: number
  /** The turn about y, in radians, that sends the board's +x (its pointed end) toward `to`. */
  angle: number
}

export interface Signpost {
  at: Vec2
  /** Nearest first: the top board points at the closest place. */
  boards: Board[]
}

/** The post's foot, and its collider's half-width. */
const POST_W = 0.14
const POST_HALF = 0.15
/** The lowest board's underside (above a walker's head), each board's height, and the gap between them. */
const BOARD_Y = 2.1
const BOARD_H = 0.44
const BOARD_GAP = 0.1
/** The board's body runs this far out from the post; the point adds the rest. */
const BOARD_FROM = 0.07
const BODY_L = 1.7
const TIP_L = 0.32
const BOARD_T = 0.06
/** The lettering: a 4:1 face on each side of the body, a name (3:1) and its distance (2:1, half as tall) side by side. */
const FACE_W = 1.6
const FACE_H = 0.4
const NAME_W = 1.2
/** In the shared canvas: a 384 x 128 slot per place, and a 128 x 64 cell per distance. */
const CANVAS_W = 512
const NAME_PX = { w: 384, h: 128 }
const METRES_PX = { w: 128, h: 64 }

/** Every signpost in the district, with its boards. */
export function signpostsOf(def: DistrictDef): Signpost[] {
  const places = [
    ...def.landmarks.map((l) => ({ id: l.id, name: l.name, to: l.at })),
    { id: 'metro', name: stopName(def.id), to: def.station },
    // a named viewpoint (Nahargarh's sunset point): the board points at its stair
    ...(def.roof && def.roofName ? [{ id: 'viewpoint', name: def.roofName, to: def.roof.stair }] : []),
  ]
  return (def.signposts ?? []).map((at) => ({
    at,
    boards: places
      .map((p): Board => {
        const dx = p.to.x - at.x
        const dz = p.to.z - at.z
        const d = Math.hypot(dx, dz)
        return { ...p, metres: Math.max(10, Math.round(d / 10) * 10), angle: Math.atan2(-dz, dx) }
      })
      .sort((a, b) => a.metres - b.metres),
  }))
}

/** The height of board `i`'s middle (the top one is `0`). */
const boardY = (i: number, n: number) => BOARD_Y + (n - 1 - i) * (BOARD_H + BOARD_GAP) + BOARD_H / 2

/** The board's flat point: a triangle from the body's end, extruded to the board's thickness. */
function tip(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(0, -BOARD_H / 2)
  shape.lineTo(TIP_L, 0)
  shape.lineTo(0, BOARD_H / 2)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth: BOARD_T, bevelEnabled: false })
  return g.translate(BOARD_FROM + BODY_L, 0, -BOARD_T / 2)
}

/** A rectangle of the lettering canvas, in px from its top left. */
export interface Slot {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Where everything is lettered on the district's one canvas: each place's name once (however many posts point at
 * it), down the left; each distance once, two to a name's height down the right, then four to a row below. A
 * district's few places and distances fit in well under 1024 px, far from the 2048 a phone may cap a texture at.
 */
export function letteringLayout(posts: Signpost[]): {
  width: number
  height: number
  names: Map<string, Slot>
  metres: Map<number, Slot>
} {
  const names = new Map<string, Slot>()
  const metres = new Map<number, Slot>()
  for (const post of posts)
    for (const b of post.boards)
      if (!names.has(b.id)) names.set(b.id, { x: 0, y: names.size * NAME_PX.h, ...NAME_PX })
  const beside = names.size * 2 // distance cells beside the names
  const below = names.size * NAME_PX.h
  const perRow = CANVAS_W / METRES_PX.w
  for (const post of posts)
    for (const b of post.boards) {
      if (metres.has(b.metres)) continue
      const i = metres.size
      const at =
        i < beside
          ? { x: NAME_PX.w, y: i * METRES_PX.h }
          : {
              x: ((i - beside) % perRow) * METRES_PX.w,
              y: below + Math.floor((i - beside) / perRow) * METRES_PX.h,
            }
      metres.set(b.metres, { ...at, ...METRES_PX })
    }
  const rows = Math.ceil(Math.max(0, metres.size - beside) / perRow)
  return { width: CANVAS_W, height: Math.max(1, below + rows * METRES_PX.h), names, metres }
}

/** The district's lettering, laid out as `letteringLayout` says. */
function letter(posts: Signpost[], layout: ReturnType<typeof letteringLayout>): HTMLCanvasElement | null {
  if (!layout.names.size || typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = PALETTE.teal
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.textBaseline = 'middle'
  const named = new Map(posts.flatMap((p) => p.boards.map((b) => [b.id, b.name] as const)))
  for (const [id, r] of layout.names) {
    const name = named.get(id)!
    ctx.fillStyle = PALETTE.white
    ctx.fillRect(r.x, r.y, r.w, 4)
    ctx.fillRect(r.x, r.y + r.h - 4, r.w, 4)
    const two = name.hi !== name.en
    ctx.font = `700 ${two ? 40 : 46}px system-ui, sans-serif`
    ctx.fillText(name.hi, r.x + 18, r.y + (two ? 42 : r.h / 2), r.w - 30)
    if (two) {
      ctx.font = '500 30px system-ui, sans-serif'
      ctx.fillText(name.en, r.x + 18, r.y + 90, r.w - 30)
    }
  }
  ctx.font = '600 34px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = PALETTE.marigold
  for (const [m, r] of layout.metres) ctx.fillText(`${m} m`, r.x + r.w / 2, r.y + r.h / 2, r.w - 12)
  return canvas
}

/** A plane showing slot `r` of a `w` x `h` canvas (v runs up from the canvas's bottom row). */
function lettered(width: number, height: number, r: Slot, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height)
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  for (let k = 0; k < uv.count; k++) {
    uv.setX(k, (uv.getX(k) > 0.5 ? r.x + r.w : r.x) / w)
    uv.setY(k, 1 - (uv.getY(k) > 0.5 ? r.y : r.y + r.h) / h)
  }
  return g
}

/**
 * The district's signposts as two meshes (posts and boards; lettering) and a small collider at each post.
 * Without a 2D canvas (tests) the faces are plain paint. `District.dispose` frees all of it.
 */
export function buildSignposts(def: DistrictDef): {
  group: THREE.Group
  colliders: AABB[]
  posts: Signpost[]
} {
  const posts = signpostsOf(def)
  const group = new THREE.Group()
  group.name = 'signposts'
  if (!posts.length) return { group, colliders: [], posts }
  const layout = letteringLayout(posts)
  const wood: THREE.BufferGeometry[] = []
  const faces: THREE.BufferGeometry[] = []
  for (const post of posts) {
    const n = post.boards.length
    const top = boardY(0, n) + BOARD_H / 2 + 0.2
    wood.push(box(POST_W, top, POST_W, post.at.x, 0, post.at.z, 'sandstone'))
    wood.push(box(0.24, 0.12, 0.24, post.at.x, top, post.at.z, 'marigold'))
    post.boards.forEach((b, i) => {
      const y = boardY(i, n)
      const place = (g: THREE.BufferGeometry) => g.rotateY(b.angle).translate(post.at.x, y, post.at.z)
      wood.push(place(box(BODY_L, BOARD_H, BOARD_T, BOARD_FROM + BODY_L / 2, -BOARD_H / 2, 0, 'teal')))
      wood.push(place(bake(tip(), 'teal')))
      for (const side of [1, -1]) {
        // the name, and its distance by the point, as one face
        const name = lettered(NAME_W, FACE_H, layout.names.get(b.id)!, layout.width, layout.height)
        name.translate(-(FACE_W - NAME_W) / 2, 0, 0)
        const far = lettered(
          FACE_W - NAME_W,
          FACE_H / 2,
          layout.metres.get(b.metres)!,
          layout.width,
          layout.height,
        )
        far.translate(NAME_W / 2, 0, 0)
        const face = merge([name, far])
        // the back face is the front turned round: its lettering reads left to right from that side too
        if (side < 0) face.rotateY(Math.PI)
        face.translate(BOARD_FROM + BODY_L / 2, 0, side * (BOARD_T / 2 + 0.004))
        faces.push(place(face))
      }
    })
  }
  const paint = new THREE.Mesh(merge(wood), new THREE.MeshLambertMaterial({ vertexColors: true }))
  paint.name = 'signpost-boards'
  paint.castShadow = true
  const canvas = letter(posts, layout)
  const map = canvas ? new THREE.CanvasTexture(canvas) : null
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 4
  }
  const words = new THREE.Mesh(
    merge(faces),
    new THREE.MeshLambertMaterial(map ? { map } : { color: PALETTE.teal }),
  )
  words.name = 'signpost-words'
  group.add(paint, words)
  const colliders = posts.map(({ at }) => ({
    minX: at.x - POST_HALF,
    maxX: at.x + POST_HALF,
    minZ: at.z - POST_HALF,
    maxZ: at.z + POST_HALF,
  }))
  return { group, colliders, posts }
}
