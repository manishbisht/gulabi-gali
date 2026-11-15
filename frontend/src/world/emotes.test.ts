// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, expect, it } from 'vitest'
import { createEmotes, EMOTE_S, EMOTES } from './emotes'

afterEach(() => {
  document.body.innerHTML = ''
})

function setup() {
  const host = document.body.appendChild(document.createElement('div'))
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 2, 10)
  camera.lookAt(0, 2, 0)
  camera.updateMatrixWorld()
  /** Where each id stands; anyone missing is not drawn. */
  const where = new Map<string, { x: number; y: number; z: number }>()
  const at = (id: string, out: THREE.Vector3) => {
    const p = where.get(id)
    if (!p) return false
    out.set(p.x, p.y, p.z)
    return true
  }
  const emotes = createEmotes(host)
  const shown = () =>
    [...host.querySelectorAll<HTMLElement>('.emote')].filter((el) => !el.hidden).map((el) => el.textContent)
  return { host, camera, where, at, emotes, shown }
}

it('draws the emote over each person it names, for a little while, then lets go', () => {
  const { camera, where, at, emotes, shown, host } = setup()
  where.set('dev:asha', { x: 0, y: 0, z: 0 })
  where.set('dev:ravi', { x: 2, y: 0, z: 0 })
  emotes.show('dev:asha', 'namaste')
  emotes.show('dev:ravi', 'namaste')
  emotes.update(0, camera, at)
  expect(shown()).toEqual([EMOTES.namaste, EMOTES.namaste])
  // decorative: the toast is what a screen reader hears
  for (const el of host.querySelectorAll('.emote')) expect(el.getAttribute('aria-hidden')).toBe('true')
  const [a, b] = [...host.querySelectorAll<HTMLElement>('.emote')]
  expect(a!.style.transform).toMatch(/^translate\(/)
  expect(a!.style.transform).not.toBe(b!.style.transform)
  emotes.update(EMOTE_S - 0.1, camera, at)
  expect(shown()).toHaveLength(2)
  emotes.update(0.2, camera, at)
  expect(shown()).toEqual([])
})

it('a second emote for the same person takes the same place and starts its time again', () => {
  const { camera, where, at, emotes, shown } = setup()
  where.set('dev:asha', { x: 0, y: 0, z: 0 })
  emotes.show('dev:asha', 'namaste')
  emotes.update(EMOTE_S - 0.5, camera, at)
  emotes.show('dev:asha', 'wave')
  emotes.update(1, camera, at)
  expect(shown()).toEqual([EMOTES.wave])
})

it('someone not drawn (gone, out of range or behind the camera) shows nothing', () => {
  const { camera, where, at, emotes, shown } = setup()
  emotes.show('dev:nobody', 'wave')
  emotes.update(0, camera, at)
  expect(shown()).toEqual([])
  where.set('dev:behind', { x: 0, y: 0, z: 30 })
  emotes.show('dev:behind', 'wave')
  emotes.update(0, camera, at)
  expect(shown()).toEqual([])
})

it('with every place taken, the emote nearest its end gives way', () => {
  const { camera, where, at, emotes, shown } = setup()
  for (let i = 0; i < 12; i++) {
    where.set(`p${i}`, { x: i * 0.1, y: 0, z: 0 })
    emotes.show(`p${i}`, i === 11 ? 'wave' : 'namaste')
    emotes.update(0.01, camera, at)
  }
  expect(shown()).toContain(EMOTES.wave)
  expect(shown().length).toBeLessThan(12)
})

it('clear hides them all; dispose takes them off the page', () => {
  const { camera, where, at, emotes, shown, host } = setup()
  where.set('dev:asha', { x: 0, y: 0, z: 0 })
  emotes.show('dev:asha', 'wave')
  emotes.update(0, camera, at)
  emotes.clear()
  emotes.update(0, camera, at)
  expect(shown()).toEqual([])
  emotes.dispose()
  expect(host.querySelectorAll('.emote')).toHaveLength(0)
})
