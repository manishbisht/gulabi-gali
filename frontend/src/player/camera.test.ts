import * as THREE from 'three'
import { expect, it } from 'vitest'
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
