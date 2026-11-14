import * as THREE from 'three'
import type { Stage } from '../engine/stage'
import type { AqiBand, CitySnapshot } from '../net/protocol'
import type { District } from '../world/district'

export interface SkyParams {
  sunElevationDeg: number
  /** Compass bearing: 90 is east, 180 south, 270 west. */
  sunAzimuthDeg: number
  skyTop: string
  skyHorizon: string
  fogDensity: number
  sunIntensity: number
  ambientIntensity: number
  /** Lamps, tapri bulbs and each district's floodlit landmark (materials tagged `nightGlow`). */
  nightLights: boolean
  rain: boolean
  dust: boolean
}

const MAX_ELEVATION = 70
const BELOW_HORIZON = -10
const LIGHTS_MARGIN_MS = 20 * 60 * 1000
const FOG: Record<AqiBand, number> = {
  good: 0.004,
  moderate: 0.008,
  poor: 0.014,
  unhealthy: 0.02,
  severe: 0.03,
}
const FOG_WEATHER = 1.6
const RAIN_DARKEN = 0.65
const DUST_HORIZON = '#d9b98c'

const DAY_TOP = new THREE.Color('#6FA6D2')
const DAY_HORIZON = new THREE.Color('#BFD6DE')
const GOLD_TOP = new THREE.Color('#6C7FB0')
const GOLD_HORIZON = new THREE.Color('#F2B27C')
const NIGHT_TOP = new THREE.Color('#0A1030')
const NIGHT_HORIZON = new THREE.Color('#2B2F58')

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return k * k * (3 - 2 * k)
}

/** The sky from the snapshot and an instant. Works in instants, so the device's own timezone never matters. */
export function skyParams(s: CitySnapshot, now: Date): SkyParams {
  const rise = Date.parse(s.sunrise)
  const set = Date.parse(s.sunset)
  const t = now.getTime()
  const p = (t - rise) / (set - rise)
  const up = p >= 0 && p <= 1
  const elevation = up ? Math.sin(Math.PI * p) * MAX_ELEVATION : BELOW_HORIZON
  const azimuth = 90 + 180 * Math.min(Math.max(p, 0), 1)

  // 0 at night, 1 in full daylight; golden hour is the band between.
  const day = smooth(-6, 16, elevation)
  const gold = Math.max(0, 1 - Math.abs(elevation - 4) / 14) // peaks at sunrise/sunset
  const rain = s.condition === 'rain' || s.condition === 'storm'
  const dust = s.condition === 'dust'

  const top = NIGHT_TOP.clone()
    .lerp(DAY_TOP, day)
    .lerp(GOLD_TOP, gold * 0.7)
  const horizon = NIGHT_HORIZON.clone()
    .lerp(DAY_HORIZON, day)
    .lerp(GOLD_HORIZON, gold * 0.85)
  if (dust) horizon.set(DUST_HORIZON).multiplyScalar(0.25 + 0.75 * day)
  if (rain) {
    top.multiplyScalar(RAIN_DARKEN)
    horizon.multiplyScalar(RAIN_DARKEN)
  }

  const dim = rain ? 0.35 : s.condition === 'cloudy' || s.condition === 'fog' ? 0.55 : dust ? 0.7 : 1
  return {
    sunElevationDeg: elevation,
    sunAzimuthDeg: azimuth,
    skyTop: `#${top.getHexString()}`,
    skyHorizon: `#${horizon.getHexString()}`,
    fogDensity: FOG[s.aqiBand] * (s.condition === 'fog' ? FOG_WEATHER : 1),
    sunIntensity: 0.25 + 1.95 * day * dim, // the 0.25 is moonlight
    ambientIntensity: 0.5 + 1.1 * day * (0.7 + 0.3 * dim),
    nightLights: t < rise + LIGHTS_MARGIN_MS || t > set - LIGHTS_MARGIN_MS,
    rain,
    dust,
  }
}

/** Per-scene paint: a vertical gradient canvas for the backdrop, reused between updates. */
interface Backdrop {
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
}
const backdrops = new WeakMap<THREE.Scene, Backdrop>()
/** Materials tagged with `userData.nightGlow` (their emissive intensity after dark), per district. */
const glowers = new WeakMap<THREE.Object3D, THREE.MeshLambertMaterial[]>()

const top = new THREE.Color()
const horizon = new THREE.Color()
const white = new THREE.Color('#ffffff')
const warm = new THREE.Color('#FFB067')
const noonSun = new THREE.Color('#FFF7EE')
const moon = new THREE.Color('#9DB4F0')
const tmp = new THREE.Color()
/** Where the sun stands, in the unit sphere; the shadow box follows the player, so only the direction counts. */
const dir = new THREE.Vector3()

function paintBackdrop(scene: THREE.Scene, skyTop: string, skyHorizon: string) {
  let b = backdrops.get(scene)
  if (!b && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 128
    if (canvas.getContext('2d')) {
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      b = { canvas, texture }
      backdrops.set(scene, b)
    }
  }
  const ctx = b?.canvas.getContext('2d')
  if (!b || !ctx) {
    scene.background = horizon.set(skyHorizon).clone()
    return
  }
  const g = ctx.createLinearGradient(0, 0, 0, b.canvas.height)
  g.addColorStop(0, skyTop)
  g.addColorStop(0.55, skyHorizon)
  g.addColorStop(1, skyHorizon)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, b.canvas.width, b.canvas.height)
  b.texture.needsUpdate = true
  scene.background = b.texture
}

function glowMaterials(district: District): THREE.MeshLambertMaterial[] {
  let list = glowers.get(district.root)
  if (!list) {
    const found = new Set<THREE.MeshLambertMaterial>()
    district.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (!m) return
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (typeof mat.userData.nightGlow === 'number') found.add(mat as THREE.MeshLambertMaterial)
      }
    })
    list = [...found]
    glowers.set(district.root, list)
  }
  return list
}

/** Paints the sky, fog, sun, ambient light and night glow. Cheap; the caller runs it every ~30 s. */
export function applySky(stage: Stage, district: District, p: SkyParams): void {
  const { scene } = stage
  paintBackdrop(scene, p.skyTop, p.skyHorizon)
  top.set(p.skyTop)
  horizon.set(p.skyHorizon)
  if (scene.fog instanceof THREE.FogExp2) {
    scene.fog.color.copy(horizon)
    scene.fog.density = p.fogDensity
  } else {
    scene.fog = new THREE.FogExp2(horizon.clone(), p.fogDensity)
  }

  const { hemi, sun } = district.lights
  hemi.intensity = p.ambientIntensity
  hemi.color.copy(tmp.copy(horizon).lerp(white, 0.55))
  sun.intensity = p.sunIntensity
  const daylit = p.sunElevationDeg > 3
  // Moonlight comes from on high; the sun keeps its real angle, though never flatter than a long evening shadow.
  const el = THREE.MathUtils.degToRad(daylit ? Math.max(p.sunElevationDeg, 8) : 45)
  const az = THREE.MathUtils.degToRad(p.sunAzimuthDeg)
  // East is +x, south +z (Hawa Mahal's face), so noon sunlight falls on the facade.
  dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
  sun.position.copy(sun.target.position).addScaledVector(dir, 80)
  sun.color.copy(daylit ? noonSun : moon).lerp(warm, daylit ? Math.max(0, 1 - p.sunElevationDeg / 25) : 0)

  for (const m of glowMaterials(district)) {
    m.emissiveIntensity = p.nightLights ? (m.userData.nightGlow as number) : 0
  }
}
