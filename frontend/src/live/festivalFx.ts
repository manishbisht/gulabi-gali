import * as THREE from 'three'
import type { Stage } from '../engine/stage'
import type { FestivalId } from '../net/protocol'
import { FLOOR_H } from '../world/kit/parts'
import type { District } from '../world/district'
import type { BuildingSpec, BuildingStyle } from '../world/types'
import { PALETTE } from '../world/palette'
import { createProcession, processionCount, type Procession, type ProcessionKind } from './procession'
import type { SkyParams } from './sky'

type Tier = 0 | 1 | 2

/** Particles drawn per quality tier (index 0 is the lowest tier); Gangaur and Teej have a procession instead. */
const COUNTS: Partial<Record<FestivalId, readonly [number, number, number]>> = {
  sankranti: [25, 60, 120],
  holi: [15, 40, 80],
  diwali: [60, 150, 300],
}

export { processionCount }

export function festivalParticleCount(id: FestivalId, quality: Tier): number {
  return COUNTS[id]?.[quality] ?? 0
}

/** Diwali keeps the night lights burning from sunset, even before the sky's own rule would have them on. */
export function festivalSky(sky: SkyParams, id: FestivalId | null, sunsetIso: string, now: Date): SkyParams {
  if (id !== 'diwali' || sky.nightLights || now.getTime() < Date.parse(sunsetIso)) return sky
  return { ...sky, nightLights: true }
}

export interface FestivalFx {
  set(id: FestivalId | null, quality: Tier): void
  update(dt: number): void
  /** Women and drummers in the procession now walking (Gangaur and Teej), 0 when there is none. */
  processionCount(): number
  /**
   * Walks a procession whatever the festival (null hands it back to the festival). Only the test hooks call it,
   * so the performance run can have Sankranti's kites and a procession up at once; a build without
   * `VITE_TEST_HOOKS` does not carry it at all.
   */
  forceProcession?(kind: ProcessionKind | null, quality: Tier): void
  dispose(): void
}

export const KITE_COLOURS = [
  PALETTE.pink,
  PALETTE.marigold,
  PALETTE.teal,
  PALETTE.terracotta,
  PALETTE.white,
  '#D6336C',
]
const KITE_LOW = 25
const KITE_HIGH = 60
const KITE_WIND = 1.8
const STRING_ANCHOR = 12 // roughly a rooftop
const HOLI_COLOURS = ['#E0408A', '#F2A81D', '#3AA6D8', '#6BBF4A', '#8E4FC9', '#F26B3A']
const HOLI_RADIUS = 7
const HOLI_RISE = 9
const HOLI_LIFE = 4
const DIYA_SPACING = 2.2

const rand = (n: number) => Math.random() * n

/** A flat diamond with a short ragged tail, in the XY plane, facing +z. */
export function kiteGeometry() {
  const g = new THREE.BufferGeometry()
  // diamond, then a thin tail quad hanging below it
  const v = [
    0, 0.8, 0, -0.55, 0.1, 0, 0, -0.9, 0, 0.55, 0.1, 0, -0.06, -0.9, 0, 0.06, -0.9, 0, 0.06, -2.4, 0, -0.06,
    -2.4, 0,
  ]
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  g.setIndex([0, 1, 3, 1, 2, 3, 4, 7, 6, 4, 6, 5])
  return g
}

export interface Diya {
  x: number
  y: number
  z: number
}

/** How far above the top floor each style's roof edge stands: the haveli parapet, the shop and modern slabs. */
const ROOF_EDGE: Partial<Record<BuildingStyle, number>> = { haveli: 0.7, shop: 0.45, modern: 0.3 }

/**
 * Spots for diyas along the front and back roof edges of the havelis, shops and modern blocks, in world
 * space, spread evenly over the whole district when there are more than `limit`.
 */
