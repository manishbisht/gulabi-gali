import * as THREE from 'three'
import { dressOnly } from '../live/procession'
import { bakeHex, merge } from '../world/kit/parts'
import { DHOLAK_BACK } from '../world/shows'
import type { ShowKind } from '../world/types'

/*
 * The street shows' figures. Each show is a handful of rigid pieces, every one an instanced mesh on one shared
 * material (the procession's, so the three shows and a festival's line compile one shader between them): four
 * draw calls a show at most, three for the puppets and the musician, and fewer on the lowest tier. No skeletons:
 * a piece is moved by its instance matrix, written into buffers made once. Nothing here allocates per frame.
 *
 * A rig is drawn in its own frame: the show's `at` is the origin, its audience stands along +z.
 *
 * The lowest tier has fewer moving pieces (the musician's head holds still, the drummer's hands rest on the drum,
 * two dancers instead of three with their skirts part of the body) and no cloth sway (no puppet swing, no skirt
 * flare).
 */

export type Tier = 0 | 1 | 2

export interface ShowRig {
  group: THREE.Group
  /** Draw calls it costs (its meshes). */
  calls: number
  /**
   * Moves the figures on by `dt` seconds. `energy` is how much they perform (0 an idle pose, 1 the show, a little
   * for the lull after); `bow` is 0 to 1 as they bow to a clap; `face` is the way to the player in the rig's own
   * frame (radians about y, 0 along +z), whom the dancers turn to as they bow.
   */
  step(dt: number, energy: number, bow: number, face: number): void
  dispose(): void
}

// ---- pieces ------------------------------------------------------------------------------------

const SKIN = '#B9825A'
const WOOD = '#8A5A3A'
const BRASS = '#E0A526'
const CLOTH = '#F6EFE4'
const RED = '#B8452F'
const MARIGOLD = '#F2A81D'
const INDIGO = '#2F4F8A'
const PINK = '#D6336C'
const BLACK = '#1D1B22'
/** The pure white the shared material reads as "dress": it takes the instance's colour (see `dressOnly`). */
const DRESS = '#ffffff'

type V3 = readonly [number, number, number]

function piece(g: THREE.BufferGeometry, x: number, y: number, z: number, hex: string) {
  g.translate(x, y, z)
  return bakeHex(g, hex)
}
/** A box with its base's middle at (x, y, z). */
const block = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string) =>
  piece(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, hex)
const cyl = (
  rTop: number,
  rBot: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  hex: string,
) => piece(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1), x, y + h / 2, z, hex)
const ball = (r: number, x: number, y: number, z: number, hex: string) =>
  piece(new THREE.SphereGeometry(r, 6, 4), x, y, z, hex)
const cone = (r: number, h: number, seg: number, x: number, y: number, z: number, hex: string) =>
  piece(new THREE.ConeGeometry(r, h, seg), x, y + h / 2, z, hex)

const Z = new THREE.Vector3(0, 0, 1)
/** A square rod from `a` to `b`: an arm, a bow, an instrument's neck. Build-time only. */
function rod(a: V3, b: V3, thick: number, hex: string) {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const len = dir.length()
  const g = new THREE.BoxGeometry(thick, thick, len)
  g.translate(0, 0, len / 2)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z, dir.normalize()))
  return piece(g, a[0], a[1], a[2], hex)
}

/** A seated figure's legs, body and head (a safa on it), on a mat: the musician and the drummer. */
function seated(mat: string, kurta: string, safa: string, head: boolean) {
  return [
    block(1.7, 0.04, 1.3, 0, 0, 0.1, mat),
    block(1.7, 0.045, 0.1, 0, 0, 0.6, MARIGOLD),
    block(1.7, 0.045, 0.1, 0, 0, -0.4, MARIGOLD),
    block(0.74, 0.2, 0.5, 0, 0.04, 0.1, CLOTH), // crossed legs under a dhoti
    cyl(0.2, 0.25, 0.5, 6, 0, 0.22, -0.05, kurta),
    cyl(0.255, 0.255, 0.07, 6, 0, 0.26, -0.05, PINK), // kamarband
    ...(head ? headPieces(0, 0.72, -0.05, safa) : []),
  ]
}
/** A head in a safa, its neck's foot at (x, y, z). */
function headPieces(x: number, y: number, z: number, safa: string) {
  return [
    cyl(0.06, 0.07, 0.08, 5, x, y, z, SKIN),
    ball(0.12, x, y + 0.18, z, SKIN),
    cyl(0.17, 0.15, 0.12, 7, x, y + 0.24, z, safa),
    ball(0.12, x, y + 0.37, z, safa),
    block(0.07, 0.26, 0.03, x + 0.1, y + 0.02, z - 0.14, safa), // the safa's tail, down the back
  ]
}

