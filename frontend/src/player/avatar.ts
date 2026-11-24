import * as THREE from 'three'
import { storage } from '../storage'
import { bakeHex, merge } from '../world/kit/parts'
import { PALETTE, type PaletteKey } from '../world/palette'
import {
  compactLook,
  DRESS_LIMITS,
  dressOf,
  OUTFITS as WIRE_OUTFITS,
  type AvatarLookWire,
  type Dress,
} from '../net/protocol'
import type { AvatarLook } from '../world/types'

/**
 * Skin tones, light to deep: `tone` on a look. The older five skins are tones 1, 2, 3, 5 and 6 (see
 * `TONE_OF_SKIN`), so the people who chose one before tones look as they did.
 */
export const TONES = [
  '#F6D8BE',
  '#F1C9A5',
  '#D9A877',
  '#B98055',
  '#A06D47',
  '#8D5A3B',
  '#5E3A26',
  '#3F271A',
] as const
export const HEADS: AvatarLook['head'][] = ['none', 'safa', 'cap', 'dupatta', 'bun']
export const OUTFITS = Object.keys(PALETTE) as PaletteKey[]
/** What a random look may wear: not the colours of the street itself (asphalt, sandstone, plain white, glass). */
const RANDOM_OUTFITS = OUTFITS.filter((k) => !['road', 'sandstone', 'white', 'glass'].includes(k))
const LOOK_KEY = 'gg-look'
const DRESS_KEYS = Object.keys(DRESS_LIMITS) as (keyof Dress)[]

/** The colour of an `OUTFITS` index (a headwear's or a dupatta's). */
const colourAt = (i: number): string => PALETTE[(WIRE_OUTFITS[i] ?? 'marigold') as PaletteKey]

const pick = <T>(items: readonly T[], rand: () => number): T =>
  items[Math.min(items.length - 1, Math.floor(rand() * items.length))]!

export function randomLook(rand: () => number = Math.random): AvatarLook {
  const skin = pick([0, 1, 2, 3, 4] as const, rand)
  const outfit = pick(RANDOM_OUTFITS, rand)
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

/**
 * A look this build can draw, or null. The older fields must be right; a dressing-room field this build does
 * not know (a newer option, or junk) is left out, so it falls back to what the older fields say.
 */
function cleanLook(v: unknown): AvatarLook | null {
  if (!isLook(v)) return null
  const look: AvatarLook = { skin: v.skin, outfit: v.outfit, head: v.head }
  let dressed = false
  for (const k of DRESS_KEYS) {
    const n = (v as Record<string, unknown>)[k]
    if (Number.isInteger(n) && (n as number) >= 0 && (n as number) < DRESS_LIMITS[k]) {
      look[k] = n as number
      dressed = true
    }
  }
  return dressed ? (compactLook(look.outfit, dressOf(look)) as AvatarLook) : look
}

/** Every choice of a look, the older fields filling in any it leaves out. */
export const dressOfLook = (look: AvatarLook): Dress => dressOf(look as AvatarLookWire)

/** A look with these choices made (the rest as they were), on the wire's terms. */
export const dressLook = (look: AvatarLook, change: Partial<Dress>, outfit = look.outfit): AvatarLook =>
  compactLook(outfit, { ...dressOfLook(look), ...change }) as AvatarLook

/** One string per distinct figure: two looks with the same key are drawn the same. */
export function lookKey(look: AvatarLook): string {
  const d = dressOfLook(look)
  return `${d.tone}|${look.outfit}|${d.hat}|${d.hat ? d.hatC : ''}|${d.dup}|${d.dup ? d.dupC : ''}|${d.hair}`
}

export const lookToWire = (look: AvatarLook): AvatarLookWire => ({ ...look }) as AvatarLookWire

/** A look from the server, or null when it is not one this build can draw. */
export function lookFromWire(wire: AvatarLookWire): AvatarLook | null {
  return cleanLook(wire)
}

/** Every visitor gets a random look on first visit and keeps it. */
export function loadOrCreateLook(): AvatarLook {
  const saved = cleanLook(storage.getJSON<unknown>(LOOK_KEY, null))
  if (saved) return saved
  const look = randomLook()
  storage.set(LOOK_KEY, JSON.stringify(look))
  return look
}

/** Keeps a ghost's look on this device (only here: a ghost has nothing on the server). */
export function saveLocalLook(look: AvatarLook): void {
  storage.set(LOOK_KEY, JSON.stringify(look))
}

/** What the monkey can take off a head: the headwear first, else a dupatta. */
export type Headgear = 'safa' | 'cap' | 'dupatta'

/** The headgear a look wears, and its colour; null for none. */
export function headgearOf(look: AvatarLook): { gear: Headgear; hex: string } | null {
  const d = dressOfLook(look)
  if (d.hat) return { gear: d.hat === 3 ? 'cap' : 'safa', hex: colourAt(d.hatC) }
  if (d.dup) return { gear: 'dupatta', hex: colourAt(d.dupC) }
  return null
}

/** The same look with its headgear (see `headgearOf`) gone, for this page only. */
export function withoutHeadgear(look: AvatarLook): AvatarLook {
  // an older look wears one thing on its head at most
  if (!DRESS_KEYS.some((k) => look[k] !== undefined))
    return look.head === 'bun' ? look : { ...look, head: 'none' }
  const d = dressOfLook(look)
  if (d.hat) return dressLook(look, { hat: 0 })
  if (d.dup) return dressLook(look, { dup: 0 })
  return look
}

export interface AvatarOptions {
  /** Whether the body casts a shadow. True for the local player; other walkers pass false. */
  castShadow?: boolean
}

/** One vertex-coloured material for every avatar. Double-sided for the open dupatta. */
let material: THREE.MeshLambertMaterial | null = null
/** How many distinct bodies are kept (a busy street of dressed people has far fewer on it at once). */
export const BODY_CACHE = 64
/** A merged body and the figures made with it (weakly: a figure that is gone does not keep it). */
interface CachedBody {
  geo: THREE.BufferGeometry
  users: WeakRef<THREE.Mesh>[]
}
/** Merged bodies, one per distinct look, least recently used first; avatars with the same look share it. */
const geometries = new Map<string, CachedBody>()

/** A material for avatars: one vertex-coloured, flat-shaded Lambert, double-sided for the open dupatta. */
export const avatarMaterial = (): THREE.MeshLambertMaterial =>
  new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })

