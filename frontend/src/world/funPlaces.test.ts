import { describe, expect, it } from 'vitest'
import { PITCH_HALF_WIDTH, PITCH_RANGE, pitchDistance } from './cricketPitch'
import { DISTRICTS, loadDef } from './district'
import { SHOW_RADIUS, showsOf, watchSpot } from './shows'
import { SERVE_RANGE, servingsIn } from './swaad'
import { STARTLE_RANGE, TOUCH_RANGE } from './touchables'
import type { PitchDef, Vec2 } from './types'

/*
 * The things to do, taken together: a district's cricket pitch, its touchables, its street shows and its serving
 * stalls each keep clear of the street's older prompts in their own tests. Here they are held clear of one
 * another, so that nowhere on the street do two of their prompts show at once, nobody watching a show stands in
 * another prompt, and no flock of pigeons sits on a pitch or a stage. Every reach is the feature's own constant.
 */

/** Somewhere a prompt is offered: within `reach` of a point, or of the line from a pitch's stumps to its bowler. */
interface Place {
  feature: 'cricket' | 'touchable' | 'show' | 'swaad'
  name: string
  reach: number
  /** How far `p` is from it. */
  from(p: Vec2): number
  /** The points whose distance to another place decides the gap between the two. */
  ends: Vec2[]
}

const apart = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)
const point = (feature: Place['feature'], name: string, at: Vec2, reach: number): Place => ({
  feature,
  name,
  reach,
  from: (p) => apart(at, p),
  ends: [at],
})

/** The least distance between two segments in the plane (0 when they cross). */
function segments(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const side = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x))
  if (side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)) return 0
  const toLeg = (p: Vec2, q: Vec2, r: Vec2) => pitchDistance({ stumps: q, bowler: r }, p)
  return Math.min(toLeg(a, c, d), toLeg(b, c, d), toLeg(c, a, b), toLeg(d, a, b))
}

const strip = (pitch: PitchDef): Place => ({
  feature: 'cricket',
  name: 'the cricket pitch',
  reach: PITCH_RANGE,
  from: (p) => pitchDistance(pitch, p),
  ends: [pitch.stumps, pitch.bowler],
})

/** The gap between two places, edge of reach to edge of reach: positive when no spot is in both. */
function gap(a: Place, b: Place): number {
  const between =
    a.ends.length === 2 && b.ends.length === 2
      ? segments(a.ends[0]!, a.ends[1]!, b.ends[0]!, b.ends[1]!)
      : a.ends.length === 2
        ? a.from(b.ends[0]!)
        : b.from(a.ends[0]!)
  return between - a.reach - b.reach
}

describe.each(DISTRICTS)('the things to do in %s', (id) => {
  it('no two prompts of the pitch, the touchables, the shows and the serving stalls can show at once', async () => {
    const def = await loadDef(id)
    const places: Place[] = []
    if (def.cricket) places.push(strip(def.cricket))
    for (const s of def.touchables ?? [])
      if (s.kind !== 'pigeons')
        places.push(point('touchable', `the ${s.kind} at ${s.at.x},${s.at.z}`, s.at, TOUCH_RANGE))
    for (const s of showsOf(def)) {
      // the ground it performs on, and the spot a watcher (or a link) stands on
      places.push(point('show', `the ${s.kind} show's ground`, s.at, SHOW_RADIUS[s.kind]))
      places.push(point('show', `the ${s.kind} show's watch spot`, watchSpot(s), 0))
    }
    for (const s of servingsIn(id))
      places.push(point('swaad', `the ${s.dish} stall at ${s.x},${s.z}`, { x: s.x, z: s.z }, SERVE_RANGE))

    const fouls: string[] = []
    for (let i = 0; i < places.length; i++)
      for (let j = i + 1; j < places.length; j++) {
        const [a, b] = [places[i]!, places[j]!]
        // two of one feature share one prompt (the nearer wins); their own tests space them
        if (a.feature === b.feature) continue
        const g = gap(a, b)
        if (g <= 0) fouls.push(`${a.name} and ${b.name} overlap by ${(-g).toFixed(1)} m`)
      }
    expect(fouls).toEqual([])
  })

  it('no flock of pigeons sits on the pitch or on a show', async () => {
    const def = await loadDef(id)
    const fouls: string[] = []
    for (const flock of (def.touchables ?? []).filter((s) => s.kind === 'pigeons')) {
      const where = `the pigeons at ${flock.at.x},${flock.at.z}`
      // walking the strip, or standing to watch, never sends them up; nor do they stand on either
      if (def.cricket && pitchDistance(def.cricket, flock.at) <= STARTLE_RANGE + PITCH_HALF_WIDTH)
        fouls.push(`${where} are on the pitch`)
      for (const s of showsOf(def)) {
        if (apart(s.at, flock.at) <= STARTLE_RANGE + SHOW_RADIUS[s.kind])
          fouls.push(`${where} are on the ${s.kind} show's ground`)
        if (apart(watchSpot(s), flock.at) <= STARTLE_RANGE)
          fouls.push(`${where} are where the ${s.kind} show is watched from`)
      }
    }
    expect(fouls).toEqual([])
  })
})