// ---- the three shows ---------------------------------------------------------------------------

const dummy = new THREE.Object3D()
const WHITE = new THREE.Color('#ffffff')
const tint = new THREE.Color()

/** What every rig is built with: the shared material, and a way to make a piece's mesh. */
interface Kit {
  /** `n` instances of a geometry, all white (untinted) until told otherwise. */
  mesh(g: THREE.BufferGeometry, n: number, name: string): THREE.InstancedMesh
}

/** Writes instance `i` of `m` from the dummy, as it was just posed. */
function put(m: THREE.InstancedMesh, i: number) {
  dummy.updateMatrix()
  m.setMatrixAt(i, dummy.matrix)
  m.instanceMatrix.needsUpdate = true
}
/** Sets the dummy upright at a place. */
function at(x: number, y: number, z: number) {
  dummy.position.set(x, y, z)
  dummy.rotation.set(0, 0, 0)
  dummy.scale.set(1, 1, 1)
}

/**
 * The kathputli stage: a cloth-fronted platform under a painted backdrop, the puppeteer standing behind it with
 * his arms over the top, and two string puppets (a raja and a dancer) on the platform.
 */
function kathputli(kit: Kit, tier: Tier): ShowRig['step'] {
  const BACK = -0.42
  const stage = kit.mesh(
    merge([
      block(2.4, 0.35, 1.0, 0, 0, 0.1, WOOD),
      block(2.44, 0.36, 0.04, 0, 0, 0.62, RED), // the cloth down the platform's front
      block(2.44, 0.07, 0.05, 0, 0.3, 0.62, MARIGOLD),
      block(0.07, 2.1, 0.07, -1.2, 0, BACK, WOOD),
      block(0.07, 2.1, 0.07, 1.2, 0, BACK, WOOD),
      block(2.4, 1.15, 0.05, 0, 0.35, BACK, INDIGO), // the backdrop
      block(2.4, 0.1, 0.06, 0, 1.4, BACK, MARIGOLD),
      ...[-0.9, -0.3, 0.3, 0.9].map((x) => block(0.1, 0.9, 0.06, x, 0.45, BACK, PINK)),
      block(2.5, 0.22, 0.06, 0, 1.9, BACK, RED), // the valance across the top
      block(2.5, 0.05, 0.07, 0, 1.9, BACK, MARIGOLD),
      // the puppeteer, behind the backdrop: seen from the chest up
      block(0.32, 1.0, 0.2, 0, 0, -0.9, CLOTH),
      cyl(0.2, 0.23, 0.55, 6, 0, 1.0, -0.9, CLOTH),
      ...headPieces(0, 1.52, -0.9, RED),
    ]),
    1,
    'show-kathputli-stage',
  )
  at(0, 0, 0)
  put(stage, 0)

  // a puppet: skirted, arms out, a carved face under a crown, hanging from two strings
  const puppets = kit.mesh(
    merge([
      cyl(0.06, 0.17, 0.3, 6, 0, 0, 0, DRESS),
      cyl(0.07, 0.06, 0.14, 6, 0, 0.3, 0, DRESS),
      block(0.34, 0.04, 0.04, 0, 0.37, 0, DRESS),
      ball(0.07, 0, 0.5, 0, '#E7B07A'),
      cone(0.07, 0.11, 5, 0, 0.55, 0, BRASS),
      block(0.012, 0.8, 0.012, -0.15, 0.4, 0, '#3A2A2A'),
      block(0.012, 0.8, 0.012, 0.15, 0.4, 0, '#3A2A2A'),
    ]),
    2,
    'show-kathputli-puppets',
  )
  puppets.setColorAt(0, tint.set('#F26B3A'))
  puppets.setColorAt(1, tint.set('#2F9FB0'))

  // the puppeteer's arms: from the shoulder (the piece's origin) forward over the backdrop, a hand at the end
  const arms = kit.mesh(
    merge([rod([0, 0, 0], [0, 0, 0.72], 0.07, CLOTH), ball(0.05, 0, 0, 0.75, SKIN)]),
    2,
    'show-kathputli-arms',
  )

  const FLOOR = 0.37
  let time = 0
  const step = (dt: number, energy: number, bow: number) => {
    time += dt
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1
      const phase = i * Math.PI
      const hop = Math.abs(Math.sin(time * 4.5 + phase))
      const x = side * 0.5 + Math.sin(time * 1.1 + phase) * 0.3 * energy
      // the dancer twirls twice round every ten seconds, the raja only turns from side to side
      const w = Math.min(Math.max(((time % 10) - 6) / 3, 0), 1)
      const twirl = i === 1 ? w * w * (3 - 2 * w) * Math.PI * 4 * energy : 0
      at(x, FLOOR + hop * 0.1 * energy - bow * 0.03, 0.12)
      dummy.rotation.set(
        bow * 0.8,
        Math.sin(time * 2.2 + phase) * 0.9 * energy + twirl,
        // the swing on the strings is cloth sway: not on the lowest tier
        tier === 0 ? 0 : Math.sin(time * 4.5 + phase) * 0.22 * energy,
      )
      put(puppets, i)
      // the arm over it follows it along the stage and dips with each hop
      at(side * 0.24, 1.56, -0.86)
      dummy.rotation.set(-0.12 - hop * 0.1 * energy + bow * 0.2, (x - side * 0.24) * 0.9, 0)
      put(arms, i)
    }
  }
  return step
}

