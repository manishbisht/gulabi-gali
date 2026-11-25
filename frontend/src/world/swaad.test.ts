// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DistrictId } from '../net/protocol'
import { storage } from '../storage'
import { BENCH_RANGE } from './benches'
import { DISTRICTS, loadDef } from './district'
import {
  DISHES,
  DISH_EMOJI,
  SERVE_RANGE,
  SWAAD_STALLS,
  dishDistricts,
  nearestServing,
  onTasted,
  servingsIn,
  swaadComplete,
  tasted,
  tastedDishes,
  type DishId,
} from './swaad'
import { createSwaad, TASTE_S } from './swaadSystem'
import { DISH_TEXT } from './swaadText'

beforeEach(() => storage.clear())
afterEach(() => {
  document.body.innerHTML = ''
})

describe('the stalls', () => {
  it('there are eight dishes, each served somewhere', () => {
    expect(DISHES).toHaveLength(8)
    for (const dish of DISHES) expect(SWAAD_STALLS[dish].length).toBeGreaterThan(0)
  })

  it('every serving stall is a tapri of its district, and no tapri serves two dishes', async () => {
    const seen = new Set<string>()
    for (const id of DISTRICTS) {
      const def = await loadDef(id)
      const tapris = def.props.filter((p) => p.kind === 'tapri')
      for (const s of servingsIn(id)) {
        expect(
          tapris.some((p) => p.at.x === s.x && p.at.z === s.z),
          `${s.dish} at ${id} (${s.x}, ${s.z})`,
        ).toBe(true)
        const key = `${id}:${s.x}:${s.z}`
        expect(seen.has(key), key).toBe(false)
        seen.add(key)
      }
    }
    // and nothing is listed for a district the city does not have
    const listed = DISHES.flatMap((d) => SWAAD_STALLS[d]).length
    expect(seen.size).toBe(listed)
  })

  it('every district serves something; Galta Ji, a temple town, only chai and lassi', () => {
    for (const id of DISTRICTS) expect(servingsIn(id).length, id).toBeGreaterThan(0)
    expect(new Set(servingsIn('galta').map((s) => s.dish))).toEqual(new Set(['chai', 'lassi']))
  })

  it('the whole list takes most of the city: no four districts serve all eight', () => {
    let fewest = DISTRICTS.length
    for (let mask = 1; mask < 1 << DISTRICTS.length; mask++) {
      const picked = DISTRICTS.filter((_, i) => mask & (1 << i))
      const all = DISHES.every((d) => dishDistricts(d).some((id) => picked.includes(id)))
      if (all) fewest = Math.min(fewest, picked.length)
    }
    expect(fewest).toBeGreaterThanOrEqual(5)
  })

  it('the stall in reach is the nearest one, a step wider than "Baitho"', () => {
    const stalls = servingsIn('walled-city')
    const ghewar = stalls.find((s) => s.dish === 'ghewar')!
    expect(SERVE_RANGE).toBeGreaterThan(BENCH_RANGE)
    expect(nearestServing({ x: ghewar.x - 3, z: ghewar.z }, stalls)).toBe(ghewar)
    expect(nearestServing({ x: ghewar.x - 4, z: ghewar.z }, stalls)).toBeNull()
  })
})

describe('the words', () => {
  it('every dish has a name, a vendor line and a two-line note in both languages, and an emoji', () => {
    for (const dish of DISHES) {
      expect(DISH_EMOJI[dish]).toBeTruthy()
      for (const part of Object.values(DISH_TEXT[dish]))
        for (const lang of ['hi', 'en'] as const) expect(part[lang].length, dish).toBeGreaterThan(3)
    }
  })

  it('no prices: not a digit or a currency sign anywhere', () => {
    for (const dish of DISHES)
      for (const part of Object.values(DISH_TEXT[dish]))
        for (const lang of ['hi', 'en'] as const)
          expect(part[lang]).not.toMatch(/[0-9₹$]|\brs\b|rupay|rupee/i)
  })
})