/**
 * A new merged body for `look`, owned by the caller (`buildAvatar` shares cached ones instead). Looks from
 * before the dressing room come out exactly as they always were.
 */
export function buildBodyGeometry(look: AvatarLook): THREE.BufferGeometry {
  const d = dressOfLook(look)
  const skin = TONES[d.tone] ?? TONES[1]
  const parts: THREE.BufferGeometry[] = []
  const add = (geo: THREE.BufferGeometry, hex: string, x: number, y: number, z = 0) => {
    geo.translate(x, y, z)
    parts.push(bakeHex(geo, hex))
  }
  const dark = PALETTE.road
  const cloth = PALETTE[look.outfit]
  const hatHex = colourAt(d.hatC)
  const dupHex = colourAt(d.dupC)

  add(new THREE.BoxGeometry(0.22, 0.7, 0.24), dark, -0.14, 0.35)
  add(new THREE.BoxGeometry(0.22, 0.7, 0.24), dark, 0.14, 0.35)
  add(new THREE.CylinderGeometry(0.3, 0.38, 0.75, 8), cloth, 0, 1.05)
  add(new THREE.BoxGeometry(0.14, 0.6, 0.16), skin, -0.42, 1.0)
  add(new THREE.BoxGeometry(0.14, 0.6, 0.16), skin, 0.42, 1.0)
  add(new THREE.IcosahedronGeometry(0.23, 1), skin, 0, 1.68)

  // hair: the close crop is the bare head every figure had; the bun is the older head option, as it was
  if (d.hair >= 2) {
    // a cap of hair over the crown and the back of the head
    const cap = new THREE.SphereGeometry(0.245, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55)
    cap.rotateX(-0.45)
    add(cap, dark, 0, 1.69, -0.02)
  }
  if (d.hair === 1) add(new THREE.IcosahedronGeometry(0.12, 0), dark, 0, 1.97, -0.1)
  if (d.hair === 3) add(new THREE.BoxGeometry(0.4, 0.42, 0.1), dark, 0, 1.5, -0.17) // long, down the back
  if (d.hair === 4) {
    add(new THREE.CylinderGeometry(0.055, 0.04, 0.55, 5), dark, 0, 1.33, -0.24) // a plait
    add(new THREE.IcosahedronGeometry(0.05, 0), PALETTE.marigold, 0, 1.06, -0.24) // its tie
  }

  switch (d.hat) {
    case 1: // safa
      add(new THREE.CylinderGeometry(0.27, 0.3, 0.26, 10), hatHex, 0, 1.86)
      add(new THREE.IcosahedronGeometry(0.2, 0), hatHex, 0, 2.05)
      break
    case 2: {
      // pagdi: a broader, flatter tie, its crest a little forward and its end hanging down the back
      add(new THREE.CylinderGeometry(0.31, 0.3, 0.2, 10), hatHex, 0, 1.84)
      add(new THREE.CylinderGeometry(0.29, 0.31, 0.12, 10), hatHex, 0, 1.99, 0.03)
      add(new THREE.BoxGeometry(0.12, 0.42, 0.04), hatHex, 0, 1.62, -0.29)
      break
    }
    case 3: // cap
      add(new THREE.CylinderGeometry(0.22, 0.25, 0.14, 10), hatHex, 0, 1.9)
      break
  }

  // a dupatta over the head is drawn round the shoulders when headwear is on
  if (d.dup === 1 && !d.hat) {
    add(new THREE.CylinderGeometry(0.27, 0.36, 0.5, 8, 1, true), dupHex, 0, 1.76)
  } else if (d.dup) {
    // a stole round the shoulders, one end down the front
    add(new THREE.CylinderGeometry(0.33, 0.39, 0.16, 8, 1, true), dupHex, 0, 1.4)
    add(new THREE.BoxGeometry(0.13, 0.56, 0.04), dupHex, 0.15, 1.1, 0.34)
  }
  return merge(parts)
}

