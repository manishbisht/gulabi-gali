import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createFollowCamera } from './camera'

it('sits about 7 m behind and 4.5 m above, easing toward a moving target', () => {
  const cam = new THREE.PerspectiveCamera()
  const follow = createFollowCamera(cam)
  follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
  expect(cam.position.z).toBeCloseTo(7)
  expect(cam.position.y).toBeCloseTo(4.5)
  follow.update({ x: 10, y: 0, z: 0 }, 1 / 30)
  expect(cam.position.x).toBeGreaterThan(0)
  expect(cam.position.x).toBeLessThan(10)
  for (let i = 0; i < 300; i++) follow.update({ x: 10, y: 0, z: 0 }, 1 / 30)
  expect(cam.position.x).toBeCloseTo(10, 1)
})

it('pulls in rather than sit inside a building behind the player', () => {
  const cam = new THREE.PerspectiveCamera()
  // A building whose front is 3 m behind (south of) the player.
  const follow = createFollowCamera(cam, [{ minX: -10, maxX: 10, minZ: 3, maxZ: 15 }])
  follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
  expect(cam.position.z).toBeLessThan(3)
  expect(cam.position.z).toBeGreaterThan(0)
  expect(cam.position.y).toBeCloseTo(4.5) // it slides in, keeping its height
  // Walk away from it and the camera eases back out to its usual spot.
  for (let i = 0; i < 300; i++) follow.update({ x: 0, y: 0, z: -20 }, 1 / 30)
  expect(cam.position.z).toBeCloseTo(-13)
})

/** A camera that has settled on a player standing at the origin, after `turn`. */
function settled(
  yaw: number,
  pitch = 0,
  occluders: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [],
) {
  const cam = new THREE.PerspectiveCamera()
  const follow = createFollowCamera(cam, occluders, { reducedMotion: true })
  follow.turn(yaw, pitch)
  follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
  return { cam, follow }
}
const forward = (cam: THREE.PerspectiveCamera) => cam.getWorldDirection(new THREE.Vector3())

it("looks the way today's chase camera does until someone turns it: from (0, 4.5, 7) at a point 5 m ahead", () => {
  const { cam, follow } = settled(0)
  expect(follow.yaw()).toBe(0)
  expect(follow.pitch()).toBe(0)
  expect(cam.position.x).toBeCloseTo(0)
  expect(cam.position.y).toBeCloseTo(4.5)
  expect(cam.position.z).toBeCloseTo(7)
  // the view runs through head height (1.6 m) 5 m beyond the player
  const f = forward(cam)
  const s = (1.6 - cam.position.y) / f.y
  expect(cam.position.x + f.x * s).toBeCloseTo(0)
  expect(cam.position.z + f.z * s).toBeCloseTo(-5)
})

it('turning by yaw swings the camera round the player and aims through the point ahead along the new view', () => {
  // +90° turns the view left: from facing -z to facing -x, the camera now east of the player
  const left = settled(Math.PI / 2)
  expect(left.cam.position.x).toBeCloseTo(7)
  expect(left.cam.position.z).toBeCloseTo(0)
  expect(left.cam.position.y).toBeCloseTo(4.5)
  const f = forward(left.cam)
  expect(f.x).toBeLessThan(-0.9)
  expect(Math.abs(f.z)).toBeLessThan(1e-6)
  const s = (1.6 - left.cam.position.y) / f.y
  expect(left.cam.position.x + f.x * s).toBeCloseTo(-5)
  // 180°: looking back, from the north side
  const back = settled(Math.PI)
  expect(back.cam.position.z).toBeCloseTo(-7)
  expect(forward(back.cam).z).toBeGreaterThan(0.9)
  // a full turn and more is still a turn: yaw is kept within ±π
  expect(settled(2 * Math.PI + 0.5).follow.yaw()).toBeCloseTo(0.5)
})

