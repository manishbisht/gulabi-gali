import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Stage } from '../engine/stage'
import { buildPitch, CREASE_M, pitchFrame } from '../world/cricketPitch'
import { DISTRICTS, loadDistrict } from '../world/district'
import type { AABB, PitchDef, Vec2 } from '../world/types'
import { createCricket, ONE_S, RESULT_S, RUNUP_S, type CricketState, type Outcome } from './cricket'
import { ballAt, createCricketView, cricketEye } from './cricketView'

const PITCH: PitchDef = { stumps: { x: 4, z: 81 }, bowler: { x: 11, z: 81 } }
const stage = () =>
  ({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 0.5, 0.1, 500) }) as unknown as Stage
const at = (over: Partial<CricketState>): CricketState => ({
  phase: 'flight',
  t: 0,
  flight: 1,
  line: 0.8,
  balls: 0,
  runs: 0,
  outs: 0,
  over: false,
  last: null,
  seq: 0,
  arre: false,
  hold: RESULT_S,
  swing: 99,
  swings: 0,
  ...over,
})
const out = { along: 0, side: 0, y: 0 }

describe('where the ball is', () => {
  it('leaves the hand at the far end, pitches once, and reaches the bat at the crease when the flight is up', () => {
    const start = { ...ballAt(at({ t: 0 }), 7, out) }
    expect(start.along).toBeGreaterThan(6)
    expect(start.y).toBeGreaterThan(1)
    const end = { ...ballAt(at({ t: 1 }), 7, out) }
    expect(end.along).toBeCloseTo(CREASE_M)
    expect(end.y).toBeGreaterThan(0.4)
    expect(end.y).toBeLessThan(0.8)
    // on the way it comes steadily nearer, never under the ground, and touches down once
    let last = start.along
    let low = Infinity
    for (let t = 0.02; t <= 1; t += 0.02) {
      const p = ballAt(at({ t }), 7, out)
      expect(p.along).toBeLessThan(last)
      expect(p.y).toBeGreaterThan(0.05)
      last = p.along
      low = Math.min(low, p.y)
    }
    expect(low).toBeLessThan(0.2)
  })

  it('goes on to the stumps when nothing is hit, and sits in the hand during the run-up', () => {
    const p = { ...ballAt(at({ t: 1 + ONE_S }), 7, out) }
    expect(p.along).toBeCloseTo(0)
    const hand = { ...ballAt(at({ phase: 'runup', t: 0.3 }), 7, out) }
    expect(hand.along).toBeGreaterThan(6)
    expect(hand.y).toBeGreaterThan(0.8)
  })

  it('flies off by what came of it: a six high and long, a dot ball past the stumps, bowled into the bricks', () => {
    const after = (last: Outcome, k: number) => ({
      ...ballAt(at({ phase: 'result', t: RESULT_S * k, last }), 7, out),
    })
    expect(after('six', 0.5).y).toBeGreaterThan(5)
    expect(after('six', 1).along).toBeGreaterThan(25)
    expect(after('four', 1).along).toBeGreaterThan(20)
    expect(after('four', 0.5).y).toBeLessThan(1)
    expect(after('two', 1).along).toBeGreaterThan(after('one', 1).along)
    expect(after('dot', 1).along).toBeLessThan(-2)
    expect(after('bowled', 1).along).toBeLessThan(0.3)
    // caught: it ends in the bowler's hands
    expect(after('caught', 1).along).toBeGreaterThan(6)
    expect(after('caught', 1).y).toBeGreaterThan(0.8)
    for (const o of ['six', 'four', 'two', 'one', 'dot', 'bowled', 'caught'] as const)
      for (let k = 0; k <= 1; k += 0.05) expect(after(o, k).y, `${o} at ${k}`).toBeGreaterThanOrEqual(0.09)
  })
})

