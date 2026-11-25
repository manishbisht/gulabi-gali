import { describe, expect, it, vi } from 'vitest'
import { STRINGS } from '../i18n/strings'
import { PLAYER_RADIUS } from '../player/player'
import { benchesOf } from './benches'
import { DISTRICTS, loadDef, loadDistrict } from './district'
import { wallsOf } from './posters'
import {
  eveningOn,
  NEAR_M,
  onShowWatched,
  SHOW_KINDS,
  SHOW_RADIUS,
  SHOW_S,
  SHOW_TEXT,
  showColliders,
  showFront,
  showId,
  showOfId,
  showOn,
  showsOf,
  showWatched,
  STAY_M,
  watchSpot,
} from './shows'
import { TAXI } from './taxi'
import type { AABB, ShowKind, Vec2 } from './types'

/** How far `p` is from a box (0 inside it). */
const toBox = (p: Vec2, c: AABB) =>
  Math.hypot(Math.max(c.minX - p.x, 0, p.x - c.maxX), Math.max(c.minZ - p.z, 0, p.z - c.maxZ))
/** How far `p` is from the leg a to b. */
const toLeg = (p: Vec2, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = dx * dx + dz * dz
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len)) : 0
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
}
const apart = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)

describe('where the shows are', () => {
  it('a puppet stage and a ravanhatta player in two districts each, the dancers on one square, nothing forced elsewhere', async () => {
    const where: Record<ShowKind, string[]> = { kathputli: [], ravanhatta: [], dancers: [] }
    for (const id of DISTRICTS) {
      const shows = showsOf(await loadDef(id))
      // one of a kind per district: the map id and the link are `show-<kind>`
      expect(new Set(shows.map((s) => s.kind)).size).toBe(shows.length)
      for (const s of shows) where[s.kind].push(id)
    }
    expect(where.kathputli).toEqual(['walled-city', 'amer'])
    expect(where.ravanhatta).toEqual(['mi-road', 'nahargarh'])
    expect(where.dancers).toEqual(['university'])
  })

  it.each(DISTRICTS)(
    '%s: each show stands on open ground, clear of every collider and of everything E answers to',
    async (id) => {
      const { def, colliders } = await loadDistrict(id)
      const half = def.size / 2
      for (const s of showsOf(def)) {
        const what = `${id} ${s.kind}`
        const r = SHOW_RADIUS[s.kind]
        // its own ground, and the spot a watcher (or a link) stands on
        expect(Math.min(...colliders.map((c) => toBox(s.at, c))), `${what}: colliders`).toBeGreaterThan(
          r + PLAYER_RADIUS + 0.3,
        )
        const watch = watchSpot(s)
        expect(Math.min(...colliders.map((c) => toBox(watch, c))), `${what}: watch spot`).toBeGreaterThan(
          PLAYER_RADIUS + 0.3,
        )
        expect(Math.max(Math.abs(s.at.x), Math.abs(s.at.z)), `${what}: inside`).toBeLessThan(half - r - 2)
        // standing at anything E answers to never starts a show, so its button never meets theirs
        const answering: [string, Vec2][] = [
          ['station', def.station],
          ['spawn', def.spawn],
          ...benchesOf(def).map((b): [string, Vec2] => [b.id, b.at]),
          ...wallsOf(def).map((w): [string, Vec2] => [`wall ${w.index}`, w.at]),
          ...def.props.filter((p) => p.kind === 'auto').map((p): [string, Vec2] => ['auto', p.at]),
          ...(def.roof ? [['stair', def.roof.stair] as [string, Vec2]] : []),
          ...Object.entries(TAXI[id].drops).map(([to, p]): [string, Vec2] => [`drop ${to}`, p]),
          ...TAXI[id].stands.map((p): [string, Vec2] => ['stand', p]),
          ...(def.signposts ?? []).map((p): [string, Vec2] => ['signpost', p]),
        ]
        for (const [name, p] of answering)
          expect(apart(s.at, p), `${what}: ${name}`).toBeGreaterThan(NEAR_M + 1)
        // a landmark's card is never up while a show plays: the show starts outside every ring
        for (const l of def.landmarks)
          expect(apart(s.at, l.at), `${what}: ${l.id}'s ring`).toBeGreaterThan(l.radius + NEAR_M)
        // the procession and the characters walk past it, not through it
        const routes = [[...def.processionRoute, def.processionRoute[0]!], ...def.npcs.map((n) => n.route)]
        for (const route of routes)
          for (let i = 0; i < route.length - 1; i++)
            expect(toLeg(s.at, route[i]!, route[i + 1]!), `${what}: a route`).toBeGreaterThan(r + 1)
        // and no animal lives on its ground
        const { dogs, cats, cow } = def.animals
        for (const p of [...dogs, ...cats, cow])
          expect(apart(s.at, p), `${what}: an animal's home`).toBeGreaterThan(r + 2)
        // what it adds to the colliders stays inside its own ground
        for (const c of showColliders(s))
          for (const corner of [
            { x: c.minX, z: c.minZ },
            { x: c.maxX, z: c.maxZ },
          ])
            expect(apart(corner, s.at), `${what}: its collider`).toBeLessThan(r + 0.6)
        // and the watcher's spot is outside it
        expect(Math.min(...showColliders(s).map((c) => toBox(watch, c)))).toBeGreaterThan(PLAYER_RADIUS + 1)
      }
    },
  )
})

