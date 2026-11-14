import * as THREE from 'three'
import { storage } from '../storage'
import { PALETTE, type PaletteKey } from '../world/palette'
import type { AvatarLook } from '../world/types'

const SKINS = ['#F1C9A5', '#D9A877', '#B98055', '#8D5A3B', '#5E3A26'] as const
const HEADS: AvatarLook['head'][] = ['none', 'safa', 'cap', 'dupatta', 'bun']
const OUTFITS = Object.keys(PALETTE) as PaletteKey[]
const LOOK_KEY = 'gg-look'

const pick = <T>(items: readonly T[], rand: () => number): T =>
  items[Math.min(items.length - 1, Math.floor(rand() * items.length))]!

export function randomLook(rand: () => number = Math.random): AvatarLook {
  const skin = pick([0, 1, 2, 3, 4] as const, rand)
  const outfit = pick(OUTFITS, rand)
  const head = pick(HEADS, rand)
  return { skin, outfit, head }
}

function isLook(v: unknown): v is AvatarLook {
  const l = v as Partial<AvatarLook> | null
  return (
    !!l &&
    typeof l.skin === 'number' &&
    Number.isInteger(l.skin) &&
    l.skin >= 0 &&
    l.skin <= 4 &&
    typeof l.outfit === 'string' &&
    l.outfit in PALETTE &&
    HEADS.includes(l.head as AvatarLook['head'])
  )
}

/** Every visitor gets a random look on first visit and keeps it. */
export function loadOrCreateLook(): AvatarLook {
  const saved = storage.getJSON<unknown>(LOOK_KEY, null)
  if (isLook(saved)) return saved
  const look = randomLook()
  storage.set(LOOK_KEY, JSON.stringify(look))
  return look
}

/** A chunky low-poly walker about 1.7 m tall, facing +z, feet on y = 0. Well under 600 triangles. */
export function buildAvatar(look: AvatarLook): THREE.Group {
  const group = new THREE.Group()
  const mat = (hex: string) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true })
  const skin = mat(SKINS[look.skin])
  const cloth = mat(PALETTE[look.outfit])
  const dark = mat(PALETTE.road)

  const add = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(geo, material)
    m.position.set(x, y, z)
    m.castShadow = true
    group.add(m)
    return m
  }

  add(new THREE.BoxGeometry(0.22, 0.7, 0.24), dark, -0.14, 0.35)
  add(new THREE.BoxGeometry(0.22, 0.7, 0.24), dark, 0.14, 0.35)
  add(new THREE.CylinderGeometry(0.3, 0.38, 0.75, 8), cloth, 0, 1.05)
  add(new THREE.BoxGeometry(0.14, 0.6, 0.16), skin, -0.42, 1.0)
  add(new THREE.BoxGeometry(0.14, 0.6, 0.16), skin, 0.42, 1.0)
  add(new THREE.IcosahedronGeometry(0.23, 1), skin, 0, 1.68)

  switch (look.head) {
    case 'safa': // turban
      add(new THREE.CylinderGeometry(0.27, 0.3, 0.26, 10), mat(PALETTE.marigold), 0, 1.86)
      add(new THREE.IcosahedronGeometry(0.2, 0), mat(PALETTE.marigold), 0, 2.05)
      break
    case 'cap':
      add(new THREE.CylinderGeometry(0.22, 0.25, 0.14, 10), mat(PALETTE.white), 0, 1.9)
      break
    case 'dupatta': // scarf draped over the head and shoulders
      add(
        new THREE.CylinderGeometry(0.27, 0.36, 0.5, 8, 1, true),
        new THREE.MeshLambertMaterial({
          color: PALETTE[look.outfit],
          flatShading: true,
          side: THREE.DoubleSide,
        }),
        0,
        1.76,
      )
      break
    case 'bun':
      add(new THREE.IcosahedronGeometry(0.12, 0), dark, 0, 1.97, -0.1)
      break
    case 'none':
      break
  }
  return group
}
