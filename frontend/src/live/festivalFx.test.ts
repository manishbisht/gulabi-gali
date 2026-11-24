import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import { loadDistrict, type District } from '../world/district'
import { FLOOR_H } from '../world/kit/parts'
import type { BuildingSpec } from '../world/types'
import type { SkyParams } from './sky'
import {
  BULB_COLOURS,
  createFestivalFx,
  festivalParticleCount,
  festivalSky,
  processionCount,
  roofDiyas,
  stringBulbs,
} from './festivalFx'
import miRoad from '../world/districts/miRoad'
import { t } from '../i18n/strings'

describe('festivalParticleCount', () => {
  it('scales particles by quality tier', () => {
    expect([2, 1, 0].map((q) => festivalParticleCount('sankranti', q as 0 | 1 | 2))).toEqual([120, 60, 25])
    expect([2, 1, 0].map((q) => festivalParticleCount('holi', q as 0 | 1 | 2))).toEqual([80, 40, 15])
    // gangaur and teej throw no particles: they have a procession instead, and jlf is banner-only
    expect(festivalParticleCount('gangaur', 2)).toBe(0)
    expect(festivalParticleCount('teej', 0)).toBe(0)
    expect(festivalParticleCount('jlf', 1)).toBe(0)
    expect([2, 1, 0].map((q) => processionCount('gangaur', q as 0 | 1 | 2))).toEqual([40, 20, 8])
    expect(processionCount('teej', 1)).toBeGreaterThan(0)
    expect(processionCount('jlf', 2)).toBe(0)
  })
})

describe('festivalSky', () => {
  const sunset = '2026-11-14T12:04:00.000Z'
  const day = { nightLights: false } as SkyParams
  it('keeps diwali lights on from sunset, whatever the sky rule says', () => {
    expect(festivalSky(day, 'diwali', sunset, new Date('2026-11-14T12:04:00Z')).nightLights).toBe(true)
    expect(festivalSky(day, 'diwali', sunset, new Date('2026-11-14T15:00:00Z')).nightLights).toBe(true)
  })
  it('leaves daytime and other festivals alone', () => {
    expect(festivalSky(day, 'diwali', sunset, new Date('2026-11-14T06:00:00Z')).nightLights).toBe(false)
    expect(festivalSky(day, 'holi', sunset, new Date('2026-11-14T15:00:00Z')).nightLights).toBe(false)
    expect(festivalSky(day, null, sunset, new Date('2026-11-14T15:00:00Z')).nightLights).toBe(false)
  })
})

describe('roofDiyas', () => {
  const at = (b: BuildingSpec) => roofDiyas([b], 1000)

  it('lines the parapets of havelis, shops and modern blocks alike', () => {
    const haveli = at({ x: 0, z: 0, w: 8, d: 10, floors: 3, style: 'haveli' })
    expect(haveli.length).toBeGreaterThan(0)
    expect(haveli.every((d) => Math.abs(d.y - (3 * FLOOR_H + 0.75)) < 1e-9)).toBe(true)
    expect(haveli.every((d) => Math.abs(Math.abs(d.z) - 5.01) < 1e-9)).toBe(true) // front and back edges
    const shop = at({ x: 0, z: 0, w: 8, d: 10, floors: 2, style: 'shop' })
    expect(shop.length).toBe(haveli.length)
    expect(shop[0]!.y).toBeCloseTo(2 * FLOOR_H + 0.5)
    const modern = at({ x: 0, z: 0, w: 8, d: 10, floors: 4, style: 'modern' })
    expect(modern[0]!.y).toBeCloseTo(4 * FLOOR_H + 0.35)
  })

  it('turns with the building and skips walls and temples', () => {
    const turned = at({ x: 10, z: 0, w: 8, d: 10, floors: 2, style: 'shop', rot: 90 })
    // turned 90°, the long edges run north–south, 5 m either side of x = 10
    expect(turned.every((d) => Math.abs(Math.abs(d.x - 10) - 5.01) < 1e-9)).toBe(true)
    expect(at({ x: 0, z: 0, w: 8, d: 1, floors: 2, style: 'wall' })).toEqual([])
    expect(at({ x: 0, z: 0, w: 8, d: 8, floors: 2, style: 'temple' })).toEqual([])
  })

  it('spreads a small budget over the whole district', () => {
    const row = Array.from({ length: 10 }, (_, i): BuildingSpec => ({
      x: i * 20,
      z: 0,
      w: 8,
      d: 10,
      floors: 2,
      style: 'haveli',
    }))
    const spots = roofDiyas(row, 5)
    expect(spots).toHaveLength(5)
    expect(Math.max(...spots.map((d) => d.x)) - Math.min(...spots.map((d) => d.x))).toBeGreaterThan(100)
  })
})

