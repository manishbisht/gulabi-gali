import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { DistrictId } from '../net/protocol'
import { DISTRICTS, loadDistrict, type District } from './district'
import { footprint } from './kit'
import { CAST } from './cast'
import { DISTRICT_NAMES } from './districtNames'
import { byBus } from './metroRide'
import { roofHeight } from './rooftop'
import { STAMPS, TOTAL_STAMPS } from './stamps'
import BENCHES from './benches.json'
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
const grownBy = (a: AABB, m: number): AABB => ({
  minX: a.minX - m,
  maxX: a.maxX + m,
  minZ: a.minZ - m,
  maxZ: a.maxZ + m,
})
const inside = (p: Vec2, a: AABB) => p.x > a.minX && p.x < a.maxX && p.z > a.minZ && p.z < a.maxZ

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
  it('has all six districts', () => {
    expect(DISTRICTS).toEqual(['walled-city', 'mi-road', 'university', 'malviya-nagar', 'amer', 'nahargarh'])
  })

  it('landmark count across districts is 13', async () => {
    const all = await Promise.all(DISTRICTS.map(load))
    expect(all.reduce((n, d) => n + d.def.landmarks.length, 0)).toBe(TOTAL_STAMPS)
    expect(TOTAL_STAMPS).toBe(13)
  })

  it('the stamp list (stamps.json, which the server checks ids against) is every landmark, by its own name', async () => {
    const all = await Promise.all(DISTRICTS.map(load))
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)
    const landmarks = all.flatMap((d) => d.def.landmarks.map((l) => ({ id: l.id, ...l.name })))
    // in the order stamps were added (new ones go last, so a stored list keeps its meaning), not district order
    expect([...STAMPS].sort(byId)).toEqual(landmarks.sort(byId))
    // the order itself is pinned: a stored list (and the server's) keeps its meaning only if nothing moves
    expect(STAMPS.map((s) => s.id)).toEqual([
      'hawa-mahal',
      'jantar-mantar',
      'tripolia-gate',
      'badi-chaupar',
      'albert-hall',
      'ram-niwas-gate',
      'university-gate',
      'jkk',
      'wtp',
      'amer-fort',
      'nahargarh-fort',
      'jal-mahal',
      'city-palace',
    ])
  })

  it.each(DISTRICTS)('%s: names itself the way the metro lists it', async (id) => {
    expect((await load(id)).def.name).toEqual(DISTRICT_NAMES[id])
  })

  it.each(DISTRICTS)('%s: every landmark model is under 8k triangles', async (id) => {
    for (const l of (await load(id)).def.landmarks)
      expect(triangles(await l.build()), l.id).toBeLessThan(8000)
  })

  it.each(DISTRICTS)(
    '%s: has a metro entrance (Amer and Nahargarh: a bus stand, they have no metro) by its station',
    async (id) => {
      const d = await load(id)
      const kind = byBus(id) ? 'bus-stop' : 'station'
      expect(d.def.props.filter((p) => p.kind === (byBus(id) ? 'station' : 'bus-stop'))).toHaveLength(0)
      const entrances = d.def.props.filter((p) => p.kind === kind)
      expect(entrances).toHaveLength(1)
      const at = entrances[0]!.at
      expect(Math.hypot(at.x - d.def.station.x, at.z - d.def.station.z)).toBeLessThan(4)
    },
  )

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
  it('is the Pink City, with its five landmarks', async () => {
    const d = await load('walled-city')
    expect(d.def.name).toEqual({ hi: 'Gulabi Shahar', en: 'Pink City' })
    expect(d.def.size).toBe(240)
    expect(d.def.landmarks.map((l) => l.id).sort()).toEqual([
      'badi-chaupar',
      'city-palace',
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
    // the City Palace's precinct lies north of Jantar Mantar and of Tripolia, its royal gate on the bazaar
    const palace = d.def.landmarks.find((l) => l.id === 'city-palace')!.footprint
    const jantar = d.def.landmarks.find((l) => l.id === 'jantar-mantar')!.footprint
    expect(palace.maxZ).toBeLessThan(jantar.minZ - 20)
    expect(palace.minX).toBeLessThan(at('jantar-mantar').x)
    expect(palace.maxX).toBeGreaterThan(at('jantar-mantar').x)
    expect(palace.minX).toBeLessThan(at('tripolia-gate').x + 5)
  })

  it('has the City Palace: a walled precinct you walk up to, its card at the courtyard gateway', async () => {
    const d = await load('walled-city')
    const palace = d.def.landmarks.find((l) => l.id === 'city-palace')!
    const f = palace.footprint
    // the ring is outside the gateway in the middle of the front (south) wall, on open ground
    expect(palace.at.z).toBeGreaterThan(f.maxZ)
    expect(palace.at.z - f.maxZ).toBeLessThan(palace.radius)
    expect(Math.abs(palace.at.x - (f.minX + f.maxX) / 2)).toBeLessThan(1)
    expect(blockedBy(d.colliders)(palace.at)).toBe(false)
    // Chandra Mahal rises well over the havelis round it (four storeys at most), seen over the precinct wall
    const box = new THREE.Box3().setFromObject(await palace.build())
    expect(box.max.y).toBeGreaterThan(20)
    // and the model keeps to its footprint
    expect(box.min.x).toBeGreaterThanOrEqual(f.minX - 0.01)
    expect(box.max.x).toBeLessThanOrEqual(f.maxX + 0.01)
    expect(box.min.z).toBeGreaterThanOrEqual(f.minZ - 0.01)
    expect(box.max.z).toBeLessThanOrEqual(f.maxZ + 0.01)
  })

  it("leaves the bazaars, the procession's loop and every character's walk where they were", async () => {
    const d = await load('walled-city')
    const palace = grownBy(d.def.landmarks.find((l) => l.id === 'city-palace')!.footprint, 1.3)
    for (const p of d.def.processionRoute) expect(inside(p, palace)).toBe(false)
    for (const n of d.def.npcs) for (const p of n.route) expect(inside(p, palace), n.id).toBe(false)
    for (const p of d.def.props) expect(inside(p.at, palace), `${p.kind} ${p.at.x},${p.at.z}`).toBe(false)
    for (const p of d.def.paving.filter((q) => q.color === 'road')) expect(intersects(p, palace)).toBe(false)
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

describe('Amer', () => {
  it('is Amer, with the fort on its hill', async () => {
    const d = await load('amer')
    expect(d.def.name).toEqual({ hi: 'Amer', en: 'Amer' })
    expect(d.def.size).toBe(200)
    expect(ids(d.def.landmarks)).toEqual(['amer-fort', 'jal-mahal'])
    // the hill rises north of the road, and the fort stands up on it, well above the street
    const fort = d.def.landmarks.find((l) => l.id === 'amer-fort')!
    const model = await fort.build()
    const box = new THREE.Box3().setFromObject(model)
    expect(box.max.y).toBeGreaterThan(18)
    expect(fort.footprint.maxZ).toBeLessThan(d.def.spawn.z - 40)
  })

  it('has the lake below the fort: water nobody walks into, between the road and the hill', async () => {
    const d = await load('amer')
    const lake = d.def.water!
    expect(lake).toHaveLength(4) // Maota below the fort; Man Sagar on the city side, in three boxes round its ghat
    const [w] = lake
    expect(d.colliders).toContainEqual(w)
    const fort = d.def.landmarks[0]!.footprint
    expect(w!.maxZ).toBeLessThan(d.def.spawn.z) // south of it, the road
    expect(w!.minZ).toBeGreaterThanOrEqual(fort.maxZ) // north of it, the hill
    // the water drawn is inside the water you cannot walk into, and nothing is built on it
    const water = d.def.paving.find((p) => p.color === 'glass')!
    expect(
      water.minX >= w!.minX && water.maxX <= w!.maxX && water.minZ >= w!.minZ && water.maxZ <= w!.maxZ,
    ).toBe(true)
    for (const b of d.def.buildings) expect(intersects(footprint(b), water), `${b.x},${b.z}`).toBe(false)
  })

  it('leaves no odd walkable strip round the lake: it meets the hill on the north and the rampart on the south', async () => {
    const d = await load('amer')
    const blocked = blockedBy(d.colliders)
    const water = d.def.paving.find((p) => p.color === 'glass')!
    const fort = d.def.landmarks[0]!.footprint
    const rampart = Math.min(
      ...d.def.buildings.filter((b) => b.style === 'wall').map((b) => footprint(b).minZ),
    )
    for (let x = water.minX + 0.5; x <= water.maxX - 0.5; x += 0.5) {
      // the lane west of the lake runs on past the hill's corner
      if (x > fort.minX + 0.5)
        for (let z = fort.maxZ; z <= water.minZ; z += 0.25)
          expect(blocked({ x, z }), `north of the water at ${x},${z}`).toBe(true)
      for (let z = water.maxZ; z <= rampart + 1.2; z += 0.25)
        expect(blocked({ x, z }), `south of the water at ${x},${z}`).toBe(true)
    }
  })

  it('has no metro: a bus stand by the road, stalls along the way up, and benches', async () => {
    const d = await load('amer')
    const count = (k: string) => d.def.props.filter((p) => p.kind === k).length
    expect(count('station')).toBe(0)
    expect(count('bus-stop')).toBe(1)
    expect(count('tapri')).toBeGreaterThanOrEqual(3)
    expect(count('bench')).toBeGreaterThanOrEqual(2)
    expect(count('poster-wall')).toBeGreaterThanOrEqual(1)
    expect(count('auto')).toBeGreaterThanOrEqual(2)
  })

  it('has a rampart viewpoint that looks across the lake at the fort', async () => {
    const d = await load('amer')
    const roof = d.def.roof!
    const [lake] = d.def.water!
    const fort = d.def.landmarks[0]!
    expect(roof.y).toBeGreaterThan(8)
    expect(roofHeight(roof, roof.landing.x, roof.landing.z)).toBe(roof.y)
    // turned to the fort up on its hill, with the lake in between: the line of sight crosses the water
    const f = fort.footprint
    expect(roof.view.x > f.minX && roof.view.x < f.maxX && roof.view.z > f.minZ && roof.view.z < f.maxZ).toBe(
      true,
    )
    const mid = { x: (roof.landing.x + roof.view.x) / 2, z: (roof.landing.z + roof.view.z) / 2 }
    expect(
      mid.x > lake!.minX && mid.x < lake!.maxX && mid.z > lake!.minZ && mid.z < lake!.maxZ,
      `${mid.x},${mid.z}`,
    ).toBe(true)
  })

  it('is where Gopal ji and Shabnam spend their days', async () => {
    expect(ids((await load('amer')).def.npcs)).toEqual(['gopal', 'shabnam'])
  })
})

describe('Man Sagar and Jal Mahal (Amer, on the city side of the road)', () => {
  /** Man Sagar's water: every box after Maota's, round the ghat. */
  const manSagar = (d: District) => d.def.water!.slice(1)
  /** The box the water's boxes fill, less the ghat: the lake's extent. */
  const extent = (ws: AABB[]): AABB => ({
    minX: Math.min(...ws.map((w) => w.minX)),
    maxX: Math.max(...ws.map((w) => w.maxX)),
    minZ: Math.min(...ws.map((w) => w.minZ)),
    maxZ: Math.max(...ws.map((w) => w.maxZ)),
  })
  const jal = (d: District) => d.def.landmarks.find((l) => l.id === 'jal-mahal')!
  const wet = (d: District) => (p: Vec2) => manSagar(d).some((w) => inside(p, w))

  it('is a lake south of the road, out to the walls, that nobody walks into', async () => {
    const d = await load('amer')
    const lake = extent(manSagar(d))
    for (const w of manSagar(d)) expect(d.colliders).toContainEqual(w)
    expect(lake.minZ).toBeGreaterThan(d.def.spawn.z + 15) // past the road
    expect(lake.minX).toBeLessThanOrEqual(-d.def.size / 2)
    expect(lake.maxZ).toBeGreaterThanOrEqual(d.def.size / 2)
    // every drop of water drawn inside the district is water you cannot walk into, and nothing is built on it
    const half = d.def.size / 2
    d.def.paving.forEach((p, i) => {
      if (p.color !== 'glass') return
      const inDistrict = {
        minX: Math.max(p.minX, -half),
        maxX: Math.min(p.maxX, half),
        minZ: Math.max(p.minZ, -half),
        maxZ: Math.min(p.maxZ, half),
      }
      const covered = d.def.water!.some(
        (c) =>
          inDistrict.minX >= c.minX &&
          inDistrict.maxX <= c.maxX &&
          inDistrict.minZ >= c.minZ &&
          inDistrict.maxZ <= c.maxZ,
      )
      // the lake drawn round the ghat is covered by the boxes round it, where nothing is drawn over it: sample it
      const over = d.def.paving.slice(i + 1)
      if (!covered)
        for (let x = inDistrict.minX + 0.25; x < inDistrict.maxX; x += 1)
          for (let z = inDistrict.minZ + 0.25; z < inDistrict.maxZ; z += 1)
            if (!over.some((q) => inside({ x, z }, q)))
              expect(
                d.def.water!.some((w) => inside({ x, z }, w)),
                `water drawn at ${x},${z}`,
              ).toBe(true)
      for (const b of d.def.buildings)
        expect(intersects(footprint(b), inDistrict), `${b.x},${b.z}`).toBe(false)
    })
  })

  it('has Jal Mahal out in the water: water on every side, a few metres off the end of the ghat', async () => {
    const d = await load('amer')
    const l = jal(d)
    const f = l.footprint
    // water on every side, a few metres of it at least
    for (const p of [
      { x: f.minX - 3, z: (f.minZ + f.maxZ) / 2 },
      { x: f.maxX + 3, z: (f.minZ + f.maxZ) / 2 },
      { x: (f.minX + f.maxX) / 2, z: f.minZ - 3 },
      { x: (f.minX + f.maxX) / 2, z: f.maxZ + 3 },
      { x: f.minX - 3, z: f.minZ - 3 },
      { x: f.maxX + 3, z: f.minZ - 3 },
    ])
      expect(wet(d)(p), `${p.x},${p.z}`).toBe(true)
    // the walkable ground nearest it is the ghat's end, in front of its middle, under 6 m off (the map's arrival)
    const ghatEnd = { x: l.at.x, z: f.minZ - 4 - PLAYER_RADIUS - 0.1 }
    expect(blockedBy(d.colliders)(ghatEnd)).toBe(false)
    expect(blockedBy(d.colliders)({ x: l.at.x, z: f.minZ - 2 })).toBe(true)
    // its front (the pavilion) turned to the ghat, and it keeps to its footprint
    const model = await l.build()
    expect(model.rotation.y).toBeCloseTo(Math.PI)
    const box = new THREE.Box3().setFromObject(model)
    expect(box.max.y).toBeGreaterThan(8)
    expect(box.min.x).toBeGreaterThanOrEqual(f.minX - 0.01)
    expect(box.max.x).toBeLessThanOrEqual(f.maxX + 0.01)
    expect(box.min.z).toBeGreaterThanOrEqual(f.minZ - 0.01)
    expect(box.max.z).toBeLessThanOrEqual(f.maxZ + 0.01)
  })

  it('earns its stamp out on the ghat facing it, not on the promenade or the road', async () => {
    const d = await load('amer')
    const l = jal(d)
    const lake = extent(manSagar(d))
    const blocked = blockedBy(d.colliders)
    // the ghat runs out from the promenade into the water, toward the palace
    for (let z = lake.minZ - 1; z < l.footprint.minZ - 5; z += 0.5)
      expect(blocked({ x: l.at.x, z }), `the ghat at ${z}`).toBe(false)
    const end = { x: l.at.x, z: l.footprint.minZ - 4 - PLAYER_RADIUS - 0.1 }
    expect(Math.hypot(end.x - l.at.x, end.z - l.at.z)).toBeLessThan(l.radius)
    // the promenade, along the shore, is outside the ring
    expect(l.at.z - lake.minZ).toBeGreaterThan(l.radius)
  })

  it('has benches on the promenade looking out across the water, and lamps along its edge', async () => {
    const d = await load('amer')
    const lake = extent(manSagar(d))
    const onPromenade = (p: Vec2) => p.x < lake.maxX && p.z > 50 && p.z < lake.minZ
    const benches = d.def.props.filter((p) => p.kind === 'bench' && onPromenade(p.at))
    expect(benches.length).toBeGreaterThanOrEqual(2)
    for (const b of benches) expect(b.rot ?? 0).toBe(0) // the front (+z) faces south, at the lake
    expect(d.def.props.filter((p) => p.kind === 'lamp' && onPromenade(p.at)).length).toBeGreaterThanOrEqual(2)
  })
})

describe('Nahargarh', () => {
  it('is Nahargarh, with the fort on the ridge: walls and a gateway, north of the road', async () => {
    const d = await load('nahargarh')
    expect(d.def.name).toEqual({ hi: 'Nahargarh', en: 'Nahargarh' })
    expect(d.def.size).toBe(200)
    expect(ids(d.def.landmarks)).toEqual(['nahargarh-fort'])
    const fort = d.def.landmarks[0]!
    const box = new THREE.Box3().setFromObject(await fort.build())
    expect(box.max.y).toBeGreaterThan(10)
    expect(fort.footprint.maxZ).toBeLessThan(d.def.spawn.z - 40)
    // the ring by the gate is on the fort's south face, where the road comes up
    expect(fort.at.z).toBeGreaterThan(fort.footprint.maxZ)
    expect(fort.at.x).toBeGreaterThan(fort.footprint.minX)
    expect(fort.at.x).toBeLessThan(fort.footprint.maxX)
  })

  it('stands on a ridge: the ground stops at its west wall and the city lies below it, far off', async () => {
    const d = await load('nahargarh')
    expect(d.def.ridgeWest).toBe(-d.def.size / 2)
    const city = d.root.getObjectByName('city-below')!
    expect(city).toBeDefined()
    const box = new THREE.Box3().setFromObject(city)
    expect(box.max.x).toBeLessThanOrEqual(d.def.ridgeWest! + 0.01) // all of it past the edge
    expect(box.min.y).toBeLessThan(-20) // well below the ridge
    expect(box.min.x).toBeLessThan(d.def.ridgeWest! - 200) // a wide view
    // cheap: a couple of draw calls, a few thousand triangles, and the lights of the city come on at night
    let calls = 0
    city.traverse((o) => {
      if (o instanceof THREE.Mesh) calls++
    })
    expect(calls).toBeLessThanOrEqual(3)
    expect(triangles(city)).toBeLessThan(8000)
    expect(materials(city).some(glows)).toBe(true)
    // nothing out there is something to walk into: it adds no collider
    for (const c of d.colliders)
      expect(c.minX < d.def.ridgeWest! - 10 && c.maxX < d.def.ridgeWest! - 10).toBe(false)
  })

  it('frees the city below with the rest of the district', async () => {
    const d = await loadDistrict('nahargarh')
    const spies: ReturnType<typeof vi.fn>[] = []
    d.root.getObjectByName('city-below')!.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      spies.push(vi.spyOn(o.geometry as THREE.BufferGeometry, 'dispose') as never)
      spies.push(vi.spyOn(o.material as THREE.Material, 'dispose') as never)
    })
    expect(spies).toHaveLength(4)
    d.dispose()
    for (const s of spies) expect(s).toHaveBeenCalled()
  })

  it('has a sunset point: the bastion on the terrace looks west, over the parapet, at the city', async () => {
    const d = await load('nahargarh')
    const roof = d.def.roof!
    expect(roof.y).toBeGreaterThan(8)
    expect(roofHeight(roof, roof.landing.x, roof.landing.z)).toBe(roof.y)
    expect(roof.out).toEqual({ x: -1, z: 0 })
    // the view is due west, out past the ridge's edge
    expect(roof.view.x).toBeLessThan(d.def.ridgeWest!)
    expect(Math.abs(roof.view.z - roof.landing.z)).toBeLessThan(1)
    // and the roof is near the edge: little but the terrace between it and the drop
    expect(roof.building.minX - d.def.ridgeWest!).toBeLessThan(20)
  })

  it('has no metro: a bus stand by the ridge road, chai stalls, benches facing the sunset, a poster wall and autos', async () => {
    const d = await load('nahargarh')
    const count = (k: string) => d.def.props.filter((p) => p.kind === k).length
    expect(count('station')).toBe(0)
    expect(count('bus-stop')).toBe(1)
    expect(count('tapri')).toBeGreaterThanOrEqual(1)
    expect(count('tapri')).toBeLessThanOrEqual(2)
    expect(count('bench')).toBeGreaterThanOrEqual(2)
    expect(count('bench')).toBeLessThanOrEqual(3)
    expect(count('poster-wall')).toBe(1)
    expect(count('auto')).toBeGreaterThanOrEqual(2)
    // at least two benches look west (their front, +z, turned to -x), out at the sunset
    expect(d.def.props.filter((p) => p.kind === 'bench' && p.rot === 90).length).toBeGreaterThanOrEqual(2)
  })

  it('has crenellated walls along the ridge', async () => {
    const d = await load('nahargarh')
    expect(d.def.buildings.filter((b) => b.style === 'wall').length).toBeGreaterThanOrEqual(2)
  })

  it('is where Bhanwar ji and Tara spend their days', async () => {
    expect(ids((await load('nahargarh')).def.npcs)).toEqual(['bhanwar', 'tara'])
  })
})

describe('benches', () => {
  it("every district's tapris and benches are the ones the server knows", async () => {
    for (const id of DISTRICTS) {
      const props = (await load(id)).def.props.filter((p) => p.kind === 'tapri' || p.kind === 'bench')
      expect(props.length, id).toBe(BENCHES.counts[id])
      expect(
        props.map((p) => p.at),
        id,
      ).toEqual(BENCHES.positions[id])
    }
  })
})