it('pitch is clamped: never under the ground, never flipped, and up tilts the view above the horizon', () => {
  const up = settled(0, 10)
  expect(up.follow.pitch()).toBeLessThan(0.5)
  expect(up.cam.position.y).toBeGreaterThan(1.5) // still above head height, nowhere near the ground
  expect(forward(up.cam).y).toBeGreaterThan(0.1) // rooftops and sky
  expect(forward(up.cam).z).toBeLessThan(-0.9) // still facing the way it did
  const down = settled(0, -10)
  expect(down.follow.pitch()).toBeGreaterThan(-0.5)
  expect(down.cam.position.y).toBeGreaterThan(4.5) // more top-down
  expect(forward(down.cam).y).toBeLessThan(-0.5)
  expect(forward(down.cam).z).toBeLessThan(-0.5) // not straight down, and not over the top
  // and a turn back the other way leaves the limit at once (no wind-up past it)
  up.follow.turn(0, -0.1)
  up.follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
  expect(up.follow.pitch()).toBeLessThan(settled(0, 10).follow.pitch())
})

it('pulls in from a wall at every yaw: east (90°) and north (180°)', () => {
  const east = settled(Math.PI / 2, 0, [{ minX: 3, maxX: 15, minZ: -10, maxZ: 10 }])
  expect(east.cam.position.x).toBeLessThan(3)
  expect(east.cam.position.x).toBeGreaterThan(0)
  expect(east.cam.position.y).toBeCloseTo(4.5)
  const north = settled(Math.PI, 0, [{ minX: -10, maxX: 10, minZ: -15, maxZ: -3 }])
  expect(north.cam.position.z).toBeGreaterThan(-3)
  expect(north.cam.position.z).toBeLessThan(0)
  // pulling in never tips the view: it faces exactly as it does in the open
  expect(forward(north.cam).y).toBeCloseTo(forward(settled(Math.PI).cam).y)
})

it('position lag never yaws the view: a sideways step slides the camera but keeps its heading', () => {
  const { cam, follow } = settled(Math.PI / 4)
  const before = forward(cam)
  follow.update({ x: 3, y: 0, z: -2 }, 1 / 30) // the player moved, the camera lags behind
  const after = forward(cam)
  expect(after.x).toBeCloseTo(before.x)
  expect(after.z).toBeCloseTo(before.z)
})

it('eases into a turn (a few frames), unless reduced motion asks for none', () => {
  const cam = new THREE.PerspectiveCamera()
  const follow = createFollowCamera(cam, [], { reducedMotion: false })
  follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
  follow.turn(1, 0)
  follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
  expect(follow.yaw()).toBeGreaterThan(0.2)
  expect(follow.yaw()).toBeLessThan(1)
  for (let i = 0; i < 30; i++) follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
  expect(follow.yaw()).toBeCloseTo(1, 3)
})

it('at the wheel, comes round behind the auto once nobody has turned it for 1.5 s; walking, it stays put', () => {
  const { follow } = settled(Math.PI / 2) // looking west
  const behind = Math.PI // an auto heading +z: behind it is looking +z
  for (let i = 0; i < 30; i++) follow.update({ x: 0, y: 0, z: 0 }, 1 / 30, behind) // 1 s: not yet
  expect(follow.yaw()).toBeCloseTo(Math.PI / 2)
  for (let i = 0; i < 150; i++) follow.update({ x: 0, y: 0, z: 0 }, 1 / 30, behind)
  expect(Math.abs(Math.cos(follow.yaw()) - Math.cos(behind))).toBeLessThan(0.01)
  // a drag at the wheel still turns it, and holds it for another 1.5 s
  follow.turn(Math.PI / 2, 0)
  for (let i = 0; i < 30; i++) follow.update({ x: 0, y: 0, z: 0 }, 1 / 30, behind)
  expect(follow.yaw()).toBeCloseTo(-Math.PI / 2)
  // on foot (no heading to come round to) it never recentres
  const walking = settled(Math.PI / 2).follow
  for (let i = 0; i < 300; i++) walking.update({ x: 0, y: 0, z: 0 }, 1 / 30)
  expect(walking.yaw()).toBeCloseTo(Math.PI / 2)
})

