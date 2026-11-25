import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import { DISTRICTS, loadDistrict } from '../world/district'
import { footprint } from '../world/kit'
import { FLOOR_H } from '../world/kit/parts'
import { inside } from '../world/rooftop'
import { t } from '../i18n/strings'
import { createFestivalFx, festivalParticleCount } from './festivalFx'
import { createKiteSky, cutKiteCount, FLYERS, kiteFlyerSpots, SKY_KITES } from './kites'

type Tier = 0 | 1 | 2
const TIERS: Tier[] = [0, 1, 2]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const kitesOf = (scene: THREE.Object3D) => scene.getObjectByName('kites') as THREE.InstancedMesh
const flyersOf = (scene: THREE.Object3D) => scene.getObjectByName('kite-flyers') as THREE.InstancedMesh
const stringsOf = (scene: THREE.Object3D) => scene.getObjectByName('kite-strings') as THREE.LineSegments

describe('Sankranti kite counts', () => {
  it('fills the sky by tier: thinner on the lowest, a few cut ones among them', () => {
    expect(TIERS.map((q) => festivalParticleCount('sankranti', q))).toEqual([20, 60, 120])
    expect([...SKY_KITES]).toEqual([20, 60, 120])
    expect([...FLYERS]).toEqual([2, 3, 4])
    for (const n of SKY_KITES) {
      expect(cutKiteCount(n)).toBeGreaterThan(0)
      expect(cutKiteCount(n)).toBeLessThan(n / 5)
    }
  })

  it('draws every kite in one instanced mesh, its strings in one, the flyers in one; no strings on tier 0', async () => {
    const district = await loadDistrict('walled-city')
    const scene = new THREE.Scene()
    const fx = createFestivalFx({ scene } as Stage, district, { reducedMotion: () => false })
    for (const q of TIERS) {
      fx.set('sankranti', q, true)
      const c = fx.kites()
      expect(c).toEqual({ sky: SKY_KITES[q], falling: cutKiteCount(SKY_KITES[q]), flyers: FLYERS[q] })
      expect(kitesOf(scene).count).toBe(c.sky + c.flyers)
      expect(flyersOf(scene).count).toBe(c.flyers)
      expect(stringsOf(scene).visible).toBe(q > 0)
      fx.update(1 / 20)
    }
    fx.set('holi', 2, true)
    expect(fx.kites()).toEqual({ sky: 0, falling: 0, flyers: 0 })
    expect(kitesOf(scene).visible).toBe(false)
    expect(flyersOf(scene).visible).toBe(false)
    fx.dispose()
    district.dispose()
  })
})

describe('Sankranti kites by day only', () => {
  it('are up from sunrise to sunset and away at night', async () => {
    const district = await loadDistrict('mi-road')
    const scene = new THREE.Scene()
    const fx = createFestivalFx({ scene } as Stage, district, { reducedMotion: () => false })
    fx.set('sankranti', 2, false)
    expect(fx.kites()).toEqual({ sky: 0, falling: 0, flyers: 0 })
    expect(kitesOf(scene).visible).toBe(false)
    expect(flyersOf(scene).visible).toBe(false)
    expect(stringsOf(scene).visible).toBe(false)
    fx.set('sankranti', 2, true)
    expect(fx.kites().sky).toBe(120)
    expect(kitesOf(scene).visible).toBe(true)
    // left out, it is day: a caller that knows nothing of the sun still gets the kites
    fx.set('sankranti', 1)
    expect(fx.kites().sky).toBe(60)
    fx.dispose()
    district.dispose()
  })
})