describe('createCricketView', () => {
  it("looks down the pitch from behind the stumps, at a batter's eye", () => {
    const s = stage()
    const view = createCricketView(s, PITCH, { extras: false, calm: true })
    const sim = createCricket(1)
    view.update(sim.state, 1 / 60)
    const eye = cricketEye(pitchFrame(PITCH), { x: 0, y: 0, z: 0 })
    expect(s.camera.position.toArray()).toEqual([eye.x, eye.y, eye.z])
    expect(eye.x).toBeLessThan(PITCH.stumps.x) // behind the stumps
    expect(eye.y).toBeGreaterThan(1.2)
    expect(eye.y).toBeLessThan(1.8)
    const looks = s.camera.getWorldDirection(new THREE.Vector3())
    expect(looks.x).toBeGreaterThan(0.9) // toward the bowler
    view.dispose()
  })

  it('draws a ball and a bat, fielders only when asked, and takes it all away again', () => {
    const s = stage()
    const bare = createCricketView(s, PITCH, { extras: false, calm: true })
    const game = s.scene.getObjectByName('cricket-game')!
    const instanced = () => {
      let n = 0
      game.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) n += o.count
      })
      return n
    }
    expect(instanced()).toBe(0)
    bare.dispose()
    expect(s.scene.getObjectByName('cricket-game')).toBeUndefined()
    const full = createCricketView(s, PITCH, { extras: true, calm: true })
    let fielders = 0
    s.scene.getObjectByName('cricket-game')!.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) fielders += o.count
    })
    expect(fielders).toBe(3)
    full.dispose()
    expect(s.scene.children).toHaveLength(0)
  })

  it('makes the kid at the pitch run in, and sets them back on their mark afterwards', () => {
    const s = stage()
    s.scene.add(buildPitch(PITCH))
    const kid = s.scene.getObjectByName('cricket-bowler')!
    const home = kid.position.clone()
    const view = createCricketView(s, PITCH, { extras: false, calm: true })
    view.update(at({ phase: 'runup', t: RUNUP_S * 0.5 }), 1 / 60)
    expect(kid.position.z).toBeLessThan(home.z) // toward the bat
    expect(kid.position.y).toBeGreaterThan(0.05) // mid-hop
    view.dispose()
    expect(kid.position.toArray()).toEqual(home.toArray())
    expect(kid.rotation.x).toBe(0)
  })

  it('shakes the view on a six, and never under reduced motion', () => {
    const eye = cricketEye(pitchFrame(PITCH), { x: 0, y: 0, z: 0 })
    const six = at({ phase: 'result', t: 0.05, last: 'six', seq: 1 })
    const lively = stage()
    const a = createCricketView(lively, PITCH, { extras: false, calm: false })
    a.update(six, 1 / 60)
    expect(lively.camera.position.x).not.toBe(eye.x)
    expect(Math.abs(lively.camera.position.x - eye.x)).toBeLessThan(0.05)
    a.dispose()
    const still = stage()
    const b = createCricketView(still, PITCH, { extras: false, calm: true })
    b.update(six, 1 / 60)
    expect(still.camera.position.toArray()).toEqual([eye.x, eye.y, eye.z])
    b.dispose()
  })

  it('swings the bat on a tap and brings it back', () => {
    const s = stage()
    const view = createCricketView(s, PITCH, { extras: false, calm: true })
    const bat = () => {
      let found: THREE.Object3D | null = null
      s.scene.getObjectByName('cricket-game')!.traverse((o) => {
        if (o instanceof THREE.Mesh && o.parent !== s.scene.getObjectByName('cricket-game')) found = o
      })
      return found! as THREE.Object3D
    }
    view.update(at({ swing: 99 }), 1 / 60)
    const idle = bat().rotation.x
    view.update(at({ swing: 0.22 }), 1 / 60)
    expect(bat().rotation.x).toBeGreaterThan(idle + 1)
    view.update(at({ swing: 2 }), 1 / 60)
    expect(bat().rotation.x).toBeCloseTo(idle)
    view.dispose()
  })
})

/** Whether (x, z) is inside `a` grown by `m`. */
const within = (p: Vec2, a: AABB, m: number) =>
  p.x > a.minX - m && p.x < a.maxX + m && p.z > a.minZ - m && p.z < a.maxZ + m

describe.each(DISTRICTS)("%s: the cricket game's camera", (id) => {
  it('stands in the clear, out of every wall, with the whole pitch before it', async () => {
    const district = await loadDistrict(id)
    const pitch = district.def.cricket
    if (!pitch) return district.dispose()
    const eye = cricketEye(pitchFrame(pitch), { x: 0, y: 0, z: 0 })
    const hit = district.colliders.find((o) => within(eye, o, 0.3))
    expect(hit, `camera at ${eye.x}, ${eye.z}`).toBeUndefined()
    // nothing tall stands between the eye and the bowler
    for (let k = 0; k <= 1; k += 0.05) {
      const p = { x: eye.x + (pitch.bowler.x - eye.x) * k, z: eye.z + (pitch.bowler.z - eye.z) * k }
      expect(district.occluders.find((o) => within(p, o, 0))).toBeUndefined()
    }
    district.dispose()
  })
})