it('at the wheel, a look held still (a thumb resting on the street) keeps the view; the 1.5 s count starts when it lifts', () => {
  const { follow } = settled(Math.PI / 2)
  const behind = Math.PI
  for (let i = 0; i < 90; i++) {
    follow.turn(0, 0, true) // held, not moving
    follow.update({ x: 0, y: 0, z: 0 }, 1 / 30, behind)
  }
  expect(follow.yaw()).toBeCloseTo(Math.PI / 2) // 3 s held: not recentred
  for (let i = 0; i < 30; i++) follow.update({ x: 0, y: 0, z: 0 }, 1 / 30, behind) // 1 s after lifting
  expect(follow.yaw()).toBeCloseTo(Math.PI / 2)
  for (let i = 0; i < 150; i++) follow.update({ x: 0, y: 0, z: 0 }, 1 / 30, behind)
  expect(Math.abs(Math.cos(follow.yaw()) - Math.cos(behind))).toBeLessThan(0.01)
})

describe('zoom', () => {
  const DIST = Math.hypot(7, 4.5)
  const away = (cam: THREE.PerspectiveCamera) => cam.position.length() // from the player at the origin
  /** Where the view crosses head height (1.6 m), on the ground plan. */
  const aim = (cam: THREE.PerspectiveCamera) => {
    const f = forward(cam)
    const s = (1.6 - cam.position.y) / f.y
    return { x: cam.position.x + f.x * s, z: cam.position.z + f.z * s }
  }
  function zoomed(
    factor: number,
    occluders: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [],
  ) {
    const cam = new THREE.PerspectiveCamera()
    const follow = createFollowCamera(cam, occluders, { reducedMotion: true })
    follow.zoomBy(factor)
    follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
    return { cam, follow }
  }

  it("starts at today's distance, and is clamped between 0.6x and 1.6x of it", () => {
    expect(zoomed(1).follow.zoom()).toBe(1)
    expect(away(zoomed(1).cam)).toBeCloseTo(DIST)
    const out = zoomed(100)
    expect(out.follow.zoom()).toBeCloseTo(1.6)
    expect(away(out.cam)).toBeCloseTo(1.6 * DIST)
    const near = zoomed(0.001)
    expect(near.follow.zoom()).toBeCloseTo(0.6)
    expect(away(near.cam)).toBeCloseTo(0.6 * DIST)
    // and a zoom back the other way leaves the limit at once (no wind-up past it)
    out.follow.zoomBy(0.9)
    out.follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
    expect(out.follow.zoom()).toBeCloseTo(1.44)
  })

  it('keeps its angle above the ground, and still aims through head height 5 m beyond the player', () => {
    for (const f of [0.6, 1.6]) {
      const { cam } = zoomed(f)
      expect(cam.position.y / cam.position.z).toBeCloseTo(4.5 / 7)
      expect(aim(cam).x).toBeCloseTo(0)
      expect(aim(cam).z).toBeCloseTo(-5)
    }
  })

  it('never comes down under 2 m above the player, at any zoom and pitch: never in the avatar or the props', () => {
    for (const z of [0.6, 0.8, 1, 1.6])
      for (const p of [-10, -0.2, 0, 0.15, 10]) {
        const cam = new THREE.PerspectiveCamera()
        const follow = createFollowCamera(cam, [], { reducedMotion: true })
        follow.zoomBy(z)
        follow.turn(0, p)
        follow.update({ x: 0, y: 0.35, z: 0 }, 1 / 30) // seated at the wheel, a little up
        expect(cam.position.y, `zoom ${z}, pitch ${p}`).toBeGreaterThanOrEqual(0.35 + 2 - 1e-9)
      }
  })

  it('zoomed out, a wall behind still pulls the camera in front of it', () => {
    const { cam } = zoomed(1.6, [{ minX: -10, maxX: 10, minZ: 3, maxZ: 15 }])
    expect(cam.position.z).toBeLessThan(3)
    expect(cam.position.z).toBeGreaterThan(0)
  })

  it('eases into a zoom, unless reduced motion asks for none', () => {
    const cam = new THREE.PerspectiveCamera()
    const follow = createFollowCamera(cam, [], { reducedMotion: false })
    follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
    follow.zoomBy(1.5)
    follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
    expect(follow.zoom()).toBeGreaterThan(1.1)
    expect(follow.zoom()).toBeLessThan(1.5)
    for (let i = 0; i < 30; i++) follow.update({ x: 0, y: 0, z: 0 }, 1 / 30)
    expect(follow.zoom()).toBeCloseTo(1.5, 3)
  })
})