export function roofDiyas(buildings: BuildingSpec[], limit: number): Diya[] {
  const spots: Diya[] = []
  for (const b of buildings) {
    const edge = ROOF_EDGE[b.style]
    if (edge === undefined) continue
    const y = b.floors * FLOOR_H + edge + 0.05
    const pw = b.w + 0.2
    const turn = THREE.MathUtils.degToRad(b.rot ?? 0)
    const c = Math.cos(turn)
    const s = Math.sin(turn)
    for (const zl of [(b.d + 0.2) / 2 - 0.09, -(b.d + 0.2) / 2 + 0.09]) {
      for (let xl = -pw / 2 + 0.6; xl <= pw / 2 - 0.6; xl += DIYA_SPACING) {
        // the kit turns a building by -rot about Y
        spots.push({ x: b.x + xl * c - zl * s, y, z: b.z + xl * s + zl * c })
      }
    }
  }
  if (spots.length <= limit) return spots
  const step = spots.length / limit
  return Array.from({ length: limit }, (_, i) => spots[Math.floor(i * step)]!)
}

/**
 * Festival dressing: Sankranti kites over the rooftops, Diwali diyas on the parapets, Holi colour
 * at the district's centre. Instanced throughout and nothing allocates per frame.
 */
export function createFestivalFx(stage: Stage, district: District): FestivalFx {
  const group = new THREE.Group()
  group.name = 'festival-fx'
  stage.scene.add(group)
  const half = district.def.size / 2
  const dummy = new THREE.Object3D()
  const colour = new THREE.Color()
  const disposables: { dispose(): void }[] = []
  const track = <T extends { dispose(): void }>(d: T): T => (disposables.push(d), d)

  // ---- kites
  const MAX_KITES = COUNTS.sankranti![2]
  const kiteMaterial = track(
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, color: '#ffffff' }),
  )
  const kites = new THREE.InstancedMesh(track(kiteGeometry()), kiteMaterial, MAX_KITES)
  kites.frustumCulled = false
  kites.visible = false
  kites.name = 'kites'
  const kx = new Float32Array(MAX_KITES)
  const ky = new Float32Array(MAX_KITES)
  const kz = new Float32Array(MAX_KITES)
  const kphase = new Float32Array(MAX_KITES)
  for (let i = 0; i < MAX_KITES; i++) {
    kx[i] = rand(half * 2) - half
    kz[i] = rand(half * 2) - half
    ky[i] = KITE_LOW + rand(KITE_HIGH - KITE_LOW)
    kphase[i] = rand(Math.PI * 2)
    kites.setColorAt(i, colour.set(KITE_COLOURS[i % KITE_COLOURS.length]!))
  }
  const stringPos = new Float32Array(MAX_KITES * 6)
  const stringGeometry = track(new THREE.BufferGeometry())
  stringGeometry.setAttribute('position', new THREE.BufferAttribute(stringPos, 3))
  const strings = new THREE.LineSegments(
    stringGeometry,
    track(new THREE.LineBasicMaterial({ color: '#F6EFE4', transparent: true, opacity: 0.45, fog: false })),
  )
  strings.frustumCulled = false
  strings.visible = false
  strings.name = 'kite-strings'
  group.add(kites, strings)

  // ---- holi puffs
  const MAX_PUFFS = COUNTS.holi![2]
  const puffs = new THREE.InstancedMesh(
    track(new THREE.IcosahedronGeometry(1, 0)),
    track(new THREE.MeshBasicMaterial({ fog: false, transparent: true, opacity: 0.8, depthWrite: false })),
    MAX_PUFFS,
  )
  puffs.frustumCulled = false
  puffs.visible = false
  puffs.name = 'holi-puffs'
  const centre = district.def.centre
  const px = new Float32Array(MAX_PUFFS)
  const pz = new Float32Array(MAX_PUFFS)
  const page = new Float32Array(MAX_PUFFS)
  const respawn = (i: number) => {
    const a = rand(Math.PI * 2)
    const r = Math.sqrt(Math.random()) * HOLI_RADIUS
    px[i] = centre.x + Math.cos(a) * r
    pz[i] = centre.z + Math.sin(a) * r
    puffs.setColorAt(i, colour.set(HOLI_COLOURS[(Math.random() * HOLI_COLOURS.length) | 0]!))
    if (puffs.instanceColor) puffs.instanceColor.needsUpdate = true
  }
  for (let i = 0; i < MAX_PUFFS; i++) {
    respawn(i)
    page[i] = rand(HOLI_LIFE)
  }
  group.add(puffs)

  // ---- diyas
  const diyaSpots = roofDiyas(district.def.buildings, COUNTS.diwali![2])
  const diyas = new THREE.InstancedMesh(
    track(new THREE.SphereGeometry(0.32, 6, 4)),
    track(new THREE.MeshBasicMaterial({ color: '#FFB347', fog: false })),
    Math.max(diyaSpots.length, 1),
  )
  diyas.frustumCulled = false
  diyas.visible = false
  diyas.name = 'diyas'
  diyaSpots.forEach((d, i) => {
    dummy.position.set(d.x, d.y, d.z)
    dummy.scale.set(1, 0.6, 1)
    dummy.updateMatrix()
    diyas.setMatrixAt(i, dummy.matrix)
  })
  diyas.instanceMatrix.needsUpdate = true
  group.add(diyas)

  // ---- Gangaur and Teej: the procession, rebuilt only when the festival or the tier changes
  let procession: Procession | null = null
  let processionKey = ''
  let forced: ProcessionKind | null = null
  const setProcession = (festival: FestivalId | null, quality: Tier) => {
    const next = forced ?? (festival === 'gangaur' || festival === 'teej' ? festival : null)
    const key = next ? `${next}:${quality}` : ''
    if (key === processionKey) return
    processionKey = key
    procession?.dispose()
    procession = null
    if (next) {
      procession = createProcession(district, next, quality)
      group.add(procession.group)
    }
  }

  let id: FestivalId | null = null
  let time = 0

  return {
    set(next, quality) {
      id = next
      setProcession(next, quality)
      const n = next ? festivalParticleCount(next, quality) : 0
      kites.visible = next === 'sankranti'
      strings.visible = next === 'sankranti' && quality > 0
      puffs.visible = next === 'holi'
      diyas.visible = next === 'diwali'
      if (next === 'sankranti') {
        kites.count = n
        stringGeometry.setDrawRange(0, n * 2)
      }
      if (next === 'holi') puffs.count = n
      if (next === 'diwali') diyas.count = Math.min(n, diyaSpots.length)
    },
    update(dt) {
      procession?.update(dt)
      if (!id) return
      time += dt
      if (id === 'sankranti') {
        const n = kites.count
        for (let i = 0; i < n; i++) {
          let x = kx[i]! + KITE_WIND * dt
          if (x > half) x -= half * 2
          kx[i] = x
          const sway = Math.sin(time * 0.9 + kphase[i]!)
          const y = ky[i]! + sway * 1.2
          dummy.position.set(x + sway * 0.8, y, kz[i]!)
          dummy.rotation.set(0.35, Math.sin(time * 0.5 + kphase[i]!) * 0.5, sway * 0.25)
          dummy.scale.setScalar(2.2)
          dummy.updateMatrix()
          kites.setMatrixAt(i, dummy.matrix)
          const o = i * 6
          stringPos[o] = x + sway * 0.8
          stringPos[o + 1] = y - 0.5
          stringPos[o + 2] = kz[i]!
          stringPos[o + 3] = x - 14
          stringPos[o + 4] = STRING_ANCHOR
          stringPos[o + 5] = kz[i]! + 4
        }
        kites.instanceMatrix.needsUpdate = true
        if (strings.visible) stringGeometry.attributes.position!.needsUpdate = true
      } else if (id === 'holi') {
        const n = puffs.count
        for (let i = 0; i < n; i++) {
          page[i] = page[i]! + dt
          if (page[i]! > HOLI_LIFE) {
            page[i] = 0
            respawn(i)
          }
          const k = page[i]! / HOLI_LIFE
          dummy.position.set(px[i]! + Math.sin(time + i) * 0.6 * k, 0.5 + k * HOLI_RISE, pz[i]!)
          dummy.rotation.set(0, 0, 0)
          dummy.scale.setScalar(Math.sin(Math.PI * k) * 1.6 + 0.05)
          dummy.updateMatrix()
          puffs.setMatrixAt(i, dummy.matrix)
        }
        puffs.instanceMatrix.needsUpdate = true
      }
    },
    processionCount: () => procession?.count ?? 0,
    ...(import.meta.env.VITE_TEST_HOOKS === '1'
      ? {
          forceProcession(kind: ProcessionKind | null, quality: Tier) {
            forced = kind
            setProcession(id, quality)
          },
        }
      : {}),
    dispose() {
      procession?.dispose()
      procession = null
      group.removeFromParent()
      kites.dispose()
      puffs.dispose()
      diyas.dispose()
      for (const d of disposables) d.dispose()
    },
  }
}
