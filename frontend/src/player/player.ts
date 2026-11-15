import * as THREE from 'three'
import { moveWithCollision } from '../world/collision'
import type { AABB, AvatarLook, Vec2 } from '../world/types'
import { JOG_SPEED } from '../net/protocol'
import { buildAutoGeometry } from '../world/props'
import { buildAvatar } from './avatar'
import type { Controls } from './controls'
import { createFollowCamera } from './camera'
import { AUTO_RADIUS, createVehicle } from './vehicle'

export const WALK_SPEED = 4
/** Shift held, or the stick at its rim: 1.8x the walk, a figure the server shares (net/protocol). */
export { JOG_SPEED }
export const PLAYER_RADIUS = 0.4
/** The driver sits this far up in the auto's seat. */
const SEAT_Y = 0.35

/** Up on a roof (see world/rooftop.ts): how high, the walls that hold the player in, and the building underfoot. */
export interface Floor {
  y: number
  walls: AABB[]
  under?: AABB
}
const sameBox = (a: AABB, b: AABB) =>
  a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ

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

/** Owns the avatar and the chase camera: input (the view's turn first), then collision, then avatar and camera. */
export function createPlayer({ scene, camera, controls, look, colliders, occluders }: Options) {
  let avatar = buildAvatar(look)
  scene.add(avatar)
  /** Up on a roof (see world/rooftop.ts): the body stands at `y`, and only `walls` hold it in. */
  let floor: Floor | null = null
  /** What the camera keeps out of: on a roof, all but the building underfoot (its footprint holds the player). */
  const seen = [...(occluders ?? [])]
  const follow = createFollowCamera(camera, seen)
  const fwd = new THREE.Vector3()
  let pos: Vec2 = { x: 0, z: 0 }
  // driving: the vehicle holds the speed and the heading; this file holds the body, and the collisions
  const vehicle = createVehicle('auto')
  let driving = false
  /** The last frame moved the player on foot at a jog: its moves claim the jog's allowance from the server. */
  let jogged = false
  /** The auto under the driver, made on the first mount and kept for the player's life. */
  let ride: THREE.Mesh | null = null

  /**
   * `frame`: a real frame, not a snap (teleport, mount, dismount pass dt 1 s to put the camera there at once).
   * Only frames bring the view round behind the auto, so getting in never whips it round in one step.
   */
  function sync(dt: number, frame = false) {
    avatar.position.set(pos.x, driving ? SEAT_Y : (floor?.y ?? 0), pos.z)
    if (driving && ride) {
      ride.position.set(pos.x, 0, pos.z)
      ride.rotation.y = vehicle.heading
    }
    // at the wheel the view comes back round behind the auto (it faces `heading`) when left alone
    follow.update(avatar.position, dt, driving && frame ? vehicle.heading + Math.PI : undefined)
  }
  sync(0)

  return {
    position: (): Vec2 => ({ ...pos }),
    /** Which way the avatar faces, in radians about y (0 faces +z). */
    heading: (): number => avatar.rotation.y,
    /**
     * Where the camera looks: yaw (0 along -z, positive turned left) and pitch (positive up), in radians, and
     * its zoom (its distance as a multiple of the usual one).
     */
    view: () => ({ yaw: follow.yaw(), pitch: follow.pitch(), zoom: follow.zoom() }),
    /** Stands the player at (x, z), facing `ry` if given. */
    teleport(x: number, z: number, ry?: number) {
      pos = { x, z }
      if (ry !== undefined) avatar.rotation.y = ry
      // a correction from the server stops a driven auto where it is put
      if (driving) vehicle.reset(x, z, avatar.rotation.y)
      sync(1) // dt of 1 s: the camera is effectively there too
    },
    driving: (): boolean => driving,
    /** The last frame moved the player at a jog (on foot, never at the wheel). */
    jogging: (): boolean => jogged,
    /**
     * Up on a roof: the body stands at `floor.y` and walks only within `floor.walls` (the street's colliders do
     * not hold it up there), and the camera keeps out of every building but `floor.under`, the one it stands on
     * (its footprint holds the player). Null: back on the street. `teleport` places it.
     */
    setFloor(next: Floor | null) {
      floor = next
      seen.length = 0
      for (const o of occluders ?? []) if (!next?.under || !sameBox(o, next.under)) seen.push(o)
      sync(1)
    },
    /** How high the player's feet are: a roof's height up there, else 0. */
    elevation: (): number => floor?.y ?? 0,
    /** Gets into an auto standing at (x, z) and facing `ry`. */
    mount(x: number, z: number, ry: number) {
      if (driving) return
      driving = true
      pos = { x, z }
      vehicle.reset(x, z, ry)
      avatar.rotation.y = vehicle.heading
      if (!ride) {
        ride = new THREE.Mesh(buildAutoGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }))
        ride.castShadow = true
      }
      scene.add(ride)
      sync(1)
    },
    /** Where the auto stands now, for leaving it there. */
    ridePose: () => ({ x: vehicle.x, z: vehicle.z, ry: vehicle.heading }),
    /** Somewhere clear to step out, or null when boxed in (see `Vehicle.exitPoint`). */
    exitPoint: (): Vec2 | null => (driving ? vehicle.exitPoint(colliders, PLAYER_RADIUS) : null),
    /** Steps out at `to`, on foot again, facing the way the auto did. */
    dismount(to: Vec2) {
      if (!driving) return
      driving = false
      ride?.removeFromParent()
      pos = { x: to.x, z: to.z }
      sync(1)
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
      const turn = controls.look(dt)
      follow.turn(turn.yaw, turn.pitch, turn.held)
      follow.zoomBy(controls.zoom())
      jogged = false
      if (driving) {
        // the stick is the wheel and the pedal here, not a direction on the street
        const want = vehicle.update(controls.drive(), dt)
        moveWithCollision(pos, want, colliders, AUTO_RADIUS, pos)
        vehicle.commit(pos.x, pos.z)
        avatar.rotation.y = vehicle.heading
      } else {
        const input = controls.move()
        if (input.x === 0 && input.z === 0) return sync(dt, true)
        // Input is relative to the screen: rotate it by where the camera is looking on the ground.
        camera.getWorldDirection(fwd)
        const flen = Math.hypot(fwd.x, fwd.z) || 1
        const fx = fwd.x / flen
        const fz = fwd.z / flen
        const dx = fx * input.z - fz * input.x
        const dz = fz * input.z + fx * input.x
        // jogging is on foot only: at the wheel the auto keeps its own pace
        jogged = controls.jog()
        const speed = jogged ? JOG_SPEED : WALK_SPEED
        const step = { x: dx * speed * dt, z: dz * speed * dt }
        pos = moveWithCollision(pos, step, floor ? floor.walls : colliders, PLAYER_RADIUS)
        avatar.rotation.y = Math.atan2(dx, dz)
      }
      sync(dt, true)
    },
    dispose() {
      if (ride) {
        ride.removeFromParent()
        ride.geometry.dispose()
        ;(ride.material as THREE.Material).dispose()
        ride = null
      }
      scene.remove(avatar) // its geometry and material are shared with every other avatar
    },
  }
}
