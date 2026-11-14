import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { DistrictId } from '../net/protocol'
import { DISTRICTS, loadDistrict, type District } from './district'
import { footprint } from './kit'
import { CAST } from './cast'
import { DISTRICT_NAMES } from './districtNames'
import { TOTAL_STAMPS } from './stamps'
import type { AABB, LandmarkDef, Vec2 } from './types'

const PLAYER_RADIUS = 0.4

const loaded = new Map<DistrictId, Promise<District>>()
/** Building a district takes a moment; the read-only tests share one copy each. */
const load = (id: DistrictId) => {
  if (!loaded.has(id)) loaded.set(id, loadDistrict(id))
  return loaded.get(id)!
}

const blockedBy = (colliders: AABB[]) => (p: Vec2) =>
  colliders.some(
    (c) =>
      p.x > c.minX - PLAYER_RADIUS &&
      p.x < c.maxX + PLAYER_RADIUS &&
      p.z > c.minZ - PLAYER_RADIUS &&
      p.z < c.maxZ + PLAYER_RADIUS,
  )

/** Some point on the landmark's trigger ring is free, so the player can reach it. */
function ringHasOpening(l: LandmarkDef, colliders: AABB[]): boolean {
  const blocked = blockedBy(colliders)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    if (!blocked({ x: l.at.x + l.radius * Math.cos(a), z: l.at.z + l.radius * Math.sin(a) })) return true
  }
  return false
}

const intersects = (a: AABB, b: AABB) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ

const triangles = (o: THREE.Object3D) => {
  let n = 0
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return
    const g = m.geometry as THREE.BufferGeometry
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3
  })
  return n
}

describe('districts', () => {
  it.each(DISTRICTS)('%s: spawn, station and landmarks are walkable', async (id) => {
    const d = await load(id)
    const blocked = blockedBy(d.colliders)
    expect(blocked(d.def.spawn)).toBe(false)
    expect(blocked(d.def.station)).toBe(false)
    for (const l of d.def.landmarks) expect(ringHasOpening(l, d.colliders), l.id).toBe(true)
  })

  it.each(DISTRICTS)('%s: landmark ids are unique and texts bilingual', async (id) => {
    const all = await Promise.all(DISTRICTS.map(load))
    const ids = all.flatMap((d) => d.def.landmarks.map((l) => l.id))
    expect(new Set(ids).size).toBe(ids.length)
    const d = await load(id)
    for (const text of [d.def.name, ...d.def.landmarks.flatMap((l) => [l.name, l.story])]) {
      expect(text.hi.trim()).not.toBe('')
      expect(text.en.trim()).not.toBe('')
    }
  })

  it.each(DISTRICTS)('%s: buildings do not overlap landmarks', async (id) => {
    const d = await load(id)
    for (const b of d.def.buildings) {
      for (const l of d.def.landmarks)
        expect(intersects(footprint(b), l.footprint), `${l.id} ${b.x},${b.z}`).toBe(false)
    }
  })

  it.each(DISTRICTS)('%s: buildings do not overlap each other and stay inside the district', async (id) => {
    const d = await load(id)
    const half = d.def.size / 2
    const boxes = d.def.buildings.map(footprint)
    boxes.forEach((a, i) => {
      expect(
        a.minX >= -half && a.maxX <= half && a.minZ >= -half && a.maxZ <= half,
        `${a.minX},${a.minZ}`,
      ).toBe(true)
      for (const b of boxes.slice(i + 1)) expect(intersects(a, b), `${a.minX},${a.minZ}`).toBe(false)
    })
  })

  it.each(DISTRICTS)('%s: props stand clear of buildings and landmarks', async (id) => {
    const d = await load(id)
    const solid = [...d.def.buildings.map(footprint), ...d.def.landmarks.map((l) => l.footprint)]
    for (const p of d.def.props) expect(blockedBy(solid)(p.at), `${p.kind} ${p.at.x},${p.at.z}`).toBe(false)
  })

  it.each(DISTRICTS)('%s: an outer boundary keeps the player in', async (id) => {
    const d = await load(id)
    const blocked = blockedBy(d.colliders)
    const edge = d.def.size / 2 + 1
    for (const p of [
      { x: edge, z: 0 },
      { x: -edge, z: 0 },
      { x: 0, z: edge },
      { x: 0, z: -edge },
    ])
      expect(blocked(p)).toBe(true)
  })

  it.each(DISTRICTS)('%s: draws in under 150 calls, lit by one hemisphere light and one sun', async (id) => {
    const d = await load(id)
    let calls = 0
    const lights: string[] = []
    d.root.traverse((o) => {
      if (o instanceof THREE.Mesh) calls += Array.isArray(o.material) ? o.material.length : 1
      if (o instanceof THREE.Light) lights.push(o.type)
    })
    expect(calls).toBeLessThan(150)
    expect(lights.sort()).toEqual(['DirectionalLight', 'HemisphereLight'])
    expect(d.lights.sun).toBeInstanceOf(THREE.DirectionalLight)
    expect(d.lights.hemi).toBeInstanceOf(THREE.HemisphereLight)
  })

  it('rejects a district that does not exist', async () => {
    await expect(loadDistrict('atlantis' as DistrictId)).rejects.toThrow(/atlantis/)
  })
})

