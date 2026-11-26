import { describe, expect, it } from 'vitest'
import type { DistrictId } from '../net/protocol'
import { PLAYER_RADIUS } from '../player/player'
import { BENCH_RANGE, benchesOf } from './benches'
import { mapItems } from './cityMap'
import { PITCH_RANGE, pitchColliders, pitchDistance } from './cricketPitch'
import { DISTRICTS, loadDistrict, type District } from './district'
import { SITE_URL } from '../ui/inviteShare'
import { linkId, PITCH_BACK, placeForward, placeSpot, placeUrl, readPlaceLink } from './placeLink'
import { WALL_RANGE, wallDistance, wallsOf } from './posters'
import { NEAR_M, showColliders, showsOf } from './shows'
import type { AABB, Vec2 } from './types'
import { STAIR_RANGE } from './rooftop'
import { STATION_RANGE } from './useTravel'

const loaded = new Map<DistrictId, Promise<District>>()
const load = (id: DistrictId) => {
  if (!loaded.has(id)) loaded.set(id, loadDistrict(id))
  return loaded.get(id)!
}

/** Where a link's preview page sends its visitor, read back as the app reads it. */
const forwarded = (district: DistrictId, place: string) =>
  readPlaceLink(new URL(placeForward(district, place), SITE_URL).search)

const hits = (p: Vec2, r: number, c: AABB) =>
  p.x > c.minX - r && p.x < c.maxX + r && p.z > c.minZ - r && p.z < c.maxZ + r