describe('createFestivalFx', () => {
  it('throws Holi colour around the district centre', () => {
    const scene = new THREE.Scene()
    const centre = { x: 40, z: -30 }
    const district = { def: { size: 200, buildings: [], centre } } as unknown as District
    const fx = createFestivalFx({ scene } as Stage, district)
    fx.set('holi', 2)
    fx.update(0.5)
    const puffs = scene.getObjectByName('holi-puffs') as THREE.InstancedMesh
    expect(puffs.visible).toBe(true)
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    for (let i = 0; i < puffs.count; i++) {
      p.setFromMatrixPosition((puffs.getMatrixAt(i, m), m))
      expect(Math.hypot(p.x - centre.x, p.z - centre.z)).toBeLessThan(9)
    }
    fx.dispose()
    expect(scene.getObjectByName('festival-fx')).toBeUndefined()
  })

  it('walks a procession for Gangaur and Teej, rebuilt on a tier change and gone with the festival', async () => {
    const scene = new THREE.Scene()
    const district = await loadDistrict('walled-city')
    const fx = createFestivalFx({ scene } as Stage, district)
    expect(fx.processionCount()).toBe(0)
    fx.set('gangaur', 2)
    expect(fx.processionCount()).toBe(40)
    const first = scene.getObjectByName('procession')
    fx.set('gangaur', 2) // the sky repaints now and then: the same procession keeps walking
    expect(scene.getObjectByName('procession')).toBe(first)
    fx.update(1 / 30)
    fx.set('gangaur', 0)
    expect(fx.processionCount()).toBe(8)
    fx.set('teej', 0)
    expect(scene.getObjectByName('procession-jhula')).toBeDefined()
    fx.set('holi', 2)
    expect(fx.processionCount()).toBe(0)
    expect(scene.getObjectByName('procession')).toBeUndefined()
    fx.set('teej', 1)
    fx.dispose()
    expect(scene.getObjectByName('procession')).toBeUndefined()
    district.dispose()
  })

  it('has no way to force a procession in a build without the test hooks', async () => {
    const district = await loadDistrict('walled-city')
    const fx = createFestivalFx({ scene: new THREE.Scene() } as Stage, district)
    expect(fx.forceProcession).toBeUndefined()
    fx.dispose()
  })

  it('can walk a procession under the Sankranti kites, for the all-at-once performance run', async () => {
    vi.stubEnv('VITE_TEST_HOOKS', '1')
    const scene = new THREE.Scene()
    const district = await loadDistrict('walled-city')
    const fx = createFestivalFx({ scene } as Stage, district)
    vi.unstubAllEnvs()
    fx.set('sankranti', 2)
    fx.forceProcession!('gangaur', 2)
    expect(fx.processionCount()).toBe(40)
    expect(scene.getObjectByName('kites')!.visible).toBe(true)
    fx.set('sankranti', 1) // a tier change keeps the forced procession, at the new tier's size
    expect(fx.processionCount()).toBe(20)
    fx.update(1 / 30)
    fx.forceProcession!(null, 1)
    expect(fx.processionCount()).toBe(0)
    expect(scene.getObjectByName('procession')).toBeUndefined()
    fx.dispose()
    district.dispose()
  })
})