/** Every mesh material in the model, flattened. */
const materials = (o: THREE.Object3D) => {
  const out: THREE.Material[] = []
  o.traverse((m) => {
    if (m instanceof THREE.Mesh) out.push(...(Array.isArray(m.material) ? m.material : [m.material]))
  })
  return out
}

describe('the city', () => {
  it('has all four districts', () => {
    expect(DISTRICTS).toEqual(['walled-city', 'mi-road', 'university', 'malviya-nagar'])
  })

  it('landmark count across districts is 9', async () => {
    const all = await Promise.all(DISTRICTS.map(load))
    expect(all.reduce((n, d) => n + d.def.landmarks.length, 0)).toBe(TOTAL_STAMPS)
    expect(TOTAL_STAMPS).toBe(9)
  })

  it.each(DISTRICTS)('%s: names itself the way the metro lists it', async (id) => {
    expect((await load(id)).def.name).toEqual(DISTRICT_NAMES[id])
  })

  it.each(DISTRICTS)('%s: every landmark model is under 8k triangles', async (id) => {
    for (const l of (await load(id)).def.landmarks)
      expect(triangles(await l.build()), l.id).toBeLessThan(8000)
  })

  it.each(DISTRICTS)('%s: has a metro entrance by its station', async (id) => {
    const d = await load(id)
    const entrances = d.def.props.filter((p) => p.kind === 'station')
    expect(entrances).toHaveLength(1)
    const at = entrances[0]!.at
    expect(Math.hypot(at.x - d.def.station.x, at.z - d.def.station.z)).toBeLessThan(4)
  })

  it.each(DISTRICTS)('%s: its signature landmark is floodlit after dark', async (id) => {
    const d = await load(id)
    const lit = d.def.landmarks.filter((l) => materials(d.root.getObjectByName(l.id)!).some(glows))
    expect(lit.length).toBeGreaterThanOrEqual(1)
  })

  it.each(DISTRICTS)(
    '%s: its centre, where festivals gather, is a public place, not a building',
    async (id) => {
      const d = await load(id)
      const half = d.def.size / 2
      expect(Math.abs(d.def.centre.x)).toBeLessThan(half)
      expect(Math.abs(d.def.centre.z)).toBeLessThan(half)
      expect(blockedBy(d.def.buildings.map(footprint))(d.def.centre)).toBe(false)
    },
  )

  it('every character walks in exactly one district', async () => {
    const all = await Promise.all(DISTRICTS.map(load))
    const ids = all.flatMap((d) => d.def.npcs.map((n) => n.id)).sort()
    expect(ids).toEqual(Object.keys(CAST).sort())
  })
})

const glows = (m: THREE.Material) => typeof m.userData.nightGlow === 'number'