describe('createKiteSky', () => {
  const matrices = (scene: THREE.Object3D) => Array.from(kitesOf(scene).instanceMatrix.array)

  it('drifts the kites, and holds them where they are under reduced motion', async () => {
    const district = await loadDistrict('walled-city')
    for (const reduced of [false, true]) {
      const sky = createKiteSky(district.def, () => reduced)
      const scene = new THREE.Scene().add(sky.group)
      sky.set(true, 2)
      const before = matrices(scene)
      const strings = Array.from(stringsOf(scene).geometry.attributes.position!.array)
      for (let i = 0; i < 90; i++) sky.update(1 / 30)
      if (reduced) {
        expect(matrices(scene)).toEqual(before)
        expect(Array.from(stringsOf(scene).geometry.attributes.position!.array)).toEqual(strings)
      } else expect(matrices(scene)).not.toEqual(before)
      sky.dispose()
    }
    district.dispose()
  })

  it('a tier change under reduced motion still poses the kites it adds, then holds them', async () => {
    const district = await loadDistrict('walled-city')
    const sky = createKiteSky(district.def, () => true)
    const scene = new THREE.Scene().add(sky.group)
    sky.set(true, 0)
    sky.set(true, 2)
    const kites = kitesOf(scene)
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    for (let i = 0; i < kites.count; i++) {
      p.setFromMatrixPosition((kites.getMatrixAt(i, m), m))
      expect(p.y, `kite ${i}`).toBeGreaterThan(10) // none left at the origin, unposed
    }
    sky.dispose()
    district.dispose()
  })

  it('moves them at most 30 times a second, however fast the frames come', async () => {
    const district = await loadDistrict('walled-city')
    const sky = createKiteSky(district.def, () => false)
    const scene = new THREE.Scene().add(sky.group)
    sky.set(true, 2)
    const kites = kitesOf(scene)
    const from = kites.instanceMatrix.version
    for (let i = 0; i < 120; i++) sky.update(1 / 120) // one second at 120 fps
    const steps = kites.instanceMatrix.version - from
    expect(steps).toBeGreaterThanOrEqual(25)
    expect(steps).toBeLessThanOrEqual(31)
    sky.dispose()
    district.dispose()
  })

  it('lets the cut kites sink and drift, and sends them back up high once they are down', async () => {
    const district = await loadDistrict('walled-city')
    const sky = createKiteSky(district.def, () => false)
    const scene = new THREE.Scene().add(sky.group)
    sky.set(true, 2)
    const kites = kitesOf(scene)
    const m = new THREE.Matrix4()
    const at = (i: number) => new THREE.Vector3().setFromMatrixPosition((kites.getMatrixAt(i, m), m))
    const cut = 7 // the last of the first run of eight
    const start = at(cut)
    sky.update(1)
    sky.update(0.25)
    expect(at(cut).y).toBeLessThan(start.y)
    // a cut kite falls from at most 70 m at 1.6 m/s, down to 14 m: in under 40 s it is back up high
    let respawned = false
    let last = at(cut).y
    for (let i = 0; i < 200 && !respawned; i++) {
      sky.update(0.25)
      const y = at(cut).y
      if (y > last + 20) respawned = true
      last = y
    }
    expect(respawned).toBe(true)
    expect(last).toBeGreaterThanOrEqual(60)
    sky.dispose()
    district.dispose()
  })

  it('allocates nothing per frame: the same buffers, no new arrays, matrices or vectors', async () => {
    const district = await loadDistrict('walled-city')
    const sky = createKiteSky(district.def, () => false)
    const scene = new THREE.Scene().add(sky.group)
    sky.set(true, 2)
    const kites = kitesOf(scene)
    const matrixBuffer = kites.instanceMatrix.array
    const stringBuffer = stringsOf(scene).geometry.attributes.position!.array
    sky.update(1 / 30) // warm
    let made = 0
    const counting = <T extends object>(C: T): T =>
      new Proxy(C, {
        construct(target, args, nt) {
          made++
          return Reflect.construct(target as never, args, nt)
        },
      })
    vi.stubGlobal('Float32Array', counting(Float32Array))
    vi.stubGlobal('Array', counting(Array))
    const clones = [
      vi.spyOn(THREE.Matrix4.prototype, 'clone'),
      vi.spyOn(THREE.Vector3.prototype, 'clone'),
      vi.spyOn(THREE.Quaternion.prototype, 'clone'),
      vi.spyOn(THREE.Euler.prototype, 'clone'),
      vi.spyOn(THREE.Color.prototype, 'clone'),
    ]
    for (let i = 0; i < 120; i++) sky.update(1 / 30)
    vi.unstubAllGlobals()
    expect(made).toBe(0)
    for (const c of clones) expect(c).not.toHaveBeenCalled()
    expect(kites.instanceMatrix.array).toBe(matrixBuffer)
    expect(stringsOf(scene).geometry.attributes.position!.array).toBe(stringBuffer)
    sky.dispose()
    district.dispose()
  })

  it('is gone with the district: out of the scene, its meshes, geometries and materials disposed', async () => {
    const district = await loadDistrict('walled-city')
    const scene = new THREE.Scene()
    const fx = createFestivalFx({ scene } as Stage, district, { reducedMotion: () => false })
    fx.set('sankranti', 2, true)
    const disposed: string[] = []
    const watch = (name: string, o: THREE.EventDispatcher<{ dispose: object }>) =>
      o.addEventListener('dispose', () => disposed.push(name))
    const kites = kitesOf(scene)
    const flyers = flyersOf(scene)
    const strings = stringsOf(scene)
    watch('kites', kites)
    watch('flyers', flyers)
    watch('kite geometry', kites.geometry)
    watch('kite material', kites.material as THREE.Material)
    watch('flyer geometry', flyers.geometry)
    watch('flyer material', flyers.material as THREE.Material)
    watch('string geometry', strings.geometry)
    watch('string material', strings.material as THREE.Material)
    fx.dispose()
    expect(disposed.sort()).toEqual(
      [
        'flyer geometry',
        'flyer material',
        'flyers',
        'kite geometry',
        'kite material',
        'kites',
        'string geometry',
        'string material',
      ].sort(),
    )
    expect(scene.getObjectByName('sankranti')).toBeUndefined()
    expect(scene.getObjectByName('kites')).toBeUndefined()
    district.dispose()
  })

  it("ties each flyer's string to their raised hand", async () => {
    const district = await loadDistrict('university')
    const spots = kiteFlyerSpots(district.def)
    const sky = createKiteSky(district.def, () => true)
    const scene = new THREE.Scene().add(sky.group)
    sky.set(true, 2)
    const pos = stringsOf(scene).geometry.attributes.position!.array
    spots.forEach((f, j) => {
      const o = (SKY_KITES[2] + j) * 6 + 3 // the string's far end, after the sky's kites
      expect(pos[o]).toBeCloseTo(f.hand.x, 4)
      expect(pos[o + 1]).toBeCloseTo(f.hand.y, 4)
      expect(pos[o + 2]).toBeCloseTo(f.hand.z, 4)
      // the kite flies well above the roof, downwind
      expect(f.kite.y - f.y).toBeGreaterThan(12)
      expect(f.kite.x).toBeGreaterThan(f.x)
    })
    sky.dispose()
    district.dispose()
  })
})

