import * as THREE from 'three'
import type { Stage } from '../engine/stage'
import { KITE_COLOURS, kiteGeometry } from '../live/festivalFx'
import { PALETTE } from '../world/palette'
import type { Vec2 } from '../world/types'
import { X_RANGE, Y_MAX, type PatangState } from './patang'

/** The camera stands behind and a little above the player's head, looking this far up (radians). */
const PITCH = THREE.MathUtils.degToRad(42)
const EYE_Y = 2.4
const EYE_BACK = 1.8
/** The sky plane hangs this far in front of the camera, square on to it, so the kites fill any screen. */
const DEPTH = 14

export interface PatangView {
  /** Looks up from where the player stands, and draws the kites and strings of this moment. */
  update(state: PatangState, at: Vec2): void
  dispose(): void
}

/**
 * The drawing of a kite fight: the festival's kite mesh and material look, on a plane that rides with the
 * camera. The world keeps rendering behind it (the kites draw over rooftops). Allocates nothing per frame.
 */
export function createPatangView(stage: Stage, rivals: number): PatangView {
  const { camera } = stage
  const kiteCount = rivals + 1
  const group = new THREE.Group()
  group.name = 'patang'
  const geometry = kiteGeometry()
  const material = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    fog: false,
    color: '#ffffff',
    depthTest: false,
  })
  const kites = new THREE.InstancedMesh(geometry, material, kiteCount)
  kites.frustumCulled = false
  kites.renderOrder = 1000
  const colour = new THREE.Color()
  // the player's kite is the marigold one, and no rival wears that colour
  const others = KITE_COLOURS.filter((c) => c !== PALETTE.marigold)
  kites.setColorAt(0, colour.set(PALETTE.marigold))
  for (let i = 1; i < kiteCount; i++) kites.setColorAt(i, colour.set(others[i % others.length]!))

  const lineGeometry = (segments: number) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 6), 3))
    return g
  }
  const rivalLines = lineGeometry(Math.max(rivals, 1))
  const playerLine = lineGeometry(1)
  const rivalLineMaterial = new THREE.LineBasicMaterial({
    color: '#F6EFE4',
    transparent: true,
    opacity: 0.7,
    fog: false,
    depthTest: false,
  })
  const playerLineMaterial = new THREE.LineBasicMaterial({
    color: PALETTE.marigold,
    fog: false,
    depthTest: false,
  })
  const rivalStrings = new THREE.LineSegments(rivalLines, rivalLineMaterial)
  const playerString = new THREE.LineSegments(playerLine, playerLineMaterial)
  for (const l of [rivalStrings, playerString]) {
    l.frustumCulled = false
    l.renderOrder = 999
  }
  group.add(rivalStrings, playerString, kites)
  stage.scene.add(group)

  const dummy = new THREE.Object3D()
  const forward = new THREE.Vector3()
  const target = new THREE.Vector3()
  const rp = rivalLines.attributes.position!.array as Float32Array
  const pp = playerLine.attributes.position!.array as Float32Array

  return {
    update(state, at) {
      camera.position.set(at.x, EYE_Y, at.z + EYE_BACK)
      target.set(at.x, EYE_Y + Math.sin(PITCH) * 10, at.z + EYE_BACK - Math.cos(PITCH) * 10)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      camera.getWorldDirection(forward)
      group.position.copy(camera.position).addScaledVector(forward, DEPTH)
      group.quaternion.copy(camera.quaternion)
      const halfH = DEPTH * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      const halfW = halfH * camera.aspect
      const lx = (x: number) => (x / X_RANGE) * halfW * 0.9
      const ly = (y: number) => ((y / Y_MAX) * 2 - 1) * halfH
      const size = halfH * 0.1

      const place = (i: number, k: PatangState['player'], o: Float32Array, at6: number) => {
        dummy.position.set(lx(k.x), ly(k.y), 0)
        dummy.rotation.set(0, 0, k.tilt)
        dummy.scale.setScalar(i === 0 ? size * 1.15 : size)
        dummy.updateMatrix()
        kites.setMatrixAt(i, dummy.matrix)
        o[at6] = lx(k.anchorX)
        o[at6 + 1] = ly(0)
        o[at6 + 2] = 0
        o[at6 + 3] = lx(k.x)
        o[at6 + 4] = ly(k.y) - size * 0.5
        o[at6 + 5] = 0
        // a cut string goes slack: it is no line from the ground any more
        if (!k.alive) {
          o[at6 + 3] = o[at6]!
          o[at6 + 4] = o[at6 + 1]!
        }
      }
      place(0, state.player, pp, 0)
      for (let i = 0; i < rivals; i++) place(i + 1, state.rivals[i]!, rp, i * 6)
      kites.instanceMatrix.needsUpdate = true
      rivalLines.attributes.position!.needsUpdate = true
      playerLine.attributes.position!.needsUpdate = true
    },
    dispose() {
      group.removeFromParent()
      kites.dispose()
      geometry.dispose()
      material.dispose()
      rivalLines.dispose()
      playerLine.dispose()
      rivalLineMaterial.dispose()
      playerLineMaterial.dispose()
    },
  }
}