describe('the list (gg-tasted)', () => {
  it('a dish joins once, in the order tasted, and listeners hear every taste', () => {
    const heard: [DishId, boolean][] = []
    const off = onTasted((dish, first) => heard.push([dish, first]))
    expect(tasted('lassi')).toBe(true)
    expect(tasted('chai')).toBe(true)
    expect(tasted('lassi')).toBe(false)
    expect(tastedDishes()).toEqual(['lassi', 'chai'])
    expect(JSON.parse(localStorage.getItem('gg-tasted')!)).toEqual(['lassi', 'chai'])
    expect(heard).toEqual([
      ['lassi', true],
      ['chai', true],
      ['lassi', false],
    ])
    off()
    tasted('kulfi')
    expect(heard).toHaveLength(3)
  })

  it('a listener that throws does not stop the tasting', () => {
    const off = onTasted(() => {
      throw new Error('broken')
    })
    expect(tasted('kulfi')).toBe(true)
    expect(tastedDishes()).toEqual(['kulfi'])
    off()
  })

  it('reads only known dishes, each once, whatever was saved', () => {
    storage.set('gg-tasted', '["chai","biryani","chai",7,"ghewar"]')
    expect(tastedDishes()).toEqual(['chai', 'ghewar'])
    storage.set('gg-tasted', '{"chai":true}')
    expect(tastedDishes()).toEqual([])
    storage.set('gg-tasted', 'not json')
    expect(tastedDishes()).toEqual([])
  })

  it('is complete with all eight', () => {
    expect(swaadComplete(DISHES.slice(1))).toBe(false)
    expect(swaadComplete([...DISHES])).toBe(true)
  })
})

describe('the stalls on the street (createSwaad)', () => {
  function street(district: DistrictId = 'walled-city', blocked = () => false) {
    const host = document.body.appendChild(document.createElement('div'))
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(0, 3, 60)
    camera.updateMatrixWorld()
    const hooks = { near: vi.fn(), tasted: vi.fn() }
    const swaad = createSwaad({ district, host, camera, elevation: () => 0, blocked, hooks })
    return { host, hooks, swaad, emote: () => host.querySelector<HTMLElement>('.swaad-emote')! }
  }
  const ghewar = SWAAD_STALLS.ghewar[0]!
  const at = { x: ghewar.x - 2, z: ghewar.z }

  it('says which stall is in reach only when that changes', () => {
    const { hooks, swaad } = street()
    swaad.update(0.03, { x: 0, z: 0 })
    expect(hooks.near).not.toHaveBeenCalled()
    expect(swaad.near()).toBe(false)
    swaad.update(0.03, at)
    swaad.update(0.03, at)
    expect(hooks.near).toHaveBeenCalledTimes(1)
    expect(hooks.near.mock.calls[0]![0]).toMatchObject({ dish: 'ghewar' })
    swaad.update(0.03, { x: 0, z: 0 })
    expect(hooks.near).toHaveBeenLastCalledWith(null)
  })

  it('a taste puts the dish over the head for three seconds, joins the list, and tells the page', () => {
    const { hooks, swaad, emote } = street()
    expect(swaad.taste()).toBe(false) // nothing in reach
    swaad.update(0.03, at)
    expect(swaad.taste()).toBe(true)
    expect(tastedDishes()).toEqual(['ghewar'])
    expect(hooks.tasted).toHaveBeenLastCalledWith(expect.objectContaining({ dish: 'ghewar' }), true)
    swaad.update(0.03, at)
    expect(emote().hidden).toBe(false)
    expect(emote().textContent).toBe(DISH_EMOJI.ghewar)
    expect(emote().getAttribute('aria-hidden')).toBe('true')
    swaad.update(TASTE_S, at)
    expect(emote().hidden).toBe(true)
    // again: the same dish, not new to the list
    swaad.taste()
    expect(hooks.tasted).toHaveBeenLastCalledWith(expect.objectContaining({ dish: 'ghewar' }), false)
    expect(tastedDishes()).toEqual(['ghewar'])
  })

  it('serves nobody who is seated, at a wheel or up on the roof', () => {
    let blocked = false
    const { hooks, swaad } = street('walled-city', () => blocked)
    swaad.update(0.03, at)
    expect(swaad.near()).toBe(true)
    blocked = true
    swaad.update(0.03, at)
    expect(hooks.near).toHaveBeenLastCalledWith(null)
    expect(swaad.taste()).toBe(false)
  })

  it('leaving the district takes the emote away and says nothing is in reach', () => {
    const { host, hooks, swaad } = street()
    swaad.update(0.03, at)
    swaad.dispose()
    expect(host.children).toHaveLength(0)
    expect(hooks.near).toHaveBeenLastCalledWith(null)
  })
})
