// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, expect, it } from 'vitest'
import type { LivePerson } from '../net/protocol'
import { createPeople, createPeopleLabels } from './people'

afterEach(() => {
  document.body.innerHTML = ''
})

const asha: LivePerson = {
  id: 'dev:asha',
  name: 'Asha',
  look: { skin: 1, outfit: 'teal', head: 'dupatta' },
  status: 'chai pe',
  x: 0,
  z: 0,
  ry: 0,
}
const ravi: LivePerson = { ...asha, id: 'dev:ravi', name: 'Ravi', x: 5, z: 5 }

function welcome(people: LivePerson[], you: string | null = null) {
  return { t: 'welcome', you: { id: you, visible: you !== null }, people } as const
}

const bodies = (scene: THREE.Scene) => scene.children.filter((c) => c.name.startsWith('person-'))

it('people interpolate without overshoot and remove on leave', () => {
  const scene = new THREE.Scene()
  const people = createPeople(scene)
  people.apply(welcome([asha, ravi]))
  expect(bodies(scene)).toHaveLength(2)
  expect(people.list().map((p) => [p.id, p.x, p.z])).toEqual([
    ['dev:asha', 0, 0],
    ['dev:ravi', 5, 5],
  ])

  people.apply({ t: 'moves', m: [['dev:asha', 4, 0, Math.PI / 2]] })
  // 120 ms time constant: one constant in, about 63% of the way
  people.update(0.12)
  const x1 = people.list()[0]!.x
  expect(x1).toBeGreaterThan(2.4)
  expect(x1).toBeLessThan(2.6)
  let prev = x1
  for (let i = 0; i < 200; i++) {
    people.update(1 / 30)
    const { x } = people.list()[0]!
    expect(x).toBeGreaterThanOrEqual(prev)
    expect(x).toBeLessThanOrEqual(4)
    prev = x
  }
  expect(prev).toBeCloseTo(4, 3)
  // a long stall lands exactly on the target, never past it
  people.apply({ t: 'moves', m: [['dev:asha', 10, 0, 0]] })
  people.update(5)
  expect(people.list()[0]!.x).toBe(10)

  people.apply({ t: 'leave', id: 'dev:asha' })
  expect(people.list().map((p) => p.id)).toEqual(['dev:ravi'])
  expect(bodies(scene)).toHaveLength(1)
  people.dispose()
  expect(bodies(scene)).toHaveLength(0)
})

it('turns the short way round', () => {
  const people = createPeople(new THREE.Scene())
  people.apply(welcome([{ ...asha, ry: 3 }]))
  people.apply({ t: 'moves', m: [['dev:asha', 0, 0, -3]] })
  people.update(0.05)
  // from 3 to -3 is 0.28 rad across ±π, not 6 rad back through 0
  const { ry } = people.list()[0]!
  expect(Math.abs(ry)).toBeGreaterThan(3)
  people.dispose()
})

it('a join for someone already listed updates them in place', () => {
  const scene = new THREE.Scene()
  const people = createPeople(scene)
  people.apply(welcome([asha]))
  const before = bodies(scene)[0]!
  people.apply({
    t: 'join',
    p: { ...asha, name: 'Asha R', status: 'naya status', look: { skin: 4, outfit: 'pink', head: 'safa' } },
  })
  expect(bodies(scene)).toHaveLength(1)
  expect(bodies(scene)[0]).toBe(before)
  const [p] = people.list()
  expect(p).toMatchObject({ name: 'Asha R', status: 'naya status', look: { skin: 4, outfit: 'pink' } })
  people.apply({ t: 'status', id: 'dev:asha', text: 'phir se' })
  expect(people.list()[0]!.status).toBe('phir se')
  people.dispose()
})

it('a new welcome replaces the list, and never lists the viewer', () => {
  const scene = new THREE.Scene()
  const people = createPeople(scene)
  people.apply(welcome([asha, ravi]))
  people.apply(welcome([ravi], 'dev:asha'))
  expect(people.list().map((p) => p.id)).toEqual(['dev:ravi'])
  people.apply({ t: 'join', p: asha }) // ourselves, from another socket: not someone else
  expect(people.list().map((p) => p.id)).toEqual(['dev:ravi'])
  expect(bodies(scene)).toHaveLength(1)
  people.dispose()
})

it('picks the person a ray passes through', () => {
  const people = createPeople(new THREE.Scene())
  people.apply(welcome([asha, ravi]))
  const ray = new THREE.Raycaster(new THREE.Vector3(5, 1, 20), new THREE.Vector3(0, 0, -1))
  expect(people.pick(ray)?.id).toBe('dev:ravi')
  ray.set(new THREE.Vector3(-20, 1, 20), new THREE.Vector3(0, 0, -1))
  expect(people.pick(ray)).toBeNull()
  people.dispose()
})

it('casts shadows only when asked', () => {
  const scene = new THREE.Scene()
  const people = createPeople(scene)
  people.apply(welcome([asha]))
  const mesh = () => bodies(scene)[0]!.children.find((c) => c instanceof THREE.Mesh && c.name !== 'tap')!
  expect(mesh().castShadow).toBe(false)
  people.setShadows(true)
  expect(mesh().castShadow).toBe(true)
  people.apply({ t: 'join', p: ravi })
  expect(bodies(scene)[1]!.children[0]!.castShadow).toBe(true)
  people.setShadows(false)
  expect(mesh().castShadow).toBe(false)
  people.dispose()
})

it('labels the nearest people with name and status, from a fixed pool, without the character badge', () => {
  const host = document.body.appendChild(document.createElement('div'))
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
  camera.position.set(0, 3, 12)
  camera.lookAt(0, 1, 0)
  camera.updateMatrixWorld()
  const people = createPeople(new THREE.Scene())
  const labels = createPeopleLabels(host)
  const pool = host.children.length
  const crowd = Array.from({ length: pool + 3 }, (_, i) => ({ ...asha, id: `p${i}`, name: `P${i}`, x: i }))
  people.apply(welcome([...crowd, { ...ravi, x: 0, z: -40 }]))
  labels.update(camera, people, { x: 0, z: 0 })
  expect(host.children).toHaveLength(pool) // nothing new made per person
  const shown = [...host.children].filter((el) => !(el as HTMLElement).hidden)
  expect(shown).toHaveLength(pool)
  expect(shown.map((el) => el.querySelector('.person-name')!.textContent).sort()).toEqual(
    crowd
      .slice(0, pool)
      .map((p) => p.name)
      .sort(),
  )
  expect(shown[0]!.textContent).toContain('chai pe')
  expect(host.textContent).not.toContain('✦')
  expect(host.textContent).not.toContain('Ravi') // 40 m off: too far for a label
  labels.dispose()
  expect(host.children).toHaveLength(0)
  people.dispose()
})
