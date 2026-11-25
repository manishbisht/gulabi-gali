import * as THREE from 'three'
import type { Stage } from '../engine/stage'
import { CREASE_M, kidGeometry, pitchFrame, PITCH_HALF_WIDTH, type PitchFrame } from '../world/cricketPitch'
import { bakeHex, merge } from '../world/kit/parts'
import { PALETTE } from '../world/palette'
import type { PitchDef } from '../world/types'
import { ONE_S, RESULT_S, RUNUP_S, type CricketState } from './cricket'

/** The batter's eye: this far behind the stumps and this high, looking down the pitch at the bowler. */
const EYE_BACK = 1.5
const EYE_Y = 1.45
/** Where the ball leaves the hand, and how high it is at the bat. */
const HAND_Y = 1.25
const BAT_Y = 0.55
const BALL_R = 0.1
/** How far down its flight the ball pitches (its one bounce on the way in). */
const PITCHES_AT = 0.62
/** The bat's swing, in seconds, from the backlift through the line of the ball. */
const SWING_S = 0.22
/** A six or a wicket shakes the view this long (never under reduced motion). */
const SHAKE_S = 0.35
const TENNIS_BALL = '#D4E157'

/**
 * Where the game's camera stands for a pitch: behind the stumps, at a batter's eye. Written into `out`.
 * (cricketPitch.test.ts keeps every pitch's ground clear this far back.)
 */
export function cricketEye(f: PitchFrame, out: { x: number; y: number; z: number }) {
  out.x = f.x - f.fx * EYE_BACK
  out.y = EYE_Y
  out.z = f.z - f.fz * EYE_BACK
  return out
}

/**
 * Where the ball is, in the pitch's own axes (`along` from the stumps toward the bowler, `side` across,
 * `y` up), for this moment of the innings. Written into `out`: nothing is allocated.
 */
export function ballAt(s: CricketState, length: number, out: { along: number; side: number; y: number }) {
  const from = length - 0.4
  const side = s.line * PITCH_HALF_WIDTH * 0.45
  if (s.phase === 'ready' || s.phase === 'runup' || s.phase === 'over') {
    // in the bowler's hand
    out.along = from
    out.side = 0.22
    out.y = HAND_Y - 0.25
    return out
  }
  if (s.phase === 'flight') {
    const u = s.t / s.flight
    if (u <= 1) {
      out.along = from + (CREASE_M - from) * u
      out.side = side * u
      if (u < PITCHES_AT) {
        const k = u / PITCHES_AT
        out.y = HAND_Y - (HAND_Y - BALL_R) * k * k
      } else {
        const k = (u - PITCHES_AT) / (1 - PITCHES_AT)
        out.y = BALL_R + (BAT_Y - BALL_R) * k + 0.5 * k * (1 - k)
      }
    } else {
      // past the bat: on to the stumps, or by them
      const k = Math.min(1, (s.t - s.flight) / ONE_S)
      out.along = CREASE_M * (1 - k)
      out.side = side
      out.y = BAT_Y - 0.2 * k
    }
    return out
  }
  // what came of it
  const k = Math.min(1, s.t / RESULT_S)
  const way = s.line >= 0 ? -1 : 1 // hit away from the line it came on
  switch (s.last) {
    case 'six':
      out.along = CREASE_M + 30 * k
      out.side = way * 3 * k
      out.y = BAT_Y + 16 * k - 9 * k * k
      break
    case 'four':
      out.along = CREASE_M + 24 * k
      out.side = way * 2.2 * k
      out.y = BALL_R + 0.5 * Math.abs(Math.sin(k * 9)) * (1 - k)
      break
    case 'two':
      out.along = CREASE_M + 11 * k
      out.side = way * 1.6 * k
      out.y = Math.max(BALL_R, BAT_Y + 5 * k - 8 * k * k)
      break
    case 'one':
      out.along = CREASE_M + 6 * k * (2 - k) * 0.6
      out.side = way * 1.2 * k
      out.y = BALL_R
      break
    case 'caught': {
      // up, one bounce, and into the bowler's hands
      const c = Math.min(1, k * 1.7)
      out.along = CREASE_M + (from - CREASE_M) * c
      out.side = 0.22 * c
      out.y =
        c < 0.6
          ? Math.max(BALL_R, BAT_Y + 9 * c - 15.9 * c * c)
          : BALL_R + (HAND_Y - 0.25 - BALL_R) * ((c - 0.6) / 0.4) + 1.2 * (c - 0.6) * (1 - c)
      break
    }
    case 'bowled':
      // it stops in the bricks and drops
      out.along = 0.12
      out.side = 0
      out.y = Math.max(BALL_R, BAT_Y - 0.2 - 2 * k)
      break
    default:
      // a dot ball: on past the stumps
      out.along = -4 * k
      out.side = side * (1 + k)
      out.y = Math.max(BALL_R, BAT_Y - 0.2 - 0.3 * k)
  }
  return out
}

export interface CricketView {
  /** How many fielders are drawn (none without `extras`). */
  readonly fielders: number
  /** Looks down the pitch from the batting crease and draws this moment: the ball, the bat, the bowler's run. */
  update(state: CricketState, dt: number): void
  dispose(): void
}