describe('stringBulbs', () => {
  const across = { a: { x: 0, z: 0 }, b: { x: 0, z: 20 }, y: 6 }

  it('hangs a strand from end to end, sagging most in the middle and never below the camera', () => {
    const { bulbs } = stringBulbs([across])
    const ys = bulbs.map((b) => b.y)
    expect(Math.max(...ys)).toBeCloseTo(6)
    expect(Math.min(...ys)).toBeCloseTo(6 - 1.2) // a long strand sags its most
    expect(bulbs.some((b) => b.z === 0) && bulbs.some((b) => b.z === 20)).toBe(true)
    expect(bulbs.every((b) => b.x === 0)).toBe(true)
    const swag = stringBulbs([{ a: { x: 0, z: 0 }, b: { x: 8, z: 0 }, y: 6 }]).bulbs
    expect(Math.min(...swag.map((b) => b.y))).toBeCloseTo(6 - 8 * 0.08, 1) // a short one sags less
  })

  it('puts every other bulb first, for the thin tier, and gives neighbours different colours', () => {
    const { bulbs, thin } = stringBulbs([across, { ...across, a: { x: 5, z: 0 }, b: { x: 5, z: 20 } }])
    expect(thin).toBeGreaterThan(bulbs.length * 0.45)
    expect(thin).toBeLessThan(bulbs.length * 0.55)
    // the thin half still runs the whole length of each strand
    const firstHalf = bulbs.slice(0, thin).filter((b) => b.x === 0)
    expect(Math.min(...firstHalf.map((b) => b.z))).toBe(0)
    expect(Math.max(...firstHalf.map((b) => b.z))).toBe(20)
    const strand = bulbs.filter((b) => b.x === 0).sort((p, q) => p.z - q.z)
    for (let i = 1; i < strand.length; i++) expect(strand[i]!.colour).not.toBe(strand[i - 1]!.colour)
    expect(new Set(bulbs.map((b) => b.colour)).size).toBe(BULB_COLOURS.length)
  })
})

describe("MI Road's New Year lights", () => {
  /** The building whose footprint (turned as the kit turns it) a point lies on or just off, if any. */
  const tiedTo = (x: number, z: number) =>
    miRoad.buildings.find((b) => {
      const turned = b.rot === 90 || b.rot === 270
      const hw = (turned ? b.d : b.w) / 2 + 0.3
      const hd = (turned ? b.w : b.d) / 2 + 0.3
      return b.style !== 'wall' && Math.abs(x - b.x) <= hw && Math.abs(z - b.z) <= hd
    })

  /** The landmark (Ram Niwas Bagh's gate) whose footprint a point lies on or just off, if any. */
  const onLandmark = (x: number, z: number) =>
    miRoad.landmarks.find(
      ({ footprint: f }) => x >= f.minX - 0.3 && x <= f.maxX + 0.3 && z >= f.minZ - 0.3 && z <= f.maxZ + 0.3,
    )

  it('ties every strand at both ends to a shop front tall enough to hold it, or to the garden gate', () => {
    const strands = miRoad.stringLights!
    expect(strands.length).toBeGreaterThan(8)
    for (const s of strands)
      for (const end of [s.a, s.b]) {
        const b = tiedTo(end.x, end.z)
        if (b) expect(b.floors * FLOOR_H).toBeGreaterThanOrEqual(s.y)
        else expect(onLandmark(end.x, end.z)?.id, `strand end at (${end.x}, ${end.z})`).toBe('ram-niwas-gate')
      }
  })

  it('hangs high over MI Road, clear of the chase camera and the lamps', () => {
    const { bulbs } = stringBulbs(miRoad.stringLights!)
    expect(Math.min(...bulbs.map((b) => b.y))).toBeGreaterThan(5)
    expect(bulbs.length).toBeLessThan(400)
  })

  it('only MI Road hangs them', async () => {
    for (const id of ['walled-city', 'university', 'malviya-nagar', 'amer'] as const) {
      const d = await loadDistrict(id)
      expect(d.def.stringLights ?? []).toEqual([])
      d.dispose()
    }
  })

  it('greets the city in both languages, short enough for the HUD card', () => {
    for (const lang of ['hi', 'en'] as const) {
      expect(t('festivalNewYear', lang)).toMatch(/Jaipur/)
      expect(t('festivalNewYear', lang).length).toBeLessThanOrEqual(44)
    }
  })
})

