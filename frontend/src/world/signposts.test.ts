import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { bearing } from './cityMap'
import { DISTRICTS, loadDistrict, type District } from './district'
import { buildSignposts, letteringLayout, signpostsOf } from './signposts'
import type { AABB, DistrictDef, Vec2 } from './types'

const loaded = new Map<string, Promise<District>>()
const load = (id: DistrictDef['id']) => {
  if (!loaded.has(id)) loaded.set(id, loadDistrict(id))
  return loaded.get(id)!
}

/** The way a board turned by `angle` about y points, as a bearing (degrees clockwise from north, -z). */
const pointing = (angle: number) => bearing({ x: 0, z: 0 }, { x: Math.cos(angle), z: -Math.sin(angle) })
/** The smallest turn between two bearings, in degrees. */
const apart = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

const segment = (p: Vec2, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = dx * dx + dz * dz
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz)
}
const within = (p: Vec2, c: AABB, m: number) =>
  p.x > c.minX - m && p.x < c.maxX + m && p.z > c.minZ - m && p.z < c.maxZ + m

describe.each(DISTRICTS)('%s: signposts', (id) => {
  it('stand at its crossings, each pointing at every landmark of the district and at the metro', async () => {
    const { def } = await load(id)
    const posts = signpostsOf(def)
    expect(posts.length).toBeGreaterThanOrEqual(2)
    const places = [...def.landmarks.map((l) => ({ id: l.id, at: l.at })), { id: 'metro', at: def.station }]
    for (const post of posts) {
      expect(post.boards.map((b) => b.id).sort()).toEqual(places.map((p) => p.id).sort())
      for (const board of post.boards) {
        const place = places.find((p) => p.id === board.id)!
        expect(apart(pointing(board.angle), bearing(post.at, place.at)), board.id).toBeLessThan(0.01)
        const metres = Math.hypot(place.at.x - post.at.x, place.at.z - post.at.z)
        expect(Math.abs(board.metres - metres)).toBeLessThanOrEqual(5)
        expect(board.metres % 10).toBe(0)
        expect(board.name.hi.trim()).not.toBe('')
        expect(board.name.en.trim()).not.toBe('')
      }
      // nearest first, top to bottom
      const ms = post.boards.map((b) => b.metres)
      expect(ms).toEqual([...ms].sort((a, b) => a - b))
    }
  })

  it('are built where they point: each board reaches out toward its place', async () => {
    const d = await load(id)
    const { group, colliders, posts } = buildSignposts(d.def)
    const paint = group.getObjectByName('signpost-boards') as THREE.Mesh
    const pos = paint.geometry.getAttribute('position')
    const v = new THREE.Vector3()
    for (const post of posts)
      for (const board of post.boards) {
        // the board's point: 2.09 m out from the post, toward the place
        const reach = 2.09
        const tip = {
          x: post.at.x + Math.cos(board.angle) * reach,
          z: post.at.z - Math.sin(board.angle) * reach,
        }
        let found = false
        for (let i = 0; i < pos.count && !found; i++) {
          v.fromBufferAttribute(pos, i)
          found = Math.hypot(v.x - tip.x, v.z - tip.z) < 0.05 && v.y > 2
        }
        expect(found, `${board.id} from ${post.at.x},${post.at.z}`).toBe(true)
      }
    expect(colliders).toHaveLength(posts.length)
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    })
  })

  it('letter every board from one small canvas: a name once per place, each distance once', async () => {
    const { def } = await load(id)
    const posts = signpostsOf(def)
    const layout = letteringLayout(posts)
    // well under the 2048 px a phone's GPU may cap a texture at, whatever the district
    expect(layout.height).toBeLessThanOrEqual(1024)
    expect(layout.width).toBeLessThanOrEqual(1024)
    const places = new Set(posts.flatMap((p) => p.boards.map((b) => b.id)))
    expect(layout.names.size).toBe(places.size)
    const metres = new Set(posts.flatMap((p) => p.boards.map((b) => b.metres)))
    expect(layout.metres.size).toBe(metres.size)
    // no two slots overlap, and all of them are on the canvas
    const rects = [...layout.names.values(), ...layout.metres.values()]
    for (const [i, a] of rects.entries()) {
      expect(a.x + a.w).toBeLessThanOrEqual(layout.width)
      expect(a.y + a.h).toBeLessThanOrEqual(layout.height)
      for (const b of rects.slice(i + 1))
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false)
    }
  })

  it('stand clear of everything else, the procession and the way in, and the district has them', async () => {
    const d = await load(id)
    const { def } = d
    const solid = d.colliders.filter((c) => c.maxX - c.minX > 0.5 || c.maxZ - c.minZ > 0.5)
    for (const at of def.signposts!) {
      for (const c of solid) expect(within(at, c, 0.8), `${at.x},${at.z} in ${JSON.stringify(c)}`).toBe(false)
      for (const p of def.props) expect(Math.hypot(p.at.x - at.x, p.at.z - at.z)).toBeGreaterThan(1.2)
      const route = def.processionRoute
      for (let i = 0; i < route.length; i++)
        expect(segment(at, route[i]!, route[(i + 1) % route.length]!)).toBeGreaterThan(1.6)
      expect(Math.hypot(def.spawn.x - at.x, def.spawn.z - at.z)).toBeGreaterThan(2)
      // the post is a collider
      expect(d.colliders.some((c) => within(at, c, 0))).toBe(true)
    }
    expect(d.root.getObjectByName('signposts')).toBeDefined()
  })
})

it('a district without crossings listed has no signposts, and builds nothing', () => {
  const def = { landmarks: [], station: { x: 0, z: 0 } } as unknown as DistrictDef
  expect(signpostsOf(def)).toEqual([])
  expect(buildSignposts(def).group.children).toHaveLength(0)
})
