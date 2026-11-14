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