/**
 * The ravanhatta player: seated on a dari, the coconut-shell bowl of the instrument at his chest and its bamboo
 * neck over his left shoulder, drawing a bow hung with little bells across it.
 */
function ravanhatta(kit: Kit, tier: Tier): ShowRig['step'] {
  const BOWL: V3 = [-0.06, 0.5, 0.24]
  const TOP: V3 = [-0.44, 1.02, 0.4]
  const body = kit.mesh(
    merge([
      ...seated(RED, CLOTH, '#F26B3A', false),
      // the instrument: bowl, hide, neck and two pegs
      ball(0.11, BOWL[0], BOWL[1], BOWL[2], '#6B4A2B'),
      cyl(0.085, 0.085, 0.02, 7, BOWL[0], BOWL[1] + 0.06, BOWL[2] + 0.06, '#E8D9B8'),
      rod(BOWL, TOP, 0.035, '#C9A66B'),
      block(0.14, 0.025, 0.025, TOP[0] + 0.03, TOP[1] - 0.08, TOP[2] - 0.02, WOOD),
      block(0.14, 0.025, 0.025, TOP[0] + 0.05, TOP[1] - 0.16, TOP[2] - 0.04, WOOD),
      // the left arm, up to the neck where the fingers stop the strings
      rod([-0.24, 0.64, -0.02], [-0.3, 0.8, 0.33], 0.07, CLOTH),
      ball(0.05, -0.3, 0.8, 0.33, SKIN),
    ]),
    1,
    'show-ravanhatta-body',
  )
  at(0, 0, 0)
  put(body, 0)

  // the head: its own piece, so it can sway with the tune and bow (its origin is the neck's foot)
  const head = kit.mesh(merge(headPieces(0, 0, 0, '#F26B3A')), 1, 'show-ravanhatta-head')
  // the bowing arm, from the right shoulder (its origin), with the bow across the strings
  const HAND: V3 = [0.02, -0.1, 0.32]
  const bowArm = kit.mesh(
    merge([
      rod([0, 0, 0], HAND, 0.07, CLOTH),
      ball(0.05, HAND[0], HAND[1], HAND[2], SKIN),
      rod([HAND[0] + 0.08, HAND[1] - 0.02, HAND[2]], [-0.62, 0.06, 0.4], 0.022, '#4A3222'),
      ball(0.022, -0.3, 0.0, 0.38, BRASS), // ghungroo on the bow
      ball(0.022, -0.45, 0.03, 0.4, BRASS),
    ]),
    1,
    'show-ravanhatta-bow',
  )
  // the bow travels along its own length
  const along = new THREE.Vector3(-0.72, 0.18, 0.08).normalize()

  let time = 0
  return (dt, energy, bow) => {
    time += dt
    // fewer moving pieces on the lowest tier: the head only bows
    const sway = tier === 0 ? 0 : energy
    at(0, 0.72, -0.05)
    dummy.rotation.set(Math.sin(time * 1.6) * 0.05 * sway + bow * 0.5, 0, Math.sin(time * 0.8) * 0.12 * sway)
    put(head, 0)
    const draw = Math.sin(time * 1.7) * 0.13 * energy
    at(0.24 + along.x * draw, 0.64 + along.y * draw - bow * 0.06, -0.02 + along.z * draw)
    dummy.rotation.set(bow * 0.2, 0, Math.sin(time * 1.7 + 0.6) * 0.05 * energy)
    put(bowArm, 0)
  }
}

