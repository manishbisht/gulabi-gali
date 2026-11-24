import * as THREE from 'three'
import type { Stage } from '../engine/stage'
import type { DistrictDef, Vec2 } from '../world/types'
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
/** The banks' opacity at the thickest fog: a veil, never a wall (see `WINTER_MAX` in winter.ts). */
export const MAX_OPACITY = 0.16
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
  /** `pos`: where the player stands; the banks lie low in the street, and are not drawn while they stand on a roof. */
  update(dt: number, pos?: Vec2): void
  dispose(): void
}

/** Whether (x, z) is the district's own ground: inside its square and not open water (Amer's lake). */
export function onDistrictGround(def: Pick<DistrictDef, 'size' | 'water'>, x: number, z: number): boolean {
  const half = def.size / 2
  if (Math.abs(x) > half || Math.abs(z) > half) return false
  const water = def.water
  if (!water) return true
  // a plain loop: this runs for every bank every frame, and must not allocate
  for (let i = 0; i < water.length; i++) {
    const w = water[i]!
    if (x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ) return false
  }
  return true
}

export interface GroundFogOptions {
  /** Defaults to the browser's `prefers-reduced-motion`. */
  reducedMotion?: () => boolean
  /** How high the ground the player stands on is (a roof's top, up there); 0, the street, by default. Up on a
   * roof the banks are not drawn: from above, upright sprites hanging in the air read as cards, not mist. */
  floor?: (pos: Vec2) => number
  /** Whether a bank may lie over (x, z): not off the district's edge or over water. Everywhere, by default. */
  ground?: (x: number, z: number) => boolean
}

/**
 * A winter morning's ground fog, over the scene fog the sky already thickened: a few large soft banks of mist
 * low on the street in a ring around the camera, turning slowly (still, under `prefers-reduced-motion`). Not
 * drawn on the lowest quality tier, where the scene fog alone carries the morning. Nothing allocates per frame.
 */
export function createGroundFog(stage: Stage, opts: GroundFogOptions = {}): GroundFog {
  const query =
    typeof matchMedia === 'function' && !opts.reducedMotion
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
  const still = opts.reducedMotion ?? (() => query?.matches ?? false)
  const floor = opts.floor ?? (() => 0)
  const ground = opts.ground ?? (() => true)

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
    update(dt, pos) {
      group.visible = level >= SHOW_FROM && stage.quality > 0 && !(pos && floor(pos) > 0)
      if (!group.visible) return
      const cx = stage.camera.position.x
      const cz = stage.camera.position.z
      group.position.set(cx, 0, cz)
      const drift = !still()
      for (let i = 0; i < FOG_BANKS; i++) {
        const bank = banks[i]!
        if (drift) {
          const a = (angle[i] = (angle[i]! + DRIFT * dt) % (Math.PI * 2))
          bank.position.set(Math.cos(a) * radius[i]!, BANK_Y, Math.sin(a) * radius[i]!)
        }
        // none hangs off the district's edge or over water
        bank.visible = ground(cx + bank.position.x, cz + bank.position.z)
      }
    },
    dispose() {
      group.removeFromParent()
      material.dispose()
      texture.dispose()
    },
  }
}