describe('kiteFlyerSpots', () => {
  it.each(DISTRICTS)(
    'puts four flyers on flat roofs near the viewpoint in %s, never on it or by each other',
    async (id) => {
      const district = await loadDistrict(id)
      const def = district.def
      const spots = kiteFlyerSpots(def)
      expect(spots.length).toBe(FLYERS[2])
      for (const f of spots) {
        const b = def.buildings.find((s) => inside(f, footprint(s), -0.3))
        expect(b, `flyer at ${f.x}, ${f.z}`).toBeDefined()
        expect(['haveli', 'shop', 'modern']).toContain(b!.style)
        // standing on the roof itself, not floating or sunk into it
        expect(f.y).toBeGreaterThanOrEqual(b!.floors * FLOOR_H)
        expect(f.y).toBeLessThanOrEqual(b!.floors * FLOOR_H + 0.5)
        // never on the viewpoint's own building, nor its strip
        if (def.roof) {
          expect(inside(f, def.roof.building)).toBe(false)
          expect(inside(f, def.roof.area, 1)).toBe(false)
        }
      }
      for (let i = 0; i < spots.length; i++)
        for (let j = i + 1; j < spots.length; j++)
          expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z)).toBeGreaterThan(4)
      expect(kiteFlyerSpots(def, 2)).toEqual(spots.slice(0, 2))
      district.dispose()
    },
  )
})

describe("Sankranti's HUD line", () => {
  it('greets, and points at the roof and the kite under it, in both languages, short enough for the card', () => {
    expect(t('festivalSankrantiLine', 'hi')).toMatch(/Chhat/)
    expect(t('festivalSankrantiLine', 'hi')).toMatch(/patang/i)
    expect(t('festivalSankrantiLine', 'en')).toMatch(/roof/)
    expect(t('festivalSankrantiLine', 'en')).toMatch(/kite/)
    for (const lang of ['hi', 'en'] as const) {
      expect(t('festivalSankranti', lang)).toMatch(/Sankranti/)
      // one line each on a 360 px phone (hud.spec.ts measures them)
      expect(t('festivalSankranti', lang).length).toBeLessThanOrEqual(30)
      expect(t('festivalSankrantiLine', lang).length).toBeLessThanOrEqual(30)
      // another region's own catchphrase is not Jaipur's
      for (const k of ['festivalSankranti', 'festivalSankrantiLine'] as const)
        expect(t(k, lang)).not.toMatch(/kai po/i)
    }
  })
})
