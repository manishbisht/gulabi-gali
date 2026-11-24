import * as THREE from 'three'
import { seeded } from '../districts/layout'
import { bakeHex, box, merge } from '../kit/parts'

/*
 * What Nahargarh looks out over: past the ridge's west edge the ground falls away down a rocky slope to the plain,
 * and the city spreads across it, far below. Drawn cheaply, and only to be looked at: two meshes (the land, and
 * the city's blocks, whose lights come on after dark), a few thousand triangles, no colliders. The scene's fog
 * fades it into the haze with distance, a little more thinly than the street (`CITY_FOG`), so on a dusty or
 * smoggy day the city goes hazy the way the real one does without vanishing from the view.
 */

const ROCK = '#9A7B57'
const PLAIN = '#C7A383'
/** The city's colours, mostly the Pink City's own, as the houses down there are. */
const TINTS = ['#E4917A', '#E4917A', '#E4917A', '#D9B382', '#F6EFE4', '#B85C45'] as const

/** How far the slope runs out west as it falls, and how far the plain and the city reach. */
const SLOPE_RUN = 40
const PLAIN_REACH = 420
const CITY_FROM = 4 // the nearest houses, out from the foot of the slope
const CITY_TO = 260
const CITY_HALF_WIDTH = 240
const BLOCKS = 380

/**
 * The city below takes this share of the scene's fog density, so the headline view stays legible: still hazy,
 * and thicker on a bad-air day, but not gone at "poor" the way the street's own distance is.
 */
export const CITY_FOG = 0.45

/** How much of something `distance` m off the city's thinner fog hides (exponential-squared, at the scene's `density`). */
export const cityFogFactor = (density: number, distance: number): number =>
  1 - Math.exp(-((density * CITY_FOG * distance) ** 2))

/** The fog chunk with the density scaled by `CITY_FOG`: a constant in the shader, nothing per frame. */
const THIN_FOG = THREE.ShaderChunk.fog_fragment.replace(
  'fogDensity * fogDensity',
  `fogDensity * fogDensity * ${(CITY_FOG * CITY_FOG).toFixed(4)}`,
)

/** Gives a material of the city below its thinner fog (its own shader program, shared by both meshes). */
export function thinFog(m: THREE.Material): void {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', THIN_FOG)
  }
  m.customProgramCacheKey = () => 'city-below-thin-fog'
}

/** The low parapet along the edge: how tall, and how thick (it stands just past the district's west wall). */
const PARAPET_H = 1.1
const PARAPET_T = 0.6

/** The rocky slope from the ridge's edge (x = `edge`, y = 0) down to the plain (`drop` below), jagged but seamless at the top. */
function slope(edge: number, drop: number, reach: number, rand: () => number) {
  const g = new THREE.PlaneGeometry(SLOPE_RUN, reach * 2, 4, 24)
  // lay it down, its +x half toward the ridge
  g.rotateX(-Math.PI / 2)
  const pos = g.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const t = (SLOPE_RUN / 2 - pos.getX(i)) / SLOPE_RUN // 0 at the top edge, 1 at the foot
    const jag = t > 0 && t < 1 ? (rand() - 0.5) * 4 : 0
    pos.setX(i, edge - t * SLOPE_RUN + jag * 0.6)
    pos.setY(i, -drop * Math.pow(t, 0.8) + jag)
  }
  const flat = g.toNonIndexed()
  g.dispose()
  flat.computeVertexNormals()
  return bakeHex(flat, ROCK)
}

/** The plain below: one quad, from the slope's foot out to the haze. */
function plain(edge: number, drop: number, reach: number) {
  const from = edge - SLOPE_RUN + 1
  const g = new THREE.PlaneGeometry(PLAIN_REACH, reach * 2)
  g.rotateX(-Math.PI / 2)
  g.translate(from - PLAIN_REACH / 2, -drop + 0.05, 0)
  return bakeHex(g, PLAIN)
}

/** The parapet along the whole edge: a low wall with merlons, the fort's own along its ridge. */
function parapet(edge: number, half: number): THREE.BufferGeometry[] {
  const x = edge - PARAPET_T / 2
  const parts = [box(PARAPET_T, PARAPET_H, half * 2, x, 0, 0, 'sandstone')]
  const step = 2.4
  for (let z = -half + step / 2; z < half; z += step)
    parts.push(box(PARAPET_T, 0.45, 1.2, x, PARAPET_H, z, 'ochre'))
  return parts
}

/** The city's blocks across the plain: low boxes, a few taller ones, nearer ones a little sparser. */
function city(edge: number, drop: number, rand: () => number) {
  const foot = edge - SLOPE_RUN
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < BLOCKS; i++) {
    // more of them near: the haze takes the far ones
    const out = CITY_FROM + Math.pow(rand(), 1.4) * (CITY_TO - CITY_FROM)
    const x = foot - out
    const z = (rand() * 2 - 1) * CITY_HALF_WIDTH
    const tall = rand() < 0.05
    const h = tall ? 10 + rand() * 8 : 2.5 + rand() * 4.5
    const w = 5 + rand() * 7
    const d = 5 + rand() * 7
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(x, -drop + h / 2, z)
    parts.push(bakeHex(g, TINTS[Math.floor(rand() * TINTS.length)]!))
  }
  return merge(parts)
}

/**
 * The view west from a ridge whose edge runs along x = `edge`: the parapet on the edge (z from -`half` to
 * `half`, the district's side), and the slope falling `drop` metres to the plain, the city spread over it, as
 * far north and south as the ground on the ridge reaches (`reach`).
 */
export function buildCityBelow(edge: number, half: number, drop = 60, reach = 250): THREE.Group {
  const rand = seeded(4021)
  const ground = new THREE.MeshLambertMaterial({ vertexColors: true })
  thinFog(ground)
  const land = new THREE.Mesh(
    merge([slope(edge, drop, reach, rand), plain(edge, drop, reach), ...parapet(edge, half)]),
    ground,
  )
  land.name = 'city-below-land'
  land.receiveShadow = true

  const lights = new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: '#FFB86B',
    emissiveIntensity: 0,
  })
  thinFog(lights)
  lights.userData.nightGlow = 0.35 // the city's lights come on after dark; `applySky` turns them up
  const blocks = new THREE.Mesh(city(edge, drop, rand), lights)
  blocks.name = 'city-below-blocks'

  const group = new THREE.Group()
  group.name = 'city-below'
  group.add(land, blocks)
  return group
}