/** Whether a figure is on a stage now: its tree reaches a scene (one removed, or never added, is not). */
function onStage(mesh: THREE.Object3D): boolean {
  let o = mesh
  while (o.parent) o = o.parent
  return (o as THREE.Scene).isScene === true
}

/** Whether any figure drawn with this body is on a stage; figures that are gone are forgotten on the way. */
function inUse(entry: CachedBody): boolean {
  entry.users = entry.users.filter((u) => u.deref() !== undefined)
  return entry.users.some((u) => onStage(u.deref()!))
}

/**
 * Keeps at most `BODY_CACHE` bodies, freeing the least recently used ones that no figure on a stage wears. One
 * still worn is never freed (the cache may then run over until it is not); `keep` is the body just handed out.
 */
function trim(keep: string): void {
  if (geometries.size <= BODY_CACHE) return
  for (const [key, entry] of geometries) {
    if (geometries.size <= BODY_CACHE) return
    if (key === keep || inUse(entry)) continue
    entry.geo.dispose()
    geometries.delete(key)
  }
}

function bodyGeometry(look: AvatarLook): [string, CachedBody] {
  const key = lookKey(look)
  const cached = geometries.get(key)
  if (cached) {
    // most recently used goes last
    geometries.delete(key)
    geometries.set(key, cached)
    return [key, cached]
  }
  const entry: CachedBody = { geo: buildBodyGeometry(look), users: [] }
  geometries.set(key, entry)
  return [key, entry]
}

/**
 * A chunky low-poly walker about 1.7 m tall, facing +z, feet on y = 0: one merged, vertex-coloured mesh,
 * so one draw call. Under 600 triangles. Geometry and material are shared and must not be disposed by
 * the caller.
 */
export function buildAvatar(look: AvatarLook, { castShadow = true }: AvatarOptions = {}): THREE.Mesh {
  material ??= avatarMaterial()
  const [key, entry] = bodyGeometry(look)
  const mesh = new THREE.Mesh(entry.geo, material)
  mesh.castShadow = castShadow
  entry.users.push(new WeakRef(mesh))
  trim(key)
  return mesh
}

/**
 * Frees the shared geometry and material. three hangs dispose listeners off every resource it renders,
 * tied to that renderer, so the owner of a stage calls this when the stage goes; the next `buildAvatar`
 * rebuilds what it needs.
 */
export function disposeAvatarCache(): void {
  for (const { geo } of geometries.values()) geo.dispose()
  geometries.clear()
  material?.dispose()
  material = null
}