describe('district lifecycle', () => {
  it('lets the camera pull in front of buildings and landmarks, not props', async () => {
    const d = await load('walled-city')
    expect(d.occluders.length).toBe(d.def.buildings.length + d.def.landmarks.length)
    expect(d.occluders).toEqual(expect.arrayContaining(d.def.landmarks.map((l) => l.footprint)))
    expect(d.colliders).toEqual(expect.arrayContaining(d.occluders))
  })

  it('keeps the sun shadow box on the player without changing the sun direction', async () => {
    const d = await loadDistrict('walled-city')
    const { sun } = d.lights
    const dir = sun.position.clone().sub(sun.target.position)
    d.focus({ x: 30, z: -40 })
    expect(sun.target.position.x).toBe(30)
    expect(sun.target.position.z).toBe(-40)
    expect(sun.position.clone().sub(sun.target.position).distanceTo(dir)).toBeCloseTo(0)
    d.dispose()
  })

  it('frees every geometry and material on dispose', async () => {
    const d = await loadDistrict('walled-city')
    const spies: ReturnType<typeof vi.fn>[] = []
    d.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      const g = o.geometry as THREE.BufferGeometry
      const m = o.material as THREE.Material
      spies.push(vi.spyOn(g, 'dispose') as never, vi.spyOn(m, 'dispose') as never)
    })
    expect(spies.length).toBeGreaterThan(0)
    d.dispose()
    for (const s of spies) expect(s).toHaveBeenCalled()
  })
})

describe('the Walled City', () => {
  it('is the Pink City, with its four landmarks', async () => {
    const d = await load('walled-city')
    expect(d.def.name).toEqual({ hi: 'Gulabi Shahar', en: 'Pink City' })
    expect(d.def.size).toBe(240)
    expect(d.def.landmarks.map((l) => l.id).sort()).toEqual([
      'badi-chaupar',
      'hawa-mahal',
      'jantar-mantar',
      'tripolia-gate',
    ])
  })

  it('places the landmarks the way the city is laid out', async () => {
    const d = await load('walled-city')
    const at = (id: string) => d.def.landmarks.find((l) => l.id === id)!.at
    expect(at('badi-chaupar')).toEqual({ x: 0, z: 0 }) // the Chaupar is the origin; north is -z
    expect(at('hawa-mahal').x).toBeGreaterThan(0)
    expect(at('hawa-mahal').z).toBeLessThan(0)
    expect(at('jantar-mantar').x).toBeLessThan(0)
    expect(at('jantar-mantar').z).toBeLessThan(0)
    expect(at('tripolia-gate').x).toBeLessThan(-80)
  })

  it('is filled with 80-120 pink havelis and shops', async () => {
    const d = await load('walled-city')
    const fill = d.def.buildings.filter((b) => b.style === 'haveli' || b.style === 'shop')
    expect(fill.length).toBeGreaterThanOrEqual(80)
    expect(fill.length).toBeLessThanOrEqual(120)
    const pink = fill.filter((b) => (b.tint ?? 'pink') === 'pink')
    expect(pink.length / fill.length).toBeGreaterThan(0.7)
    expect(d.def.buildings.some((b) => b.style === 'wall')).toBe(true)
  })

  it('has tapris, poster walls, autos, trees, lamps and a metro entrance near the Chaupar', async () => {
    const d = await load('walled-city')
    const count = (k: string) => d.def.props.filter((p) => p.kind === k).length
    expect(count('tapri')).toBeGreaterThanOrEqual(3)
    expect(count('poster-wall')).toBeGreaterThanOrEqual(2)
    expect(count('auto')).toBeGreaterThanOrEqual(1)
    expect(count('tree')).toBeGreaterThanOrEqual(1)
    expect(count('lamp')).toBeGreaterThanOrEqual(1)
    const station = d.def.props.find((p) => p.kind === 'station')!
    expect(Math.hypot(station.at.x, station.at.z)).toBeLessThan(25)
    expect(Math.hypot(station.at.x - d.def.station.x, station.at.z - d.def.station.z)).toBeLessThan(4)
  })

  it('builds Hawa Mahal under 8k triangles', async () => {
    const d = await load('walled-city')
    const hawa = d.def.landmarks.find((l) => l.id === 'hawa-mahal')!
    const n = triangles(await hawa.build())
    expect(n).toBeGreaterThan(1500) // the signature model: a honeycomb, not a box
    expect(n).toBeLessThan(8000)
  })
})

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort()
const share = <T>(xs: T[], test: (x: T) => boolean) => xs.filter(test).length / xs.length

