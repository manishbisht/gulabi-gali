import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createControls } from './controls'
import { createPlayer, JOG_SPEED, WALK_SPEED } from './player'

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

it('after the view turns 90° left, forward walks along the new forward (west), not north', () => {
  const { controls, player } = drivable()
  player.teleport(0, 0)
  controls.addLook(Math.PI / 2, 0)
  for (let i = 0; i < 30; i++) player.update(1 / 30) // the turn eases in
  expect(player.view().yaw).toBeCloseTo(Math.PI / 2, 2)
  controls.setJoystick({ x: 0, z: 1 })
  for (let i = 0; i < 30; i++) player.update(1 / 30)
  const at = player.position()
  expect(at.x).toBeLessThan(-3) // a second at 4 m/s, westward
  expect(Math.abs(at.z)).toBeLessThan(0.1)
  // the avatar faces where it walks: west is -π/2 about y
  expect(Math.cos(player.heading())).toBeCloseTo(0)
  expect(Math.sin(player.heading())).toBeCloseTo(-1)
  player.dispose()
  controls.dispose()
})

it('at the wheel the view comes round behind the auto when left alone', () => {
  const { controls, player } = drivable()
  player.mount(0, 0, Math.PI / 2) // nose to +x
  for (let i = 0; i < 120; i++) player.update(1 / 30)
  // behind an auto heading +x the camera looks +x: yaw -π/2
  expect(Math.sin(player.view().yaw)).toBeCloseTo(-1, 2)
  player.dispose()
  controls.dispose()
})

it('at the wheel a thumb resting on the street holds the view where it was turned', () => {
  const { controls, player } = drivable()
  player.mount(0, 0, Math.PI / 2) // nose to +x: behind it is yaw -π/2
  controls.addLook(Math.PI / 2, 0) // from yaw 0 (mounting never swings it) to +π/2: the auto's other side
  controls.holdLook(true)
  for (let i = 0; i < 120; i++) player.update(1 / 30) // 4 s held still
  expect(Math.sin(player.view().yaw)).toBeCloseTo(1, 2) // still looking the other way (+π/2)
  controls.holdLook(false)
  for (let i = 0; i < 180; i++) player.update(1 / 30)
  expect(Math.sin(player.view().yaw)).toBeCloseTo(-1, 2)
  player.dispose()
  controls.dispose()
})

describe('jogging', () => {
  /** A player on open ground with keys of its own, and how far it gets in one second of 1/30 s frames. */
  function open() {
    const keys = new EventTarget() as unknown as Window
    const press = (code: string, type: 'keydown' | 'keyup' = 'keydown') =>
      keys.dispatchEvent(Object.assign(new Event(type), { code }))
    const scene = new THREE.Scene()
    const controls = createControls(keys)
    const player = createPlayer({
      scene,
      camera: new THREE.PerspectiveCamera(),
      controls,
      look: { skin: 0, outfit: 'pink', head: 'none' },
      colliders: [],
    })
    const second = () => {
      player.teleport(0, 0)
      for (let i = 0; i < 30; i++) player.update(1 / 30)
      return Math.hypot(player.position().x, player.position().z)
    }
    return { controls, player, press, second }
  }

  it('Shift held jogs at 1.8x walking pace (7.2 m/s); let go, it walks again', () => {
    const { controls, player, press, second } = open()
    expect(JOG_SPEED).toBeCloseTo(1.8 * WALK_SPEED)
    press('KeyW')
    expect(second()).toBeCloseTo(WALK_SPEED)
    press('ShiftLeft')
    expect(second()).toBeCloseTo(JOG_SPEED)
    press('ShiftLeft', 'keyup')
    expect(second()).toBeCloseTo(WALK_SPEED)
    player.dispose()
    controls.dispose()
  })

  it('the stick pushed past 90% of its reach jogs; short of it, it walks at the push', () => {
    const { controls, player, second } = open()
    controls.setJoystick({ x: 0, z: 1 })
    expect(second()).toBeCloseTo(JOG_SPEED)
    controls.setJoystick({ x: 0.66, z: 0.66 }) // a diagonal at 93%
    expect(second()).toBeCloseTo(0.66 * Math.SQRT2 * JOG_SPEED)
    controls.setJoystick({ x: 0, z: 0 }) // let go, then most of the way: a walk
    controls.setJoystick({ x: 0, z: 0.85 })
    expect(second()).toBeCloseTo(0.85 * WALK_SPEED)
    player.dispose()
    controls.dispose()
  })

  it('at the wheel Shift does nothing: the auto keeps its own pace', () => {
    const drove = (shift: boolean) => {
      const { controls, player, press } = open()
      player.mount(0, 0, 0)
      press('KeyW')
      if (shift) press('ShiftLeft')
      for (let i = 0; i < 60; i++) player.update(1 / 30)
      const z = player.position().z
      expect(player.jogging()).toBe(false)
      player.dispose()
      controls.dispose()
      return z
    }
    expect(drove(true)).toBeCloseTo(drove(false))
  })

  it('says it is jogging (for the server) only while a frame moved it at a jog', () => {
    const { controls, player, press } = open()
    expect(player.jogging()).toBe(false)
    press('ShiftLeft') // Shift alone, standing: not a jog
    player.update(1 / 30)
    expect(player.jogging()).toBe(false)
    press('KeyW')
    player.update(1 / 30)
    expect(player.jogging()).toBe(true)
    press('ShiftLeft', 'keyup')
    player.update(1 / 30)
    expect(player.jogging()).toBe(false)
    player.dispose()
    controls.dispose()
  })
})

it('a pinch or wheel zooms the camera, read once a frame, and a new player (a new district) starts unzoomed', () => {
  const { controls, player } = drivable()
  expect(player.view().zoom).toBe(1)
  controls.addZoom(1.4)
  for (let i = 0; i < 60; i++) player.update(1 / 30)
  expect(player.view().zoom).toBeCloseTo(1.4, 3)
  controls.addZoom(100)
  for (let i = 0; i < 60; i++) player.update(1 / 30)
  expect(player.view().zoom).toBeCloseTo(1.6, 3)
  player.dispose()
  controls.dispose()
  const fresh = drivable()
  expect(fresh.player.view().zoom).toBe(1)
  fresh.player.dispose()
  fresh.controls.dispose()
})
