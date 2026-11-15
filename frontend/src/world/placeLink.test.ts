import { describe, expect, it } from 'vitest'
import type { DistrictId } from '../net/protocol'
import { PLAYER_RADIUS } from '../player/player'
import { BENCH_RANGE, benchesOf } from './benches'
import { mapItems } from './cityMap'
import { DISTRICTS, loadDistrict, type District } from './district'
import { linkId, placeSpot, placeUrl, readPlaceLink } from './placeLink'
import { WALL_RANGE, wallDistance, wallsOf } from './posters'
import type { AABB, Vec2 } from './types'
import { STATION_RANGE } from './useTravel'

const loaded = new Map<DistrictId, Promise<District>>()
const load = (id: DistrictId) => {
  if (!loaded.has(id)) loaded.set(id, loadDistrict(id))
  return loaded.get(id)!
}

const hits = (p: Vec2, r: number, c: AABB) =>
  p.x > c.minX - r && p.x < c.maxX + r && p.z > c.minZ - r && p.z < c.maxZ + r

describe('a link to a place', () => {
  it('is the site with ?at=<district>:<place>, and nothing else (nothing about who shared it)', () => {
    expect(placeUrl('walled-city', 'hawa-mahal')).toBe(
      'https://gulabi-gali.manishbisht.me/?at=walled-city:hawa-mahal',
    )
    expect(new URL(placeUrl('mi-road', 'bench-3')).searchParams.size).toBe(1)
  })

  it('reads back what it wrote', () => {
    expect(readPlaceLink(new URL(placeUrl('university', 'poster-1')).search)).toEqual({
      district: 'university',
      place: 'poster-1',
    })
    expect(readPlaceLink('?at=malviya-nagar%3Ametro')).toEqual({ district: 'malviya-nagar', place: 'metro' })
  })

  it.each([
    '',
    '?at=',
    '?at=walled-city',
    '?at=walled-city:',
    '?at=nowhere:hawa-mahal',
    '?at=walled-city:Hawa Mahal',
    '?at=walled-city:<script>',
    `?at=walled-city:${'a'.repeat(41)}`,
    '?at=__proto__:metro',
  ])('ignores %j', (search) => {
    expect(readPlaceLink(search)).toBeNull()
  })

  it('unknown places in a known district have no spot: the normal spawn stands in', async () => {
    const district = await load('walled-city')
    const [first] = benchesOf(district.def)
    // the right number with the wrong kind is no place either
    const wrongKind = `${first!.kind === 'tapri' ? 'bench' : 'tapri'}-${first!.id.split(':')[1]}`
    for (const id of ['nowhere', 'bench-999', 'poster-99', wrongKind, 'bench-x', 'constructor', 'toString'])
      expect(placeSpot(district, id), id).toBeNull()
  })
})

describe.each(DISTRICTS)('%s: every place on its map round-trips to a clear spot at that place', (id) => {
  it('landmarks: by the landmark (its card opens), facing it', async () => {
    const { def, colliders } = await load(id)
    for (const l of def.landmarks) {
      const item = mapItems(def, []).find((i) => i.id === l.id)!
      const back = readPlaceLink(new URL(placeUrl(id, linkId(item))).search)!
      expect(back).toEqual({ district: id, place: l.id })
      const spot = placeSpot(await load(id), back.place)!
      expect(spot, l.id).not.toBeNull()
      expect(
        colliders.some((c) => hits(spot, PLAYER_RADIUS, c)),
        l.id,
      ).toBe(false)
      expect(Math.hypot(spot.x - l.at.x, spot.z - l.at.z), l.id).toBeLessThanOrEqual(l.radius)
    }
  })

  it('the metro: at the station', async () => {
    const { def, colliders } = await load(id)
    const item = mapItems(def, []).find((i) => i.kind === 'metro')!
    const back = readPlaceLink(new URL(placeUrl(id, linkId(item))).search)!
    const spot = placeSpot(await load(id), back.place)!
    expect(colliders.some((c) => hits(spot, PLAYER_RADIUS, c))).toBe(false)
    expect(Math.hypot(spot.x - def.station.x, spot.z - def.station.z)).toBeLessThanOrEqual(STATION_RANGE)
  })

  it('benches and tapris: in reach to sit ("Baitho" shows), in the clear', async () => {
    const { def, colliders } = await load(id)
    const benches = benchesOf(def)
    expect(benches.length).toBeGreaterThan(0)
    for (const b of benches) {
      const item = mapItems(def, []).find((i) => i.id === b.id)!
      const back = readPlaceLink(new URL(placeUrl(id, linkId(item))).search)!
      expect(back.place).toMatch(new RegExp(`^${b.kind}-\\d+$`))
      const spot = placeSpot(await load(id), back.place)!
      expect(spot, b.id).not.toBeNull()
      expect(
        colliders.some((c) => hits(spot, PLAYER_RADIUS, c)),
        b.id,
      ).toBe(false)
      expect(Math.hypot(spot.x - b.at.x, spot.z - b.at.z), b.id).toBeLessThan(BENCH_RANGE)
      // inside the district's boundary
      expect(Math.max(Math.abs(spot.x), Math.abs(spot.z)), b.id).toBeLessThan(def.size / 2)
    }
  })

  it('poster walls: in front of the wall, in reach to read it', async () => {
    const { def, colliders } = await load(id)
    for (const w of wallsOf(def)) {
      const item = mapItems(def, []).find((i) => i.id === `poster-${w.index}`)!
      const back = readPlaceLink(new URL(placeUrl(id, linkId(item))).search)!
      const spot = placeSpot(await load(id), back.place)!
      expect(spot, item.id).not.toBeNull()
      expect(
        colliders.some((c) => hits(spot, PLAYER_RADIUS, c)),
        item.id,
      ).toBe(false)
      expect(wallDistance(spot, w), item.id).toBeLessThan(WALL_RANGE)
      // on the side the posters face (+z in the wall's own frame)
      const a = (w.rot * Math.PI) / 180
      const lz = -(spot.x - w.at.x) * Math.sin(a) + (spot.z - w.at.z) * Math.cos(a)
      expect(lz, item.id).toBeGreaterThan(0)
    }
  })
})
