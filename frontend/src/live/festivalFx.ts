import * as THREE from 'three'
import type { Stage } from '../engine/stage'
import type { FestivalId } from '../net/protocol'
import { FLOOR_H } from '../world/kit/parts'
import type { District } from '../world/district'
import type { BuildingSpec, BuildingStyle, StringLight } from '../world/types'
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

/** New Year's bulbs: one every so many metres along a strand, in a few festive colours. */
const BULB_SPACING = 0.9
export const BULB_COLOURS = ['#FFC24B', '#FF5FA2', '#57D9E0', '#FFF1D0', '#8CE36B']
/** How much a strand sags at its middle, per metre of its span, and at the most. */
const SAG_PER_M = 0.08
const MAX_SAG = 1.2
/** The twinkle: how fast each bulb breathes (radians a second) and how dim it gets at its lowest. */
const TWINKLE = 2.2
const TWINKLE_LOW = 0.45

/** One New Year bulb, in world space, and which of `BULB_COLOURS` it is. */
export interface Bulb extends Diya {
  colour: number
}

/** One strand's bulbs, in order from `a` to `b`, sagging between them (a parabola: at this sag, a catenary). */
function strandBulbs({ a, b, y }: StringLight, first: number): Bulb[] {
  const span = Math.hypot(b.x - a.x, b.z - a.z)
  const sag = Math.min(span * SAG_PER_M, MAX_SAG)
  const n = Math.max(2, Math.round(span / BULB_SPACING))
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    return {
      x: a.x + (b.x - a.x) * t,
      y: y - 4 * sag * t * (1 - t),
      z: a.z + (b.z - a.z) * t,
      colour: (first + i) % BULB_COLOURS.length,
    }
  })
}

/**
 * The bulbs along New Year's strands, in world space; neighbours along a strand never share a colour. Every
 * other bulb of each strand comes first: the lowest quality tier draws only those (`thin` of them), so its
 * strands are as long, only sparser.
 */
export function stringBulbs(strands: readonly StringLight[]): { bulbs: Bulb[]; thin: number } {
  const even: Bulb[] = []
  const odd: Bulb[] = []
  strands.forEach((s, k) => strandBulbs(s, k).forEach((b, i) => (i % 2 === 0 ? even : odd).push(b)))
  return { bulbs: [...even, ...odd], thin: even.length }
}

/** The wire the bulbs hang from: line-segment pairs from bulb to bulb along each strand, just above them. */
function wirePositions(strands: readonly StringLight[]): Float32Array {
  const out: number[] = []
  for (const s of strands) {
    const line = strandBulbs(s, 0)
    for (let i = 1; i < line.length; i++) {
      const p = line[i - 1]!
      const q = line[i]!
      out.push(p.x, p.y + 0.06, p.z, q.x, q.y + 0.06, q.z)
    }
  }
  return new Float32Array(out)
}

/**
 * Festival dressing: Sankranti kites over the rooftops, Diwali diyas on the parapets, Holi colour
 * at the district's centre, New Year's string lights where the district hangs them (MI Road). Instanced
 * throughout and nothing allocates per frame. Under `prefers-reduced-motion` the string lights hold steady.
 */
export function createFestivalFx(
  stage: Stage,
  district: District,
  opts: { reducedMotion?: () => boolean } = {},
): FestivalFx {
  const query =
    typeof matchMedia === 'function' && !opts.reducedMotion
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null
  const still = opts.reducedMotion ?? (() => query?.matches ?? false)
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

  // ---- New Year: string lights, only in a district that hangs them (nothing is made elsewhere)
  const strands = district.def.stringLights ?? []
  let bulbs: THREE.InstancedMesh | null = null
  let wire: THREE.LineSegments | null = null
  let bulbBase: Float32Array | null = null
  let bulbPhase: Float32Array | null = null
  let thinBulbs = 0
  if (strands.length) {
    const { bulbs: spots, thin } = stringBulbs(strands)
    thinBulbs = thin
    bulbs = new THREE.InstancedMesh(
      track(new THREE.IcosahedronGeometry(0.11, 0)),
      track(new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false })),
      spots.length,
    )
    bulbs.frustumCulled = false
    bulbs.visible = false
    bulbs.name = 'newyear-lights'
    bulbBase = new Float32Array(spots.length * 3)
    bulbPhase = new Float32Array(spots.length)
    spots.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      bulbs!.setMatrixAt(i, dummy.matrix)
      colour.set(BULB_COLOURS[b.colour]!)
      bulbs!.setColorAt(i, colour)
      bulbBase![i * 3] = colour.r
      bulbBase![i * 3 + 1] = colour.g
      bulbBase![i * 3 + 2] = colour.b
      bulbPhase![i] = rand(Math.PI * 2)
    })
    bulbs.instanceMatrix.needsUpdate = true
    const wireGeometry = track(new THREE.BufferGeometry())
    wireGeometry.setAttribute('position', new THREE.BufferAttribute(wirePositions(strands), 3))
    wire = new THREE.LineSegments(
      wireGeometry,
      track(new THREE.LineBasicMaterial({ color: '#2A2218', transparent: true, opacity: 0.7 })),
    )
    wire.frustumCulled = false
    wire.visible = false
    wire.name = 'newyear-wire'
    group.add(bulbs, wire)
  }
  /** Each bulb at `k` of its full brightness (1 when twinkling stops). */
  const glow = (time: number, twinkle: boolean) => {
    if (!bulbs || !bulbBase || !bulbPhase || !bulbs.instanceColor) return
    const out = bulbs.instanceColor.array as Float32Array
    const n = bulbs.count
    for (let i = 0; i < n; i++) {
      const k = twinkle
        ? TWINKLE_LOW + (1 - TWINKLE_LOW) * (0.5 + 0.5 * Math.sin(time * TWINKLE + bulbPhase[i]!))
        : 1
      out[i * 3] = bulbBase[i * 3]! * k
      out[i * 3 + 1] = bulbBase[i * 3 + 1]! * k
      out[i * 3 + 2] = bulbBase[i * 3 + 2]! * k
    }
    bulbs.instanceColor.needsUpdate = true
  }
  let twinkling = false

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
      if (bulbs && wire) {
        bulbs.visible = wire.visible = next === 'newyear'
        bulbs.count = quality === 0 ? thinBulbs : bulbs.instanceMatrix.count
        // steady at full brightness from the start, and again whenever twinkling stops
        twinkling = false
        glow(time, false)
      }
    },
    update(dt) {
      procession?.update(dt)
      if (!id) return
      time += dt
      if (id === 'newyear') {
        const twinkle = !still()
        if (twinkle || twinkling) glow(time, twinkle)
        twinkling = twinkle
      } else if (id === 'sankranti') {
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
      bulbs?.dispose()
      for (const d of disposables) d.dispose()
    },
  }
}
