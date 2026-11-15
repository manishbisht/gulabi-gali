import * as THREE from 'three'
import type { StringKey } from '../i18n/strings'
import type { FestivalId, DistrictId } from '../net/protocol'
import { bakeHex, merge } from '../world/kit/parts'
import type { District } from '../world/district'
import type { Vec2 } from '../world/types'

/*
 * The Gangaur and Teej processions: a looping line of instanced figures, never NPC walkers. A palanquin
 * (Gangaur) or a decorated swing cart (Teej) carrying the idol on four bearers' shoulders leads; dhol drummers
 * go ahead of it and women in lehariya, balancing kalash pots on their heads, follow in two rows. Three draw
 * calls at most: the women (tinted per instance), the drummers, and the one float. They walk the district's
 * `processionRoute` at about a metre a second with a gentle sway, pass straight through the player and the
 * NPCs (nothing here is a collider or reads one), and play no audio. Nothing allocates per frame.
 */

export type ProcessionKind = 'gangaur' | 'teej'
type Tier = 0 | 1 | 2

/** Members (women and drummers) per quality tier, index 0 being the lowest; the float is extra. */
const MEMBERS: readonly [number, number, number] = [8, 20, 40]
const FESTIVALS: readonly string[] = ['gangaur', 'teej']

export function processionCount(id: string, quality: Tier): number {
  return FESTIVALS.includes(id) ? MEMBERS[quality] : 0
}

/** The HUD line while a procession is out: the Tripolia one only where Tripolia is. */
export function processionLine(festival: FestivalId | null, district: DistrictId): StringKey | undefined {
  if (festival === 'gangaur')
    return district === 'walled-city' ? 'festivalGangaurLine' : 'festivalGangaurLineStreet'
  return festival === 'teej' ? 'festivalTeejLine' : undefined
}

const SPEED = 1 // m/s
/** The Walled City's is the full line; every other district has half of it. */
const SMALL = 0.5
/** A corner is cut back this far (or a third of the leg, if shorter) so the line turns instead of snapping. */
const CORNER = 2.5
const ROW = 0.8 // each row of women and drummers stands this far off the middle
const GAP = 1.3 // between ranks
const AHEAD = 3.2 // the first drummers are this far ahead of the float
const BEHIND = 3.6 // and the first women this far behind it

const LEHARIYA = ['#E0408A', '#F2A81D', '#D6336C', '#8E4FC9', '#F26B3A', '#E4917A', '#2F9FB0']
const HARIYALI = ['#2E9E4F', '#4CAF50', '#7BC043', '#1F8A4C', '#9ACD32', '#0F7A4D', '#3FB96B']

// ---- the route ---------------------------------------------------------------------------------

/** The loop the line really walks: `route` (closed, last point back to the first) with its corners cut. */
export function processionPath(route: Vec2[]): Vec2[] {
  const n = route.length
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const p = route[i]!
    const a = route[(i + n - 1) % n]!
    const b = route[(i + 1) % n]!
    const back = Math.hypot(p.x - a.x, p.z - a.z)
    const fwd = Math.hypot(b.x - p.x, b.z - p.z)
    const cut = Math.min(CORNER, back / 3, fwd / 3)
    out.push(
      { x: p.x + ((a.x - p.x) / back) * cut, z: p.z + ((a.z - p.z) / back) * cut },
      { x: p.x + ((b.x - p.x) / fwd) * cut, z: p.z + ((b.z - p.z) / fwd) * cut },
    )
  }
  return out
}

/** A closed loop, pre-measured so that finding where a distance along it falls allocates nothing. */
function loop(route: Vec2[]) {
  const pts = processionPath(route)
  const n = pts.length
  const x = new Float32Array(n)
  const z = new Float32Array(n)
  const dx = new Float32Array(n)
  const dz = new Float32Array(n)
  const start = new Float32Array(n + 1)
  for (let i = 0; i < n; i++) {
    const a = pts[i]!
    const b = pts[(i + 1) % n]!
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    x[i] = a.x
    z[i] = a.z
    dx[i] = (b.x - a.x) / len
    dz[i] = (b.z - a.z) / len
    start[i + 1] = start[i]! + len
  }
  const length = start[n]!
  return {
    length,
    /** Where `s` metres along the loop is, `lat` metres to its left, and which way it faces. */
    at(s: number, lat: number, out: { x: number; z: number; ry: number }) {
      s = ((s % length) + length) % length
      let i = 0
      while (i < n - 1 && start[i + 1]! <= s) i++
      const t = s - start[i]!
      out.x = x[i]! + dx[i]! * t + dz[i]! * lat
      out.z = z[i]! + dz[i]! * t - dx[i]! * lat
      out.ry = Math.atan2(dx[i]!, dz[i]!)
    },
  }
}

