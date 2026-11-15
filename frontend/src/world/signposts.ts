import * as THREE from 'three'
import { t, type Lang } from '../i18n/strings'
import { bake, box, merge } from './kit/parts'
import { PALETTE } from './palette'
import type { AABB, DistrictDef, Vec2 } from './types'

/*
 * Direction boards at a district's main crossings (`DistrictDef.signposts`): one arrow-shaped board per landmark
 * and one for the metro, each turned to point straight at it, with its name in both languages and how far it
 * is. Everything is read from the district's own data, so a landmark that moves takes its boards with it. A
 * district's posts are two meshes in all: the wood and paint (vertex colours), and the lettering (one canvas
 * shared by every board).
 */

/** One board: where it points, what it says, and how it is turned. */
export interface Board {
  /** The landmark's id, or `metro`. */
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
/** The lettering: a 4:1 face on each side of the body, from a 512 x 128 slot of the shared canvas. */
const FACE_W = 1.6
const FACE_H = 0.4
const SLOT_W = 512
const SLOT_H = 128

/** Every signpost in the district, with its boards. */
export function signpostsOf(def: DistrictDef): Signpost[] {
  const places = [
    ...def.landmarks.map((l) => ({ id: l.id, name: l.name, to: l.at })),
    { id: 'metro', name: { hi: t('mapMetro', 'hi'), en: t('mapMetro', 'en') }, to: def.station },
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

/** The district's lettering: one slot per board, top to bottom in the order they are built. */
function letter(posts: Signpost[]): HTMLCanvasElement | null {
  const n = posts.reduce((sum, p) => sum + p.boards.length, 0)
  if (!n || typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = SLOT_W
  canvas.height = SLOT_H * n
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = PALETTE.teal
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.textBaseline = 'middle'
  let slot = 0
  for (const post of posts)
    for (const b of post.boards) {
      const y = slot++ * SLOT_H
      ctx.fillStyle = PALETTE.white
      ctx.fillRect(0, y, SLOT_W, 4)
      ctx.fillRect(0, y + SLOT_H - 4, SLOT_W, 4)
      const two = b.name.hi !== b.name.en
      const width = SLOT_W - 150
      ctx.font = `700 ${two ? 40 : 46}px system-ui, sans-serif`
      ctx.fillText(b.name.hi, 18, y + (two ? 42 : SLOT_H / 2), width)
      if (two) {
        ctx.font = '500 30px system-ui, sans-serif'
        ctx.fillText(b.name.en, 18, y + 90, width)
      }
      ctx.font = '600 34px system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillStyle = PALETTE.marigold
      ctx.fillText(`${b.metres} m`, SLOT_W - 16, y + SLOT_H / 2)
      ctx.textAlign = 'left'
    }
  return canvas
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
  const total = posts.reduce((sum, p) => sum + p.boards.length, 0)
  const wood: THREE.BufferGeometry[] = []
  const faces: THREE.BufferGeometry[] = []
  let slot = 0
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
      // the slot's rows of the canvas (v runs up from its bottom row)
      const v0 = 1 - (slot + 1) / total
      const v1 = 1 - slot / total
      slot++
      for (const side of [1, -1]) {
        const face = new THREE.PlaneGeometry(FACE_W, FACE_H)
        const uv = face.getAttribute('uv') as THREE.BufferAttribute
        for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) > 0.5 ? v1 : v0)
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
  const canvas = letter(posts)
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