/** The drummer's shoulders (his right's; the left is the same at -x), and from one to the drum's head. */
const SHOULDER = { x: 0.24, y: 0.62, z: -0.02 }
const REACH = { x: 0.12, y: -0.2, z: 0.32 }

/** How many dance, per tier. */
export const DANCERS: readonly [number, number, number] = [2, 3, 3]
/** The dancers circle this far from the middle of their ground. */
const RING = 1.6

/** A kalbelia-style skirt, its waist at the origin and its hem below: black, with bright bands. */
function skirtPieces() {
  return [
    cyl(0.17, 0.3, 0.3, 8, 0, -0.3, 0, BLACK),
    cyl(0.3, 0.33, 0.06, 8, 0, -0.36, 0, RED),
    cyl(0.33, 0.42, 0.3, 8, 0, -0.66, 0, BLACK),
    cyl(0.42, 0.44, 0.05, 8, 0, -0.71, 0, '#D9D9E0'),
    cyl(0.44, 0.46, 0.1, 8, 0, -0.81, 0, MARIGOLD),
  ]
}
const WAIST = 0.88

/**
 * The dancers: in black skirts banded in red, silver and marigold, an odhni over the head, turning as they
 * circle; a dholak player sits at the back of their ground and keeps the beat.
 */
function dancers(kit: Kit, tier: Tier): ShowRig['step'] {
  const n = DANCERS[tier]
  const upper = [
    cyl(0.15, 0.17, 0.34, 6, 0, WAIST, 0, BLACK),
    cyl(0.175, 0.175, 0.05, 6, 0, WAIST, 0, PINK),
    cyl(0.05, 0.06, 0.08, 5, 0, WAIST + 0.34, 0, SKIN),
    ball(0.11, 0, WAIST + 0.5, 0, SKIN),
    piece(
      new THREE.SphereGeometry(0.135, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2),
      0,
      WAIST + 0.52,
      -0.01,
      BLACK,
    ), // the odhni
    block(0.3, 0.62, 0.035, 0, WAIST - 0.02, -0.15, BLACK), // falling down the back
    block(0.3, 0.05, 0.04, 0, WAIST - 0.02, -0.15, RED),
    // the arms: one raised, one out to the side
    rod([-0.16, WAIST + 0.28, 0], [-0.46, WAIST + 0.56, 0.06], 0.06, SKIN),
    rod([0.16, WAIST + 0.28, 0], [0.5, WAIST + 0.16, 0.1], 0.06, SKIN),
    block(0.07, 0.05, 0.07, -0.42, WAIST + 0.49, 0.05, '#D9D9E0'), // bangles
    block(0.07, 0.05, 0.07, 0.44, WAIST + 0.15, 0.09, '#D9D9E0'),
  ]
  // on the lowest tier the skirt is part of the body: one piece a dancer, and no flare
  const split = tier > 0
  const body = kit.mesh(
    merge(split ? upper : [...upper, ...skirtPieces().map((g) => g.translate(0, WAIST, 0))]),
    n,
    'show-dancers',
  )
  const skirts = split ? kit.mesh(merge(skirtPieces()), n, 'show-dancers-skirts') : null

  // the dholak player at the back, facing the audience, the drum across his lap
  const drum = new THREE.CylinderGeometry(0.16, 0.16, 0.56, 8, 1)
  drum.rotateZ(Math.PI / 2)
  const head = (x: number) => {
    const g = new THREE.CylinderGeometry(0.15, 0.15, 0.02, 8, 1)
    g.rotateZ(Math.PI / 2)
    return piece(g, x, 0.36, 0.34, '#F3E3C3')
  }
  /** An arm down to the drum's head, from a shoulder at (x, y, z); `side` is 1 for his right, -1 for his left. */
  const arm = (side: number, x: number, y: number, z: number) => [
    rod([x, y, z], [x + side * REACH.x, y + REACH.y, z + REACH.z], 0.07, CLOTH),
    ball(0.055, x + side * REACH.x, y + REACH.y - 0.02, z + REACH.z + 0.03, SKIN),
  ]
  const drummer = kit.mesh(
    merge([
      ...seated(INDIGO, CLOTH, '#E4917A', true),
      piece(drum, 0, 0.36, 0.34, WOOD),
      head(-0.285),
      head(0.285),
      block(0.06, 0.34, 0.34, 0, 0.19, 0.34, RED), // the cloth band round its middle
      ...(split
        ? []
        : [...arm(-1, -SHOULDER.x, SHOULDER.y, SHOULDER.z), ...arm(1, SHOULDER.x, SHOULDER.y, SHOULDER.z)]),
    ]),
    1,
    'show-dancers-dholak',
  )
  at(0, 0, -DHOLAK_BACK)
  put(drummer, 0)
  // his arms: their own piece above the lowest tier, so they can beat. One geometry (the right arm, from its
  // shoulder) drawn twice: the left is it turned inward, never mirrored (a mirrored instance draws inside out)
  const hands = split ? kit.mesh(merge(arm(1, 0, 0, 0)), 2, 'show-dancers-hands') : null
  const INWARD = -2 * Math.atan2(REACH.x, REACH.z)

  const spin = new Float32Array(n)
  let orbit = 0
  let time = 0
  return (dt, energy, bow, face) => {
    time += dt
    orbit += dt * 0.55 * energy
    for (let i = 0; i < n; i++) {
      // each turns faster and slower in her own time
      const rate = energy * (1.2 + 2.6 * (0.5 + 0.5 * Math.sin(time * 0.5 + i * 2.1)))
      spin[i] = (spin[i]! + dt * rate) % (Math.PI * 2)
      const a = orbit + (i * Math.PI * 2) / n
      const x = Math.sin(a) * RING
      const z = Math.cos(a) * RING
      const bob = Math.abs(Math.sin(time * 3 + i)) * 0.05 * energy
      // bowing, she turns to whoever clapped (the short way round)
      const turn = Math.atan2(Math.sin(face - spin[i]!), Math.cos(face - spin[i]!))
      const ry = spin[i]! + turn * bow
      at(x, bob, z)
      dummy.rotation.set(bow * 0.4, ry, Math.sin(time * 3 + i) * 0.08 * energy, 'YXZ')
      put(body, i)
      if (skirts) {
        // the skirt opens out as she turns faster, and its hem lifts
        const flare = Math.min(rate / 3.8, 1)
        at(x, WAIST + bob, z)
        dummy.rotation.set(0, ry, 0)
        dummy.scale.set(1 + 0.45 * flare, 1 - 0.14 * flare, 1 + 0.45 * flare)
        put(skirts, i)
      }
    }
    if (hands)
      for (let i = 0; i < 2; i++) {
        // they strike in turn: an arm lifts a little between its beats
        const lift = (1 - Math.max(0, Math.sin(time * 8.7 + i * Math.PI))) * energy
        at((i === 0 ? 1 : -1) * SHOULDER.x, SHOULDER.y, SHOULDER.z - DHOLAK_BACK)
        dummy.rotation.set(-0.16 * lift, i === 0 ? 0 : INWARD, 0, 'YXZ')
        put(hands, i)
      }
    dummy.rotation.order = 'XYZ' // the dummy is shared: the next rig finds it as it expects
  }
}