describe('a link to a place', () => {
  it("is the place's preview page, /p/<district>/<place>/, and nothing else (nothing about who shared it)", () => {
    expect(placeUrl('walled-city', 'hawa-mahal')).toBe(
      'https://gulabi-gali.manishbisht.me/p/walled-city/hawa-mahal/',
    )
    const url = new URL(placeUrl('mi-road', 'bench-3'))
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
  })

  it('reads back what the page forwards to, and the old ?at= links', () => {
    expect(readPlaceLink(new URL(placeForward('university', 'poster-1'), SITE_URL).search)).toEqual({
      district: 'university',
      place: 'poster-1',
    })
    expect(readPlaceLink('?at=walled-city:hawa-mahal')).toEqual({
      district: 'walled-city',
      place: 'hawa-mahal',
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
  it('landmarks: by the landmark (its card opens), facing its building', async () => {
    const { def, colliders } = await load(id)
    for (const l of def.landmarks) {
      const item = mapItems(def, []).find((i) => i.id === l.id)!
      const back = forwarded(id, linkId(item))!
      expect(back).toEqual({ district: id, place: l.id })
      const spot = placeSpot(await load(id), back.place)!
      expect(spot, l.id).not.toBeNull()
      expect(
        colliders.some((c) => hits(spot, PLAYER_RADIUS, c)),
        l.id,
      ).toBe(false)
      expect(Math.hypot(spot.x - l.at.x, spot.z - l.at.z), l.id).toBeLessThanOrEqual(l.radius)
      // facing the building itself (its footprint), not away from it: within 45 degrees of its middle, and
      // looking straight ahead runs into it
      const f = l.footprint
      const mid = { x: (f.minX + f.maxX) / 2, z: (f.minZ + f.maxZ) / 2 }
      const look = { x: Math.sin(spot.ry), z: Math.cos(spot.ry) }
      const to = { x: mid.x - spot.x, z: mid.z - spot.z }
      const cos = (look.x * to.x + look.z * to.z) / Math.hypot(to.x, to.z)
      expect(cos, l.id).toBeGreaterThan(Math.cos(Math.PI / 4))
      const ahead = Array.from({ length: 300 }, (_, i) => ({
        x: spot.x + look.x * i * 0.5,
        z: spot.z + look.z * i * 0.5,
      }))
      expect(
        ahead.some((p) => hits(p, 0, f)),
        l.id,
      ).toBe(true)
      // the chase camera's whole line back (7 m), with a metre's margin, clear of every collider: it never sits
      // in a wall behind the visitor
      for (let d = 1; d <= 7; d++) {
        const p = { x: spot.x - look.x * d, z: spot.z - look.z * d }
        expect(
          colliders.some((c) => hits(p, 1, c)),
          `${l.id}: ${d} m behind`,
        ).toBe(false)
      }
    }
  })

  it('the metro: at the station', async () => {
    const { def, colliders } = await load(id)
    const item = mapItems(def, []).find((i) => i.kind === 'metro')!
    const back = forwarded(id, linkId(item))!
    const spot = placeSpot(await load(id), back.place)!
    expect(colliders.some((c) => hits(spot, PLAYER_RADIUS, c))).toBe(false)
    expect(Math.hypot(spot.x - def.station.x, spot.z - def.station.z)).toBeLessThanOrEqual(STATION_RANGE)
  })

  it('a named viewpoint: at its stair, in the clear and in reach to climb, looking its way; none where there is none', async () => {
    const { def, colliders } = await load(id)
    const item = mapItems(def, []).find((i) => i.kind === 'viewpoint')
    if (!def.roofName) {
      expect(item).toBeUndefined()
      expect(placeSpot(await load(id), 'viewpoint')).toBeNull()
      return
    }
    const back = forwarded(id, linkId(item!))!
    expect(back.place).toBe('viewpoint')
    const spot = placeSpot(await load(id), back.place)!
    expect(colliders.some((c) => hits(spot, PLAYER_RADIUS, c))).toBe(false)
    const roof = def.roof!
    expect(Math.hypot(spot.x - roof.stair.x, spot.z - roof.stair.z)).toBeLessThanOrEqual(STAIR_RANGE)
    const look = { x: Math.sin(spot.ry), z: Math.cos(spot.ry) }
    const foot = roof.foot ?? roof.out
    expect(look.x * foot.x + look.z * foot.z).toBeGreaterThan(0.99)
    // the chase camera's whole line back (7 m), with a metre's margin, clear of walls and the stair's flight: it
    // must not sit inside the flight or press against a wall (what you face may be the stair itself)
    for (let d = 1; d <= 7; d++) {
      const p = { x: spot.x - look.x * d, z: spot.z - look.z * d }
      expect(
        colliders.some((c) => hits(p, 1, c)),
        `${d} m behind`,
      ).toBe(false)
    }
  })

  it('street shows: where the audience stands, in the clear, facing the show and near enough to start it', async () => {
    const { def, colliders } = await load(id)
    const items = mapItems(def, []).filter((i) => i.kind === 'show')
    expect(items).toHaveLength(showsOf(def).length)
    for (const s of showsOf(def)) {
      const item = items.find((i) => i.id === `show-${s.kind}`)!
      const back = forwarded(id, linkId(item))!
      expect(back).toEqual({ district: id, place: `show-${s.kind}` })
      const spot = placeSpot(await load(id), back.place)!
      expect(spot, s.kind).not.toBeNull()
      // clear of the street, and of what the show itself puts on it
      for (const c of [...colliders, ...showColliders(s)])
        expect(hits(spot, PLAYER_RADIUS, c), s.kind).toBe(false)
      expect(Math.hypot(spot.x - s.at.x, spot.z - s.at.z), s.kind).toBeLessThan(NEAR_M)
      const look = { x: Math.sin(spot.ry), z: Math.cos(spot.ry) }
      const to = { x: s.at.x - spot.x, z: s.at.z - spot.z }
      expect((look.x * to.x + look.z * to.z) / Math.hypot(to.x, to.z), s.kind).toBeGreaterThan(0.99)
      // the chase camera's line back (7 m), clear of every collider
      for (let d = 1; d <= 7; d++) {
        const p = { x: spot.x - look.x * d, z: spot.z - look.z * d }
        expect(
          colliders.some((c) => hits(p, 1, c)),
          `${s.kind}: ${d} m behind`,
        ).toBe(false)
      }
    }
    // a show this district does not have is no place
    for (const kind of ['kathputli', 'ravanhatta', 'dancers'])
      if (!showsOf(def).some((s) => s.kind === kind))
        expect(placeSpot(await load(id), `show-${kind}`)).toBeNull()
  })

  it('the cricket pitch: behind the stumps, in reach to play, looking down the strip; no place where there is none', async () => {
    const { def, colliders } = await load(id)
    const items = mapItems(def, []).filter((i) => i.kind === 'cricket')
    if (!def.cricket) {
      expect(items).toEqual([])
      expect(placeSpot(await load(id), 'cricket')).toBeNull()
      return
    }
    expect(items).toHaveLength(1)
    const back = forwarded(id, linkId(items[0]!))!
    expect(back).toEqual({ district: id, place: 'cricket' })
    const spot = placeSpot(await load(id), back.place)!
    expect(spot).not.toBeNull()
    // clear of the street and of the pitch's own stumps and bowler (they are among the colliders)
    for (const c of pitchColliders(def.cricket))
      expect(colliders.some((o) => o.minX === c.minX && o.minZ === c.minZ)).toBe(true)
    for (const c of colliders) expect(hits(spot, PLAYER_RADIUS, c)).toBe(false)
    // "Cricket khelo" is offered there
    expect(pitchDistance(def.cricket, spot)).toBeCloseTo(PITCH_BACK)
    expect(pitchDistance(def.cricket, spot)).toBeLessThan(PITCH_RANGE - 0.5)
    // facing the bowler, the stumps before them
    const look = { x: Math.sin(spot.ry), z: Math.cos(spot.ry) }
    const to = { x: def.cricket.bowler.x - spot.x, z: def.cricket.bowler.z - spot.z }
    expect((look.x * to.x + look.z * to.z) / Math.hypot(to.x, to.z)).toBeGreaterThan(0.99)
    // the chase camera's line back (7 m), with a metre's margin, clear of every collider
    for (let d = 1; d <= 7; d++) {
      const p = { x: spot.x - look.x * d, z: spot.z - look.z * d }
      expect(
        colliders.some((c) => hits(p, 1, c)),
        `${d} m behind`,
      ).toBe(false)
    }
  })

  it('benches and tapris: in reach to sit ("Baitho" shows), in the clear', async () => {
    const { def, colliders } = await load(id)
    const benches = benchesOf(def)
    expect(benches.length).toBeGreaterThan(0)
    for (const b of benches) {
      const item = mapItems(def, []).find((i) => i.id === b.id)!
      const back = forwarded(id, linkId(item))!
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
      const back = forwarded(id, linkId(item))!
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
