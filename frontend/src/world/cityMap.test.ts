// @vitest-environment happy-dom
import * as THREE from 'three'
import { expect, it } from 'vitest'
import type { LivePerson } from '../net/protocol'
import { benchesOf } from './benches'
import {
  ARRIVE_M,
  bearing,
  compassAngle,
  mapItems,
  mapPeople,
  targetDistance,
  viewHeading,
  type MapTarget,
} from './cityMap'
import walledCity from './districts/walledCity'
import amer from './districts/amer'
import { createPeople } from './people'
import { wallsOf } from './posters'

it('bearing is degrees clockwise from north (-z): north 0, east 90, south 180, west 270', () => {
  const o = { x: 0, z: 0 }
  expect(bearing(o, { x: 0, z: -10 })).toBeCloseTo(0)
  expect(bearing(o, { x: 10, z: 0 })).toBeCloseTo(90)
  expect(bearing(o, { x: 0, z: 10 })).toBeCloseTo(180)
  expect(bearing(o, { x: -10, z: 0 })).toBeCloseTo(270)
  expect(bearing(o, { x: 10, z: -10 })).toBeCloseTo(45)
  // from somewhere else than the origin: only the difference counts
  expect(bearing({ x: 5, z: 5 }, { x: 5, z: -100 })).toBeCloseTo(0)
})

it("the compass arrow turns by the target's bearing less the way the view looks, kept within ±180", () => {
  expect(compassAngle(90, 0)).toBe(90) // looking north, a target to the east is to the right
  expect(compassAngle(90, 90)).toBe(0) // looking east at it: straight ahead
  expect(compassAngle(0, 270)).toBe(90) // looking west, north is to the right
  expect(compassAngle(350, 10)).toBe(-20)
  expect(compassAngle(10, 350)).toBe(20)
  expect(compassAngle(180, 0)).toBe(180) // straight behind
})

it("the view's heading is read from the camera's own direction, so it holds whatever turns the camera", () => {
  const camera = new THREE.PerspectiveCamera()
  const dir = new THREE.Vector3()
  camera.position.set(0, 5, 10)
  camera.lookAt(0, 0, 0) // looking north
  camera.updateMatrixWorld()
  expect(viewHeading(camera, dir)).toBeCloseTo(0)
  camera.position.set(-10, 5, 0)
  camera.lookAt(0, 0, 0) // looking east
  camera.updateMatrixWorld()
  expect(viewHeading(camera, dir)).toBeCloseTo(90)
  camera.position.set(10, 5, 0)
  camera.lookAt(0, 0, 0) // looking west: 270, never -90
  camera.updateMatrixWorld()
  expect(viewHeading(camera, dir)).toBeCloseTo(270)
})

it('distance to a landmark is to the edge of its footprint (0 inside); to a bench, to its point', () => {
  const hawa = walledCity.landmarks.find((l) => l.id === 'hawa-mahal')!
  const t: MapTarget = {
    id: 'hawa-mahal',
    kind: 'landmark',
    name: hawa.name,
    at: hawa.at,
    area: hawa.footprint,
  }
  // Hawa Mahal is 28 x 7 at (36, -18): its south face is at z = -14.5
  expect(targetDistance({ x: 36, z: -4.5 }, t)).toBeCloseTo(10)
  expect(targetDistance({ x: 36, z: -18 }, t)).toBe(0)
  const bench: MapTarget = { id: 'b', kind: 'bench', name: { hi: 'Bench', en: 'Bench' }, at: { x: 0, z: 0 } }
  expect(targetDistance({ x: 3, z: 4 }, bench)).toBeCloseTo(5)
  expect(ARRIVE_M).toBe(6)
})

it("a district's map items: every landmark (stamped or not), the metro, every bench and tapri, every poster wall", () => {
  const items = mapItems(walledCity, ['hawa-mahal'])
  const of = (kind: string) => items.filter((i) => i.kind === kind)
  expect(of('landmark').map((l) => [l.id, l.stamped])).toEqual([
    ['hawa-mahal', true],
    ['jantar-mantar', false],
    ['tripolia-gate', false],
    ['badi-chaupar', false],
  ])
  expect(of('metro')).toHaveLength(1)
  expect(of('metro')[0]!.at).toEqual(walledCity.station)
  expect(of('bench').length + of('tapri').length).toBe(benchesOf(walledCity).length)
  expect(of('poster').map((p) => p.at)).toEqual(wallsOf(walledCity).map((w) => w.at))
  // every item has a name in both languages, and its own id
  for (const i of items) expect(i.name.hi && i.name.en).toBeTruthy()
  expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
  expect(of('metro')[0]!.name).toEqual({ hi: 'Metro station', en: 'Metro station' })
})

it('Amer has no metro: its map names the bus stand there instead, under the same id', () => {
  const stop = mapItems(amer, []).find((i) => i.id === 'metro')!
  expect(stop.kind).toBe('metro')
  expect(stop.at).toEqual(amer.station)
  expect(stop.name).toEqual({ hi: 'Bus stand', en: 'Bus stop' })
})

const person = (id: string, x: number, z: number): LivePerson => ({
  id,
  name: id,
  look: { skin: 1, outfit: 'teal', head: 'none' },
  status: '',
  x,
  z,
  ry: 0,
})

it('privacy: the map shows only people drawn on the street now; never a ghost, a hidden or blocked person, or the viewer', () => {
  const scene = new THREE.Scene()
  const people = createPeople(scene)
  // the server lists only visible residents, never ghosts; the viewer's own entry is never one of the others
  people.apply({
    t: 'welcome',
    you: { id: 'me', visible: true },
    people: [person('me', 0, 0), person('asha', 4, 0), person('ravi', 6, 0), person('far', 100, 0)],
  })
  // a ghost's moves are never relayed; if one ever arrived, it would have nobody to move
  people.apply({ t: 'moves', m: [['ghost', 2, 2, 0]] })
  // Ravi went invisible (or blocked, or was blocked by, the viewer): the server says he left
  people.apply({ t: 'leave', id: 'ravi' })
  people.update(1, { x: 0, z: 0 })
  const dots = mapPeople(people.entries())
  expect(dots).toEqual([{ x: 4, z: 0 }])
  // someone further than the street draws (frozen where last heard of) is not shown either
  expect(people.entries().map((e) => e.person.id)).toContain('far')
  people.dispose()
})