describe('createFestivalFx: New Year', () => {
  const lights = (scene: THREE.Scene) => scene.getObjectByName('newyear-lights') as THREE.InstancedMesh

  it('lights MI Road on New Year, sparser on the lowest tier, and puts them away after', async () => {
    const scene = new THREE.Scene()
    const district = await loadDistrict('mi-road')
    const fx = createFestivalFx({ scene } as Stage, district, { reducedMotion: () => false })
    const all = stringBulbs(district.def.stringLights!)
    expect(lights(scene).visible).toBe(false)
    fx.set('newyear', 2)
    expect(lights(scene).visible).toBe(true)
    expect(scene.getObjectByName('newyear-wire')!.visible).toBe(true)
    expect(lights(scene).count).toBe(all.bulbs.length)
    fx.set('newyear', 0)
    expect(lights(scene).count).toBe(all.thin)
    fx.set(null, 0)
    expect(lights(scene).visible).toBe(false)
    expect(scene.getObjectByName('newyear-wire')!.visible).toBe(false)
    fx.dispose()
    expect(scene.getObjectByName('newyear-lights')).toBeUndefined()
    district.dispose()
  })

  it('makes no lights in a district that hangs none', async () => {
    const scene = new THREE.Scene()
    const district = await loadDistrict('walled-city')
    const fx = createFestivalFx({ scene } as Stage, district)
    fx.set('newyear', 2)
    fx.update(1 / 30)
    expect(scene.getObjectByName('newyear-lights')).toBeUndefined()
    fx.dispose()
    district.dispose()
  })

  it('works the twinkle out about 15 times a second, not every frame', async () => {
    const scene = new THREE.Scene()
    const district = await loadDistrict('mi-road')
    const fx = createFestivalFx({ scene } as Stage, district, { reducedMotion: () => false })
    fx.set('newyear', 2)
    const colours = lights(scene).instanceColor!
    const from = colours.version
    for (let i = 0; i < 60; i++) fx.update(1 / 60) // one second of 60 fps frames
    expect(colours.version - from).toBeGreaterThanOrEqual(12)
    expect(colours.version - from).toBeLessThanOrEqual(16)
    // the sky's repaint (every 30 s) does not flash every bulb back to full
    const mid = Array.from(colours.array)
    fx.set('newyear', 2)
    expect(Array.from(colours.array)).toEqual(mid)
    fx.dispose()
    district.dispose()
  })

  it('twinkles, writing into the same colour buffer, and holds steady under reduced motion', async () => {
    for (const reduced of [false, true]) {
      const scene = new THREE.Scene()
      const district = await loadDistrict('mi-road')
      const fx = createFestivalFx({ scene } as Stage, district, { reducedMotion: () => reduced })
      fx.set('newyear', 2)
      const colours = lights(scene).instanceColor!
      const buffer = colours.array
      const before = Array.from(buffer)
      for (let i = 0; i < 20; i++) fx.update(1 / 30)
      expect(lights(scene).instanceColor!.array).toBe(buffer)
      const after = Array.from(buffer)
      if (reduced) expect(after).toEqual(before)
      else {
        expect(after).not.toEqual(before)
        // dimmer, never brighter than the bulb's own colour
        expect(after.every((v, i) => v <= before[i]! + 1e-6)).toBe(true)
      }
      fx.dispose()
      district.dispose()
    }
  })
})
