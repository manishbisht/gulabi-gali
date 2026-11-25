import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Stage } from '../engine/stage'
import { PLAYER_RADIUS } from '../player/player'
import { DISTRICTS, loadDistrict } from '../world/district'
import type { AABB, Vec2 } from '../world/types'
import { createPatang } from './patang'
import { createPatangView, patangEye } from './patangView'

describe('createPatangView', () => {
  const stage = () =>
    ({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 0.5, 0.1, 500) }) as unknown as Stage

  it('looks up from where the player stands: on the street, or up on a roof by its height', () => {
    const s = stage()
    const sim = createPatang(3, 2)
    const view = createPatangView(s, sim.state.rivals.length)
    const at = { x: 10, z: -4 }
    view.update(sim.state, at)
    const street = s.camera.position.clone()
    expect(street.y).toBeGreaterThan(1.5)
    expect(street.y).toBeLessThan(4)
    view.update(sim.state, at, 9.6)
    expect(s.camera.position.y).toBeCloseTo(street.y + 9.6)
    expect(s.camera.position.x).toBeCloseTo(street.x)
    expect(s.camera.position.z).toBeCloseTo(street.z)
    // the camera stands where patangEye says
    const eye = patangEye(at, 9.6, { x: 0, y: 0, z: 0 })
    expect(s.camera.position.toArray()).toEqual([eye.x, eye.y, eye.z])
    // and the sky the kites fly in still hangs in front of the camera, looking up
    const sky = s.scene.getObjectByName('patang')!
    expect(sky.position.y).toBeGreaterThan(s.camera.position.y)
    view.dispose()
    sim.dispose()
  })
})

/** Whether (x, z) is inside `a` grown by `m`. */
const within = (p: Vec2, a: AABB, m: number) =>
  p.x > a.minX - m && p.x < a.maxX + m && p.z > a.minZ - m && p.z < a.maxZ + m
const sameBox = (a: AABB, b: AABB) =>
  a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ

describe.each(DISTRICTS)("%s: the kite fight's camera up on the rooftop viewpoint", (id) => {
  it('stands in the clear, above the roof, wherever on the strip the game starts', async () => {
    const district = await loadDistrict(id)
    const roof = district.def.roof
    if (!roof) return district.dispose()
    const a = roof.area
    const m = PLAYER_RADIUS
    // the landing, and the strip's corners as far as a player's middle can reach
    const spots: Vec2[] = [
      roof.landing,
      { x: a.minX + m, z: a.minZ + m },
      { x: a.maxX - m, z: a.minZ + m },
      { x: a.minX + m, z: a.maxZ - m },
      { x: a.maxX - m, z: a.maxZ - m },
    ]
    const eye = { x: 0, y: 0, z: 0 }
    for (const at of spots) {
      patangEye(at, roof.y, eye)
      expect(eye.y, `eye height from ${at.x}, ${at.z}`).toBeGreaterThan(roof.y + 1.5)
      // out of every building and landmark wall the chase camera keeps out of, but the roof underfoot (as
      // player.ts does up there), with a near plane's margin
      const hit = district.occluders.find((o) => !sameBox(o, roof.building) && within(eye, o, 0.3))
      expect(hit, `camera at ${eye.x}, ${eye.z} from ${at.x}, ${at.z}`).toBeUndefined()
    }
    district.dispose()
  })
})
