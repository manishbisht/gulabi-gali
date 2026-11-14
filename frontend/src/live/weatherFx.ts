import * as THREE from 'three'
import type { Stage } from '../engine/stage'
import type { SkyParams } from './sky'

/** Streaks / motes at full quality; tier 0 draws half. */
const RAIN_COUNT = 900
const MOTE_COUNT = 160
/** The box of weather that follows the camera, in metres. */
const SPAN = 28
const HEIGHT = 18
const FALL = 22
/** About how high the chase camera sits above the street. */
const EYE = 5
const DRIFT = 1.6
const MOTE_TOP = 7

const MATRIX_STRIDE = 16

const rand = (n: number) => Math.random() * n

export interface WeatherFx {
  set(p: SkyParams): void
  update(dt: number): void
  dispose(): void
}

/**
 * Rain as instanced streaks and dust as drifting motes, in a box that rides along with the camera.
 * Nothing allocates per frame: positions live in typed arrays and are written straight into the
 * instance matrices.
 */
export function createWeatherFx(stage: Stage): WeatherFx {
  const group = new THREE.Group()
  group.name = 'weather-fx'
  group.visible = false
  stage.scene.add(group)

  const streakMaterial = new THREE.MeshBasicMaterial({
    color: '#D8E6F0',
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    fog: false,
  })
  const rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.9, 0.02), streakMaterial, RAIN_COUNT)
  rain.frustumCulled = false
  rain.visible = false
  rain.name = 'rain'
  const rainPos = new Float32Array(RAIN_COUNT * 3)
  const rainSpeed = new Float32Array(RAIN_COUNT)
  const matrices = rain.instanceMatrix.array as Float32Array
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainPos[i * 3] = rand(SPAN) - SPAN / 2
    rainPos[i * 3 + 1] = rand(HEIGHT)
    rainPos[i * 3 + 2] = rand(SPAN) - SPAN / 2
    rainSpeed[i] = FALL * (0.8 + rand(0.4))
    matrices[i * MATRIX_STRIDE] = matrices[i * MATRIX_STRIDE + 5] = matrices[i * MATRIX_STRIDE + 10] = 1
    matrices[i * MATRIX_STRIDE + 15] = 1
  }
  group.add(rain)

  const motePos = new Float32Array(MOTE_COUNT * 3)
  for (let i = 0; i < MOTE_COUNT; i++) {
    motePos[i * 3] = rand(SPAN) - SPAN / 2
    motePos[i * 3 + 1] = rand(MOTE_TOP) - EYE + 1
    motePos[i * 3 + 2] = rand(SPAN) - SPAN / 2
  }
  const moteGeometry = new THREE.BufferGeometry()
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePos, 3))
  const motes = new THREE.Points(
    moteGeometry,
    new THREE.PointsMaterial({
      color: '#D9B98C',
      size: 0.18,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    }),
  )
  motes.frustumCulled = false
  motes.visible = false
  motes.name = 'dust-motes'
  group.add(motes)

  let raining = false
  let dusty = false
  let time = 0

  return {
    set(p) {
      raining = p.rain
      dusty = p.dust
      rain.visible = raining
      motes.visible = dusty
      group.visible = raining || dusty
    },
    update(dt) {
      if (!group.visible) return
      const half = stage.quality === 0
      group.position.copy(stage.camera.position)
      time += dt
      if (raining) {
        const n = half ? RAIN_COUNT >> 1 : RAIN_COUNT
        rain.count = n
        for (let i = 0; i < n; i++) {
          let y = rainPos[i * 3 + 1]! - rainSpeed[i]! * dt
          if (y < 0) y += HEIGHT
          rainPos[i * 3 + 1] = y
          const o = i * MATRIX_STRIDE
          matrices[o + 12] = rainPos[i * 3]!
          matrices[o + 13] = y - EYE // the box reaches from the ground (the camera is about EYE above it) upward
          matrices[o + 14] = rainPos[i * 3 + 2]!
        }
        rain.instanceMatrix.needsUpdate = true
      }
      if (dusty) {
        const n = half ? MOTE_COUNT >> 1 : MOTE_COUNT
        moteGeometry.setDrawRange(0, n)
        for (let i = 0; i < n; i++) {
          let x = motePos[i * 3]! + DRIFT * dt
          if (x > SPAN / 2) x -= SPAN
          motePos[i * 3] = x
          const y = motePos[i * 3 + 1]! + Math.sin(time + i) * 0.6 * dt
          motePos[i * 3 + 1] = Math.min(Math.max(y, 1 - EYE), MOTE_TOP - EYE + 1)
        }
        moteGeometry.attributes.position!.needsUpdate = true
      }
    },
    dispose() {
      group.removeFromParent()
      rain.dispose()
      rain.geometry.dispose()
      streakMaterial.dispose()
      moteGeometry.dispose()
      ;(motes.material as THREE.Material).dispose()
    },
  }
}