// ---- the dress colour --------------------------------------------------------------------------

const INSTANCE_COLOUR = 'vColor.rgb *= instanceColor.rgb;'
/** Only a pure-white vertex (the dress) takes the instance colour; skin, kalash and coconut keep their own. */
const DRESS_ONLY =
  'float dress = step(0.999, min(vColor.r, min(vColor.g, vColor.b))); ' +
  'vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, dress);'

/** `onBeforeCompile` for the shared material: swaps the instance-colour multiply in `color_vertex` for `DRESS_ONLY`. */
export function dressOnly(shader: { vertexShader: string }): void {
  const chunk = THREE.ShaderChunk.color_vertex
  if (!chunk.includes(INSTANCE_COLOUR)) throw new Error('procession: three changed color_vertex')
  shader.vertexShader = shader.vertexShader.replace(
    '#include <color_vertex>',
    chunk.replace(INSTANCE_COLOUR, DRESS_ONLY),
  )
}

// ---- the figures -------------------------------------------------------------------------------

const SKIN = '#B9825A'
const WOOD = '#8A5A3A'
const BRASS = '#E0A526'

/** A piece with one colour baked in, its base at (x, y, z). */
function piece(g: THREE.BufferGeometry, x: number, y: number, z: number, hex: string) {
  g.translate(x, y, z)
  return bakeHex(g, hex)
}
const cyl = (
  rTop: number,
  rBot: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  hex: string,
) => piece(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1), x, y + h / 2, z, hex)
const block = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string) =>
  piece(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, hex)
const ball = (r: number, x: number, y: number, z: number, hex: string) =>
  piece(new THREE.SphereGeometry(r, 6, 4), x, y, z, hex)