const BUILD: Record<ShowKind, (kit: Kit, tier: Tier) => ShowRig['step']> = { kathputli, ravanhatta, dancers }

/** The one material every show's pieces share; the caller owns it. */
export function showMaterial(): THREE.Material {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
  m.onBeforeCompile = dressOnly
  return m
}

/** A show's figures in their idle pose, for a quality tier. */
export function createShowRig(kind: ShowKind, tier: Tier, material: THREE.Material): ShowRig {
  const group = new THREE.Group()
  group.name = `show-${kind}`
  const meshes: THREE.InstancedMesh[] = []
  const kit: Kit = {
    mesh(g, n, name) {
      const m = new THREE.InstancedMesh(g, material, n)
      m.name = name
      // the pieces move inside one small patch of ground: the group is hidden when far, never culled piece by piece
      m.frustumCulled = false
      m.castShadow = false
      for (let i = 0; i < n; i++) m.setColorAt(i, WHITE)
      meshes.push(m)
      group.add(m)
      return m
    },
  }
  const step = BUILD[kind](kit, tier)
  step(0, 0, 0, 0)
  return {
    group,
    calls: meshes.length,
    step,
    dispose() {
      group.removeFromParent()
      for (const m of meshes) {
        m.geometry.dispose()
        m.dispose()
      }
    },
  }
}
