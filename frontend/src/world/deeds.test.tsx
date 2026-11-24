// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AnimalInfo } from './animals'
import type { Bench } from './benches'
import { onDeed } from './deeds'
import type { Deed } from './today'
import type { LandmarkDef } from './types'
import { useAnimals } from './useAnimals'
import { useBench } from './useBench'
import { useCityMap } from './useCityMap'
import { useRooftop } from './useRooftop'
import { useStamps } from './useStamps'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/*
 * "Aaj ka Darshan" hears what the player did from the hooks that already know it, once per change: these are
 * the moments each one says so (the metro, the auto and photo mode are in their own tests).
 */

let deeds: Deed[] = []
let off = () => {}
beforeEach(() => {
  deeds = []
  off = onDeed((d) => deeds.push(d))
})
afterEach(() => off())

/** Mounts `use` and hands back what it returned, kept current. */
function mount<T extends object>(use: () => T): T {
  const out = {} as T
  function Probe() {
    Object.assign(out, use())
    return null
  }
  act(() => createRoot(document.createElement('div')).render(<Probe />))
  return out
}

it('up on a rooftop is a roof deed; coming down is not', () => {
  const roof = mount(useRooftop)
  act(() => roof.hooks.near(true))
  act(() => roof.hooks.up(true))
  act(() => roof.hooks.up(false))
  expect(deeds).toEqual([{ kind: 'roof' }])
})

it('a tapri or bench coming into reach is a tapri deed (no sitting needed: a ghost cannot sit)', () => {
  const bench = mount(useBench)
  const tapri = { id: 'walled-city:0', kind: 'tapri', at: { x: 0, z: 0 }, rot: 0 } as unknown as Bench
  act(() => bench.hooks.near(tapri))
  act(() => bench.hooks.near(null))
  expect(deeds).toEqual([{ kind: 'tapri' }])
})

it('a dog or cat coming along, or a cow answering a namaste, is an animal deed', () => {
  const animals = mount(useAnimals)
  const dog = { id: 'walled-city-dog-0', kind: 'dog', name: 'Moti' } as unknown as AnimalInfo
  act(() => animals.hooks.near(dog))
  expect(deeds).toEqual([]) // only near it
  act(() => animals.hooks.following(dog))
  act(() => animals.hooks.following(null))
  act(() => animals.hooks.notice({ kind: 'waiting', name: 'Moti' }))
  act(() => animals.hooks.notice({ kind: 'cow', line: 0 }))
  expect(deeds).toEqual([{ kind: 'animal' }, { kind: 'animal' }])
})

it('a place picked on the map is a map deed', () => {
  const map = mount(() => useCityMap(true))
  act(() => map.pick({ id: 'hawa-mahal', kind: 'landmark', name: { hi: 'Hawa Mahal', en: 'Hawa Mahal' }, at: { x: 0, z: 0 } } as Parameters<typeof map.pick>[0]))
  expect(deeds).toEqual([{ kind: 'map' }])
})

it("reaching a landmark's ring is a darshan deed for that landmark, once per arrival, stamp or no stamp", () => {
  const stamps = mount(() => useStamps('en', null))
  const hawa = { id: 'hawa-mahal', name: { hi: 'Hawa Mahal', en: 'Hawa Mahal' }, at: { x: 0, z: 0 }, radius: 5 }
  const landmarks = [hawa] as unknown as LandmarkDef[]
  act(() => void stamps.track({ x: 50, z: 0 }, landmarks, false))
  act(() => void stamps.track({ x: 1, z: 0 }, landmarks, false))
  act(() => void stamps.track({ x: 2, z: 0 }, landmarks, false)) // still there: no second deed
  act(() => void stamps.track({ x: 50, z: 0 }, landmarks, false))
  expect(deeds).toEqual([{ kind: 'darshan', stamp: 'hawa-mahal' }])
})