describe('MI Road', () => {
  it('is MI Road–Raja Park, with Albert Hall in Ram Niwas Bagh behind its gate', async () => {
    const d = await load('mi-road')
    expect(d.def.name).toEqual({ hi: 'MI Road–Raja Park', en: 'MI Road & Raja Park' })
    expect(d.def.size).toBe(200)
    expect(ids(d.def.landmarks)).toEqual(['albert-hall', 'ram-niwas-gate'])
    const at = (id: string) => d.def.landmarks.find((l) => l.id === id)!.at
    // from the gate on MI Road you look north (up the screen) along the garden to the hall
    expect(at('albert-hall').z).toBeLessThan(at('ram-niwas-gate').z - 30)
    expect(Math.abs(at('albert-hall').x - at('ram-niwas-gate').x)).toBeLessThan(2)
  })

  it('is ochre and sandstone more than pink, with a long shop-lined road and cafés', async () => {
    const d = await load('mi-road')
    const fill = d.def.buildings.filter((b) => b.style !== 'wall')
    expect(share(fill, (b) => b.tint === 'ochre' || b.tint === 'sandstone')).toBeGreaterThan(0.6)
    expect(share(fill, (b) => (b.tint ?? 'pink') === 'pink')).toBeLessThan(0.1)
    expect(fill.filter((b) => b.style === 'shop').length).toBeGreaterThanOrEqual(30)
    expect(d.def.props.filter((p) => p.kind === 'tapri').length).toBeGreaterThanOrEqual(4)
    expect(d.def.props.filter((p) => p.kind === 'bench').length).toBeGreaterThanOrEqual(4)
  })

  it('is where Sunita ji keeps shop', async () => {
    expect(ids((await load('mi-road')).def.npcs)).toEqual(['sunita'])
  })
})

describe('University', () => {
  it('is University–JKK, with the RU gate and Jawahar Kala Kendra', async () => {
    const d = await load('university')
    expect(d.def.name).toEqual({ hi: 'University–JKK', en: 'University & JKK' })
    expect(d.def.size).toBe(200)
    expect(ids(d.def.landmarks)).toEqual(['jkk', 'university-gate'])
  })

  it('is a green campus', async () => {
    const d = await load('university')
    expect(d.def.ground).toBe('grass')
    expect(d.def.props.filter((p) => p.kind === 'tree').length).toBeGreaterThanOrEqual(30)
  })

  it('is where Kavya, Aarav and Meera spend their days', async () => {
    expect(ids((await load('university')).def.npcs)).toEqual(['aarav', 'kavya', 'meera'])
  })
})

describe('Malviya Nagar', () => {
  it('is Malviya Nagar–WTP, with World Trade Park', async () => {
    const d = await load('malviya-nagar')
    expect(d.def.name).toEqual({ hi: 'Malviya Nagar–WTP', en: 'Malviya Nagar & WTP' })
    expect(d.def.size).toBe(200)
    expect(ids(d.def.landmarks)).toEqual(['wtp'])
  })

  it('is modern blocks and coaching centres', async () => {
    const d = await load('malviya-nagar')
    const fill = d.def.buildings.filter((b) => b.style !== 'wall')
    expect(share(fill, (b) => b.style === 'modern')).toBeGreaterThan(0.5)
    expect(d.def.props.filter((p) => p.kind === 'poster-wall').length).toBeGreaterThanOrEqual(3)
  })

  it('is where Farhan and Neha live', async () => {
    expect(ids((await load('malviya-nagar')).def.npcs)).toEqual(['farhan', 'neha'])
  })
})