/** A woman in lehariya with a kalash on her head. The dress is white, so the instance colour is the dress. */
export function womanGeometry() {
  return merge([
    cyl(0.2, 0.34, 0.8, 6, 0, 0, 0, '#ffffff'), // skirt
    cyl(0.17, 0.2, 0.4, 6, 0, 0.8, 0, '#ffffff'), // blouse
    block(0.07, 0.5, 0.07, -0.19, 0.95, 0.04, '#ffffff'), // arms up to the pot
    block(0.07, 0.5, 0.07, 0.19, 0.95, 0.04, '#ffffff'),
    ball(0.11, 0, 1.33, 0, SKIN),
    piece(new THREE.SphereGeometry(0.15, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.35, 0, '#ffffff'), // odhni
    block(0.32, 0.55, 0.04, 0, 0.82, -0.13, '#ffffff'), // the veil falling behind
    cyl(0.13, 0.1, 0.16, 6, 0, 1.5, 0, BRASS), // the kalash
    cyl(0.05, 0.08, 0.08, 6, 0, 1.66, 0, BRASS),
    ball(0.06, 0, 1.76, 0, '#7A4A2A'), // its coconut
  ])
}

/** A dhol drummer in a pink safa, the drum slung at his hip. */
function drummerGeometry() {
  const dhol = new THREE.CylinderGeometry(0.17, 0.17, 0.55, 7, 1)
  dhol.rotateZ(Math.PI / 2)
  return merge([
    block(0.11, 0.8, 0.14, -0.09, 0, 0, '#F6EFE4'),
    block(0.11, 0.8, 0.14, 0.09, 0, 0, '#F6EFE4'),
    cyl(0.18, 0.21, 0.66, 6, 0, 0.8, 0, '#F2A81D'), // kurta
    block(0.07, 0.45, 0.07, -0.25, 0.95, 0.12, '#F2A81D'),
    block(0.07, 0.45, 0.07, 0.25, 0.95, 0.12, '#F2A81D'),
    ball(0.11, 0, 1.58, 0, SKIN),
    piece(new THREE.ConeGeometry(0.15, 0.2, 6), 0, 1.78, 0, '#E4917A'), // safa
    piece(dhol, 0, 1, 0.28, WOOD),
    block(0.03, 0.03, 0.4, 0.28, 1.15, 0.35, '#F6EFE4'), // a stick
  ])
}

/** One of the four who carry the float, on its corner. */
function bearer(x: number, z: number, hex: string) {
  return [
    block(0.1, 0.75, 0.13, x - 0.08, 0, z, '#F6EFE4'),
    block(0.1, 0.75, 0.13, x + 0.08, 0, z, '#F6EFE4'),
    cyl(0.17, 0.2, 0.55, 6, x, 0.75, z, hex),
    ball(0.1, x, 1.5, z, SKIN),
    piece(new THREE.ConeGeometry(0.14, 0.18, 6), x, 1.68, z, '#E4917A'),
  ]
}

/** The idol: Gauri (Gangaur) or Parvati (Teej), a skirted figure in a crown, seated at height `y`. */
function idol(y: number, skirt: string) {
  return [
    piece(new THREE.ConeGeometry(0.24, 0.5, 6), 0, y + 0.25, 0, skirt),
    cyl(0.1, 0.14, 0.2, 6, 0, y + 0.5, 0, '#E4917A'),
    ball(0.09, 0, y + 0.8, 0, '#E7B07A'),
    piece(new THREE.ConeGeometry(0.08, 0.16, 5), 0, y + 0.98, 0, BRASS), // crown
  ]
}

/** The Gangaur palanquin: a canopied platform on two poles, the idol in the middle, four bearers. */
function palanquinGeometry() {
  const posts = [-0.52, 0.52].flatMap((x) =>
    [-0.72, 0.72].map((z) => block(0.06, 1, 0.06, x, 1.3, z, '#B85C45')),
  )
  return merge([
    ...bearer(-0.8, -0.95, '#E0408A'),
    ...bearer(0.8, -0.95, '#E0408A'),
    ...bearer(-0.8, 0.95, '#E0408A'),
    ...bearer(0.8, 0.95, '#E0408A'),
    block(0.07, 0.07, 2.7, -0.8, 1.2, 0, WOOD), // carrying poles
    block(0.07, 0.07, 2.7, 0.8, 1.2, 0, WOOD),
    block(1.4, 0.1, 1.9, 0, 1.2, 0, WOOD),
    block(1.2, 0.06, 1.7, 0, 1.3, 0, '#F2A81D'), // the floor, in marigold
    ...posts,
    block(1.4, 0.08, 1.8, 0, 2.3, 0, '#E0408A'), // roof
    piece(new THREE.SphereGeometry(0.5, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2), 0, 2.38, 0, BRASS),
    cyl(0.03, 0.03, 0.3, 4, 0, 2.7, 0, BRASS),
    block(1.4, 0.2, 0.05, 0, 2.1, 0.9, '#F2A81D'), // marigold garland along the front
    block(1.4, 0.2, 0.05, 0, 2.1, -0.9, '#F2A81D'),
    ...idol(1.36, '#E0408A'),
  ])
}

/** The Teej swing cart: two wheels and a frame with a hanging swing and the idol on it; four bearers pull. */
function jhulaGeometry() {
  const wheel = (x: number) => {
    const g = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 8, 1)
    g.rotateZ(Math.PI / 2)
    return piece(g, x, 0.4, 0, WOOD)
  }
  return merge([
    ...bearer(-0.8, -1.0, '#2E9E4F'),
    ...bearer(0.8, -1.0, '#2E9E4F'),
    ...bearer(-0.8, 1.0, '#2E9E4F'),
    ...bearer(0.8, 1.0, '#2E9E4F'),
    wheel(-0.75),
    wheel(0.75),
    block(1.5, 0.1, 1.5, 0, 0.5, 0, WOOD), // the bed of the cart
    block(0.08, 1.7, 0.08, -0.65, 0.55, 0, '#B85C45'), // the frame
    block(0.08, 1.7, 0.08, 0.65, 0.55, 0, '#B85C45'),
    block(1.5, 0.1, 0.1, 0, 2.2, 0, '#B85C45'),
    block(0.04, 1.0, 0.04, -0.3, 1.2, 0, '#4CAF50'), // flower-wound ropes
    block(0.04, 1.0, 0.04, 0.3, 1.2, 0, '#4CAF50'),
    block(0.7, 0.07, 0.4, 0, 1.15, 0, '#F2A81D'), // the swing seat
    ...idol(1.2, '#2E9E4F'),
    block(1.5, 0.08, 0.08, 0, 2.05, 0, '#7BC043'), // a hariyali garland on the beam
  ])
}

