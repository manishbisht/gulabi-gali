import * as THREE from 'three'
import { expect, it, vi } from 'vitest'
import type { MapTarget } from './cityMap'
import type { Vec2 } from './types'
import { createWayfinder, type WayReading } from './wayfinder'

/** A session's listeners, driven by hand. */
function fakeSession() {
  let frame: ((dt: number, pos: Vec2) => void) | null = null
  let leave: (() => void) | null = null
  return {
    onFrame: (cb: (dt: number, pos: Vec2) => void) => {
      frame = cb
      return () => void (frame = null)
    },
    onLeave: (cb: () => void) => {
      leave = cb
      return () => void (leave = null)
    },
    step: (pos: Vec2) => frame?.(1 / 30, pos),
    leave: () => leave?.(),
    listening: () => frame !== null || leave !== null,
  }
}

const HAWA: MapTarget = {
  id: 'hawa-mahal',
  kind: 'landmark',
  name: { hi: 'Hawa Mahal', en: 'Hawa Mahal' },
  at: { x: 36, z: -18 },
  area: { minX: 22, maxX: 50, minZ: -21.5, maxZ: -14.5 },
}

function setup() {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 5, 10)
  camera.lookAt(0, 0, 0) // looking north, as the chase camera does
  camera.updateMatrixWorld()
  const session = fakeSession()
  const onCleared = vi.fn()
  const way = createWayfinder({ scene, camera, session, onCleared, reducedMotion: () => true })
  const readings: (WayReading | null)[] = []
  way.watch((r) => readings.push(r))
  const marker = () => scene.getObjectByName('map-target')
  return { scene, camera, session, onCleared, way, readings, marker }
}

it('no target, no marker and no readings: nothing nags', () => {
  const { session, readings, marker } = setup()
  session.step({ x: 0, z: 40 })
  expect(marker()).toBeUndefined()
  expect(readings).toEqual([])
})

it('a target puts a pillar up at it and reads its distance and arrow, only when they change', () => {
  const { way, session, readings, marker } = setup()
  way.set(HAWA)
  expect(marker()!.position.x).toBe(36)
  expect(marker()!.position.z).toBe(-18)
  session.step({ x: 36, z: 45.5 }) // 60 m south of its face, looking north at it
  session.step({ x: 36, z: 45.5 })
  expect(readings).toEqual([{ target: HAWA, distance: 60, angle: 0 }])
  session.step({ x: 46, z: -4.5 }) // closer, south-east of its middle: the arrow turns left
  expect(readings.at(-1)!.distance).toBe(10)
  expect(readings.at(-1)!.angle).toBeLessThan(-20)
})

it('arriving within 6 m clears the target and takes the pillar down', () => {
  const { way, session, onCleared, marker } = setup()
  way.set(HAWA)
  session.step({ x: 36, z: -8.6 }) // 5.9 m from its face
  expect(onCleared).toHaveBeenCalledOnce()
  expect(marker()).toBeUndefined()
  expect(way.target()).toBeNull()
})

it('one pillar, made once and moved: a new target reuses it; leaving the district disposes it', () => {
  const { way, session, marker } = setup()
  way.set(HAWA)
  const pillar = marker() as THREE.Mesh
  way.clear()
  way.set({ id: 'b', kind: 'bench', name: { hi: 'Bench', en: 'Bench' }, at: { x: 30, z: 20 } })
  expect(marker()).toBe(pillar)
  const geometry = vi.spyOn(pillar.geometry, 'dispose')
  const material = vi.spyOn(pillar.material as THREE.Material, 'dispose')
  session.leave()
  expect(marker()).toBeUndefined()
  expect(geometry).toHaveBeenCalled()
  expect(material).toHaveBeenCalled()
  // the next district makes a fresh one
  way.set(HAWA)
  expect(marker()).not.toBe(pillar)
})

it('photo mode: the pillar hides (and stays hidden for a new target), and a capture always leaves it out', () => {
  const { way, marker } = setup()
  way.set(HAWA)
  expect(marker()!.userData.noPhoto).toBe(true)
  way.setHidden(true)
  expect(marker()!.visible).toBe(false)
  way.set({ id: 'b', kind: 'bench', name: { hi: 'Bench', en: 'Bench' }, at: { x: 30, z: 20 } })
  expect(marker()!.visible).toBe(false)
  way.setHidden(false)
  expect(marker()!.visible).toBe(true)
})

it('reads prefers-reduced-motion once, not every frame', () => {
  const matchMedia = vi.fn(() => ({ matches: false }) as MediaQueryList)
  vi.stubGlobal('matchMedia', matchMedia)
  try {
    const scene = new THREE.Scene()
    const session = fakeSession()
    const way = createWayfinder({ scene, camera: new THREE.PerspectiveCamera(), session, onCleared() {} })
    way.set(HAWA)
    for (let i = 0; i < 30; i++) session.step({ x: 36, z: 45.5 })
    expect(matchMedia.mock.calls.length).toBeLessThanOrEqual(1)
    way.dispose()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('leaving the district clears the target; clear() does too; dispose lets go of the session', () => {
  const { way, session, onCleared, marker } = setup()
  way.set(HAWA)
  session.leave()
  expect(marker()).toBeUndefined()
  expect(onCleared).toHaveBeenCalledOnce()
  way.set(HAWA)
  way.clear()
  expect(marker()).toBeUndefined()
  way.set(HAWA)
  way.dispose()
  expect(marker()).toBeUndefined()
  expect(session.listening()).toBe(false)
})

it('a new target moves the pillar; one pillar at a time', () => {
  const { scene, way, marker } = setup()
  way.set(HAWA)
  way.set({ id: 'b', kind: 'bench', name: { hi: 'Bench', en: 'Bench' }, at: { x: 30, z: 20 } })
  expect(scene.children.filter((c) => c.name === 'map-target')).toHaveLength(1)
  expect(marker()!.position.z).toBe(20)
})
