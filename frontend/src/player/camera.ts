import * as THREE from 'three'

export interface Vec3Like {
  x: number
  y: number
  z: number
}

const BACK = 7
const UP = 4.5
const LOOK_AT_HEIGHT = 1.2
/** Higher is snappier; the camera closes about 1 - e^-6 of the gap each second. */
const STIFFNESS = 6

/** Fixed-yaw chase camera behind (+z) and above the player. No orbit: touch only has the joystick. */
export function createFollowCamera(camera: THREE.PerspectiveCamera) {
  const goal = new THREE.Vector3()
  const look = new THREE.Vector3()
  let placed = false
  return {
    update(target: Vec3Like, dt: number) {
      goal.set(target.x, target.y + UP, target.z + BACK)
      if (placed) camera.position.lerp(goal, 1 - Math.exp(-STIFFNESS * dt))
      else camera.position.copy(goal)
      placed = true
      // Aim from the camera's own x so lag never yaws the view; it only slides sideways.
      camera.lookAt(look.set(camera.position.x, target.y + LOOK_AT_HEIGHT, target.z))
    },
  }
}
