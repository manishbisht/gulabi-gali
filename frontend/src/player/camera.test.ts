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