/**
 * The drawing of an innings, over the pitch that already stands in the lane: a ball, the bat in the batter's
 * hands (the view is the batter's own), the bowler's hop as they run in, and, with `extras` (never at the
 * lowest tier), three fielders. The world keeps rendering around it. `calm` (reduced motion) keeps the view
 * still: the ball still travels, which is the game. Allocates nothing per frame.
 */
export function createCricketView(
  stage: Stage,
  pitch: PitchDef,
  opts: { extras: boolean; calm: boolean },
): CricketView {
  const { camera, scene } = stage
  const f = pitchFrame(pitch)
  const group = new THREE.Group()
  group.name = 'cricket-game'
  const material = new THREE.MeshLambertMaterial({ vertexColors: true })

  const ballGeometry = bakeHex(new THREE.SphereGeometry(BALL_R, 8, 6), TENNIS_BALL)
  const ball = new THREE.Mesh(ballGeometry, material)
  ball.frustumCulled = false

  // the bat hangs from its handle (the pivot): a blade of pale wood, a taped handle
  const blade = new THREE.BoxGeometry(0.11, 0.56, 0.04)
  blade.translate(0, -0.52, 0)
  const handle = new THREE.BoxGeometry(0.045, 0.26, 0.045)
  handle.translate(0, -0.12, 0)
  const batGeometry = merge([bakeHex(blade, PALETTE.sandstone), bakeHex(handle, PALETTE.road)])
  const bat = new THREE.Mesh(batGeometry, material)
  bat.frustumCulled = false
  /** Rides with the camera, so the bat is always in the batter's hands. */
  const hands = new THREE.Group()
  hands.add(bat)
  bat.position.set(0.3, -0.18, -0.85)
  group.add(ball, hands)

  // fielders: one at mid-off, one at mid-on, one deep behind the bowler, all off the pitch's own line
  let fielders: THREE.InstancedMesh | null = null
  let fielderGeometry: THREE.BufferGeometry | null = null
  if (opts.extras) {
    fielderGeometry = kidGeometry(PALETTE.teal)
    fielders = new THREE.InstancedMesh(fielderGeometry, material, 3)
    const dummy = new THREE.Object3D()
    const spots = [
      [f.length * 0.55, 2.1],
      [f.length + 1.8, -1.9],
      [f.length + 4.2, 1.5],
    ] as const
    spots.forEach(([along, side], i) => {
      dummy.position.set(f.x + f.fx * along - f.fz * side, 0, f.z + f.fz * along + f.fx * side)
      // they face the bat (a kid's front is -z)
      dummy.rotation.y = Math.atan2(f.fx, f.fz)
      dummy.updateMatrix()
      fielders!.setMatrixAt(i, dummy.matrix)
    })
    fielders.instanceMatrix.needsUpdate = true
    group.add(fielders)
  }
  scene.add(group)

  /** The kid who stands at the pitch all day (see `buildPitch`): the game makes them run in. */
  const bowler = scene.getObjectByName('cricket-bowler') ?? null
  const bowlerHome = bowler ? bowler.position.clone() : null
  const bowlerTurn = bowler ? bowler.rotation.x : 0

  const eye = cricketEye(f, { x: 0, y: 0, z: 0 })
  const target = new THREE.Vector3(f.x + f.fx * f.length * 0.7, 0.75, f.z + f.fz * f.length * 0.7)
  const at = { along: 0, side: 0, y: 0 }
  let shake = 0
  let seq = 0

  return {
    fielders: fielders?.count ?? 0,
    update(s, dt) {
      // a six or a wicket: a short shake of the view, unless motion is to be kept down
      if (s.seq !== seq) {
        seq = s.seq
        if (!opts.calm && (s.last === 'six' || s.last === 'bowled')) shake = SHAKE_S
      }
      shake = Math.max(0, shake - dt)
      const j = shake > 0 ? (shake / SHAKE_S) * 0.035 : 0
      camera.position.set(eye.x + Math.sin(shake * 71) * j, eye.y + Math.sin(shake * 53) * j, eye.z)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      hands.position.copy(camera.position)
      hands.quaternion.copy(camera.quaternion)

      ballAt(s, f.length, at)
      ball.position.set(f.x + f.fx * at.along - f.fz * at.side, at.y, f.z + f.fz * at.along + f.fx * at.side)

      // the bat: held back, then through the line of the ball and round
      const k = Math.min(1, s.swing / SWING_S)
      const through = s.swing < 0.6 ? k : Math.max(0, 1 - (s.swing - 0.6) / 0.25)
      bat.rotation.set(-0.5 + through * 1.5, 0, -0.55 + through * 1.5)

      if (bowler && bowlerHome) {
        // the run-up: three hops in, a lean into the delivery, then back to the mark
        const run = s.phase === 'runup' ? s.t / RUNUP_S : 0
        bowler.position.y = bowlerHome.y + Math.abs(Math.sin(run * Math.PI * 3)) * 0.14
        // (the pitch group lies along its own +z; the kid runs toward the bat, its -z)
        bowler.position.z = bowlerHome.z - run * 0.5
        bowler.rotation.x = s.phase === 'flight' && s.t < 0.25 ? -0.35 : bowlerTurn
      }
    },
    dispose() {
      if (bowler && bowlerHome) {
        bowler.position.copy(bowlerHome)
        bowler.rotation.x = bowlerTurn
      }
      group.removeFromParent()
      fielders?.dispose()
      fielderGeometry?.dispose()
      ballGeometry.dispose()
      batGeometry.dispose()
      material.dispose()
    },
  }
}