describe('the shows as data', () => {
  it('turns with `rot` as a prop does: front +z, 90 to -x', () => {
    expect(showFront({})).toEqual({ x: 0, z: 1 })
    expect(showFront({ rot: 90 })).toEqual({ x: -1, z: 0 })
    expect(showFront({ rot: 180 })).toEqual({ x: 0, z: -1 })
    const spot = watchSpot({ kind: 'ravanhatta', at: { x: 10, z: 5 }, rot: 90 })
    expect(spot.x).toBeCloseTo(10 - 3.4)
    expect(spot.z).toBeCloseTo(5)
    // facing the show: +x
    expect(Math.sin(spot.ry)).toBeCloseTo(1)
  })

  it('names a show by its kind on the map and in a link', () => {
    const def = { shows: [{ kind: 'kathputli' as const, at: { x: 1, z: 2 } }] }
    expect(showId('kathputli')).toBe('show-kathputli')
    expect(showOfId(def, 'show-kathputli')).toBe(def.shows[0])
    expect(showOfId(def, 'show-dancers')).toBeUndefined()
    expect(showOfId({}, 'show-kathputli')).toBeUndefined()
  })

  it('the dancers come out from an hour before sunset to two hours after; the others are always there', () => {
    const sunset = '2026-11-25T12:05:00.000Z'
    const at = (iso: string) => new Date(iso)
    expect(eveningOn(at('2026-11-25T11:04:00.000Z'), sunset)).toBe(false)
    expect(eveningOn(at('2026-11-25T11:05:00.000Z'), sunset)).toBe(true)
    expect(eveningOn(at('2026-11-25T14:05:00.000Z'), sunset)).toBe(true)
    expect(eveningOn(at('2026-11-25T14:06:00.000Z'), sunset)).toBe(false)
    expect(eveningOn(at('2026-11-25T12:00:00.000Z'), 'not a time')).toBe(false)
    expect(showOn('dancers', at('2026-11-25T06:00:00.000Z'), sunset)).toBe(false)
    expect(showOn('kathputli', at('2026-11-25T06:00:00.000Z'), sunset)).toBe(true)
    expect(showOn('ravanhatta', at('2026-11-25T20:00:00.000Z'), sunset)).toBe(true)
  })

  it('a performance is 20 to 30 seconds, begins nearer than it ends, and every show has its copy in both languages', () => {
    expect(STAY_M).toBeGreaterThan(NEAR_M)
    for (const kind of SHOW_KINDS) {
      expect(SHOW_S[kind]).toBeGreaterThanOrEqual(20)
      expect(SHOW_S[kind]).toBeLessThanOrEqual(30)
      for (const key of [SHOW_TEXT[kind].name, SHOW_TEXT[kind].title, ...SHOW_TEXT[kind].lines]) {
        expect(STRINGS[key].hi.length).toBeGreaterThan(0)
        expect(STRINGS[key].en.length).toBeGreaterThan(0)
      }
    }
    // the dance is named as in the style of, never as the community's own troupe
    expect(STRINGS.showDancers.en.toLowerCase()).toContain('kalbelia-style')
    expect(STRINGS.showDancers.hi.toLowerCase()).toContain('kalbelia-style')
    expect(STRINGS.showDancersTitle.en.toLowerCase()).toContain('kalbelia-style')
    expect(STRINGS.showDancersTitle.hi.toLowerCase()).toContain('kalbelia-style')
    // the card is only up while they dance: its title does not say "evenings", the map's row does
    expect(STRINGS.showDancersTitle.hi).not.toContain('shaam')
    expect(STRINGS.showDancers.hi).toContain('shaam ko')
  })

  it('`showWatched` tells every listener, and one that throws does not stop the rest', () => {
    const heard = vi.fn()
    const offBroken = onShowWatched(() => {
      throw new Error('broken')
    })
    const off = onShowWatched(heard)
    showWatched('ravanhatta')
    expect(heard).toHaveBeenCalledWith('ravanhatta')
    off()
    offBroken()
    showWatched('dancers')
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