// ---- the procession ----------------------------------------------------------------------------

export interface Procession {
  group: THREE.Group
  /** Women and drummers in the line (the float is one more figure). */
  count: number
  update(dt: number): void
  dispose(): void
}

export function createProcession(district: District, kind: ProcessionKind, quality: Tier): Procession {
  const full = district.def.id === 'walled-city'
  const total = full ? processionCount(kind, quality) : Math.ceil(processionCount(kind, quality) * SMALL)
  const drummers = Math.max(1, Math.round(total / 8))
  const women = total - drummers
  const path = loop(district.def.processionRoute)
  const colours = kind === 'teej' ? HARIYALI : LEHARIYA

  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  material.onBeforeCompile = dressOnly
  const geometries = [
    womanGeometry(),
    drummerGeometry(),
    kind === 'teej' ? jhulaGeometry() : palanquinGeometry(),
  ] as const
  const mesh = (g: THREE.BufferGeometry, n: number, name: string) => {
    const m = new THREE.InstancedMesh(g, material, n)
    m.name = name
    m.frustumCulled = false
    m.castShadow = false
    return m
  }
  const womenMesh = mesh(geometries[0], women, 'procession-women')
  const drumMesh = mesh(geometries[1], drummers, 'procession-drummers')
  const floatMesh = mesh(geometries[2], 1, `procession-${kind === 'teej' ? 'jhula' : 'palanquin'}`)
  const meshes = [womenMesh, drumMesh, floatMesh]
  const tint = new THREE.Color()
  for (let i = 0; i < women; i++) womenMesh.setColorAt(i, tint.set(colours[i % colours.length]!))
  const group = new THREE.Group()
  group.name = 'procession'
  group.add(...meshes)

  // where each member stands: metres ahead of the float, and off to the left
  const ahead = new Float32Array(women + drummers)
  const lateral = new Float32Array(women + drummers)
  const phase = new Float32Array(women + drummers)
  for (let i = 0; i < women + drummers; i++) {
    const rank = i < women ? Math.floor(i / 2) : Math.floor((i - women) / 2)
    ahead[i] = i < women ? -(BEHIND + rank * GAP) : AHEAD + rank * GAP
    lateral[i] = (i % 2 === 0 ? 1 : -1) * ROW
    phase[i] = (i * 2.399) % (Math.PI * 2)
  }

  const dummy = new THREE.Object3D()
  const here = { x: 0, z: 0, ry: 0 }
  let time = 0
  const place = (mesh: THREE.InstancedMesh, slot: number, i: number, bob: number, roll: number) => {
    path.at(time * SPEED + ahead[i]!, lateral[i]!, here)
    dummy.position.set(here.x, bob, here.z)
    dummy.rotation.set(0, here.ry, roll)
    dummy.updateMatrix()
    mesh.setMatrixAt(slot, dummy.matrix)
  }
  const update = (dt: number) => {
    time += dt
    for (let i = 0; i < women; i++) {
      const w = time * 6 + phase[i]!
      place(womenMesh, i, i, Math.abs(Math.sin(w)) * 0.04, Math.sin(w) * 0.04)
    }
    for (let j = 0; j < drummers; j++) {
      const i = women + j
      const w = time * 6.5 + phase[i]!
      place(drumMesh, j, i, Math.abs(Math.sin(w)) * 0.05, Math.sin(w) * 0.05)
    }
    path.at(time * SPEED, 0, here)
    dummy.position.set(here.x, Math.abs(Math.sin(time * 3)) * 0.03, here.z)
    dummy.rotation.set(0, here.ry, Math.sin(time * 3) * 0.02)
    dummy.updateMatrix()
    floatMesh.setMatrixAt(0, dummy.matrix)
    for (const m of meshes) m.instanceMatrix.needsUpdate = true
  }
  update(0)

  return {
    group,
    count: total,
    update,
    dispose() {
      group.removeFromParent()
      for (const m of meshes) m.dispose()
      for (const g of geometries) g.dispose()
      material.dispose()
    },
  }
}
