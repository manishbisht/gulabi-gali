import * as THREE from 'three'
import { moveWithCollision } from '../world/collision'
import type { AABB, AvatarLook, Vec2 } from '../world/types'
import { buildAvatar } from './avatar'
import type { Controls } from './controls'
import { createFollowCamera } from './camera'

export const WALK_SPEED = 4
export const PLAYER_RADIUS = 0.4

interface Options {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: Controls
  look: AvatarLook
  /** Read every frame, so the world can add and drop colliders as districts stream in. */
  colliders: AABB[]
  /** Tall things (buildings, landmarks) the chase camera must not end up inside. */
  occluders?: AABB[]
}

/** Owns the avatar and the chase camera: input, then collision, then avatar and camera. */
export function createPlayer({ scene, camera, controls, look, colliders, occluders }: Options) {
  let avatar = buildAvatar(look)
  scene.add(avatar)
  const follow = createFollowCamera(camera, occluders)
  const fwd = new THREE.Vector3()
  let pos: Vec2 = { x: 0, z: 0 }

  function sync(dt: number) {
    avatar.position.set(pos.x, 0, pos.z)
    follow.update(avatar.position, dt)
  }
  sync(0)

  return {
    position: (): Vec2 => ({ ...pos }),
    /** Which way the avatar faces, in radians about y (0 faces +z). */
    heading: (): number => avatar.rotation.y,
    /** Stands the player at (x, z), facing `ry` if given. */
    teleport(x: number, z: number, ry?: number) {
      pos = { x, z }
      if (ry !== undefined) avatar.rotation.y = ry
      sync(1) // dt of 1 s: the camera is effectively there too
    },
    /** Swaps the body for another look, standing where the old one did. */
    setLook(next: AvatarLook) {
      const old = avatar
      avatar = buildAvatar(next)
      avatar.position.copy(old.position)
      avatar.rotation.copy(old.rotation)
      scene.remove(old) // shared geometry and material: nothing to dispose
      scene.add(avatar)
    },
    update(dt: number) {
      const input = controls.move()
      if (input.x !== 0 || input.z !== 0) {
        // Input is relative to the screen: rotate it by where the camera is looking on the ground.
        camera.getWorldDirection(fwd)
        const flen = Math.hypot(fwd.x, fwd.z) || 1
        const fx = fwd.x / flen
        const fz = fwd.z / flen
        const dx = fx * input.z - fz * input.x
        const dz = fz * input.z + fx * input.x
        const step = { x: dx * WALK_SPEED * dt, z: dz * WALK_SPEED * dt }
        pos = moveWithCollision(pos, step, colliders, PLAYER_RADIUS)
        avatar.rotation.y = Math.atan2(dx, dz)
      }
      sync(dt)
    },
    dispose() {
      scene.remove(avatar) // its geometry and material are shared with every other avatar
    },
  }
}
