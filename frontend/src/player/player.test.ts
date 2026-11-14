import * as THREE from 'three'
import { expect, it } from 'vitest'
import { createControls } from './controls'
import { createPlayer } from './player'

it('setLook swaps the avatar in place, leaving exactly one body in the scene', () => {
  const scene = new THREE.Scene()
  const controls = createControls(new EventTarget() as unknown as Window)
  const player = createPlayer({
    scene,
    camera: new THREE.PerspectiveCamera(),
    controls,
    look: { skin: 0, outfit: 'pink', head: 'none' },
    colliders: [],
  })
  player.teleport(3, 4)
  const before = scene.children[0] as THREE.Mesh
  player.setLook({ skin: 4, outfit: 'teal', head: 'safa' })
  expect(scene.children).toHaveLength(1)
  const after = scene.children[0] as THREE.Mesh
  expect(after).not.toBe(before)
  expect(after.geometry).not.toBe(before.geometry)
  expect(after.position.x).toBe(3)
  expect(after.position.z).toBe(4)
  player.dispose()
  expect(scene.children).toHaveLength(0)
  controls.dispose()
})

function drivable(colliders: { minX: number; maxX: number; minZ: number; maxZ: number }[] = []) {
  const scene = new THREE.Scene()
  const controls = createControls(new EventTarget() as unknown as Window)
  const player = createPlayer({
    scene,
    camera: new THREE.PerspectiveCamera(),
    controls,
    look: { skin: 0, outfit: 'pink', head: 'none' },
    colliders,
  })
  return { scene, controls, player }
}

it('mounting puts an auto under the driver, and dismounting takes it away and sets them down', () => {
  const { scene, controls, player } = drivable()
  player.teleport(5, 5)
  expect(scene.children).toHaveLength(1)
  player.mount(5, 5, 0)
  expect(player.driving()).toBe(true)
  expect(scene.children).toHaveLength(2) // the avatar and the auto
  const avatar = scene.children[0]!
  expect(avatar.position.y).toBeGreaterThan(0) // seated
  player.dismount({ x: 8, z: 5 })
  expect(player.driving()).toBe(false)
  expect(scene.children).toHaveLength(1)
  expect(player.position()).toEqual({ x: 8, z: 5 })
  expect(avatar.position.y).toBe(0)
  player.dispose()
  controls.dispose()
})

it('at the wheel the stick drives: forward goes where the auto faces, and a wall stops it', () => {
  const wall = { minX: -10, maxX: 10, minZ: 30, maxZ: 32 }
  const { controls, player } = drivable([wall])
  player.teleport(0, 0)
  player.mount(0, 0, 0) // facing +z
  controls.setJoystick({ x: 0, z: 1 })
  for (let i = 0; i < 90; i++) player.update(1 / 60)
  const at = player.position()
  expect(at.z).toBeGreaterThan(8) // well over walking pace (4 m/s) in 1.5 s
  expect(Math.abs(at.x)).toBeLessThan(1e-9)
  for (let i = 0; i < 300; i++) player.update(1 / 60)
  // stopped a driving radius short of the wall, and never through it
  expect(player.position().z).toBeCloseTo(30 - 1.2, 1)
  player.dispose()
  controls.dispose()
})

it('disposing while driving takes the auto away too', () => {
  const { scene, controls, player } = drivable()
  player.mount(0, 0, 0)
  player.dispose()
  expect(scene.children).toHaveLength(0)
  controls.dispose()
})

it('set down where a boxed-in auto stands, the walker leaves by the nearest face', () => {
  // a solid block with the auto inside it, nearer its east face
  const block = { minX: -6.5, maxX: 6.5, minZ: -6.5, maxZ: 6.5 }
  const { controls, player } = drivable([block])
  player.teleport(1, 0)
  player.mount(1, 0, 0)
  player.dismount({ x: 1, z: 0 }) // where it stands: no jump
  expect(player.position()).toEqual({ x: 1, z: 0 })
  controls.setJoystick({ x: 1, z: 0 }) // walks +x
  for (let i = 0; i < 240; i++) player.update(1 / 60)
  expect(player.position().x).toBeGreaterThan(block.maxX + 0.4 - 1e-6)
  player.dispose()
  controls.dispose()
})
