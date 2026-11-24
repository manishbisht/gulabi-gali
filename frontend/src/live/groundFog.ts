import * as THREE from 'three'
import type { Stage } from '../engine/stage'
import type { SkyParams } from './sky'

/** How many low banks of mist lie around the viewer: a handful, each one sprite (one draw). */
export const FOG_BANKS = 6
/** Their distances from the camera, in metres: always past the player, who stands about 8 m ahead of it. */
const NEAR = 13
const FAR = 24
/** One bank's size (wide and low) and the height of its middle: its lower part sinks into the street. */
const BANK_W = 22
const BANK_H = 5
const BANK_Y = 1.3
/** The banks' opacity at the thickest fog: a veil, never a wall. */
export const MAX_OPACITY = 0.32
/** How fast the ring of banks turns around the viewer, in radians a second: a slow drift. */
const DRIFT = 0.015
/** Below this ground fog the banks are not drawn at all. */
const SHOW_FROM = 0.02
const TEX = 64

/** A soft white disc fading to nothing at its rim, made here (no download): the one texture every bank shares. */
export function fogTexture(): THREE.DataTexture {
  const data = new Uint8Array(TEX * TEX * 4)
  for (let y = 0; y < TEX; y++)
    for (let x = 0; x < TEX; x++) {
      const u = ((x + 0.5) / TEX) * 2 - 1
      const v = ((y + 0.5) / TEX) * 2 - 1
      const k = Math.max(0, 1 - (u * u + v * v))
      const o = (y * TEX + x) * 4
      data[o] = data[o + 1] = data[o + 2] = 255
      data[o + 3] = Math.round(255 * k * k)
    }
  const texture = new THREE.DataTexture(data, TEX, TEX)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

export interface GroundFog {
  set(p: SkyParams): void
  update(dt: number): void
  dispose(): void
}

/**
 * A winter morning's ground fog, over the scene fog the sky already thickened: a few large soft banks of mist
 * low on the street in a ring around the camera, turning slowly (still, under `prefers-reduced-motion`). Not
 * drawn on the lowest quality tier, where the scene fog alone carries the morning. Nothing allocates per frame.
 */
export function createGroundFog(stage: Stage, opts: { reducedMotion?: () => boolean } = {}): GroundFog {
  const query =
    typeof matchMedia === 'function' && !opts.reducedMotion
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
  const still = opts.reducedMotion ?? (() => query?.matches ?? false)

  const group = new THREE.Group()
  group.name = 'ground-fog'
  group.visible = false
  stage.scene.add(group)
  const texture = fogTexture()
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const angle = new Float32Array(FOG_BANKS)
  const radius = new Float32Array(FOG_BANKS)
  const banks: THREE.Sprite[] = []
  for (let i = 0; i < FOG_BANKS; i++) {
    angle[i] = (i / FOG_BANKS) * Math.PI * 2 + 0.4 * Math.sin(i * 2.3)
    radius[i] = NEAR + ((FAR - NEAR) * ((i * 5) % FOG_BANKS)) / (FOG_BANKS - 1) // near and far, mixed round the ring
    const bank = new THREE.Sprite(material)
    bank.scale.set(BANK_W, BANK_H, 1)
    bank.position.set(Math.cos(angle[i]!) * radius[i]!, BANK_Y, Math.sin(angle[i]!) * radius[i]!)
    banks.push(bank)
    group.add(bank)
  }

  let level = 0
  return {
    set(p) {
      level = p.groundFog
      material.opacity = MAX_OPACITY * level
      // the mist takes the colour of the morning's horizon, as the scene fog does
      material.color.set(p.skyHorizon)
    },
    update(dt) {
      group.visible = level >= SHOW_FROM && stage.quality > 0
      if (!group.visible) return
      group.position.set(stage.camera.position.x, 0, stage.camera.position.z)
      if (still()) return
      for (let i = 0; i < FOG_BANKS; i++) {
        const a = (angle[i] = (angle[i]! + DRIFT * dt) % (Math.PI * 2))
        banks[i]!.position.set(Math.cos(a) * radius[i]!, BANK_Y, Math.sin(a) * radius[i]!)
      }
    },
    dispose() {
      group.removeFromParent()
      material.dispose()
      texture.dispose()
    },
  }
}
