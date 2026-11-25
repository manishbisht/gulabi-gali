import type { DistrictId } from '../net/protocol'
import { storage } from '../storage'
import type { Vec2 } from './types'

/*
 * Jaipur ka Swaad: the stalls serve. Each dish is on the counter of a few tapris across the city; walk up,
 * "Chakho", and it joins the tasting list (`gg-tasted`). Local to this page and this device, for a guest and a
 * resident alike: nothing here is sent, synced or mirrored on the server. No money, and no real shop is named.
 */

const KEY = 'gg-tasted'

/** The eight dishes, in the order the list shows them. All vegetarian. */
export const DISHES = [
  'chai',
  'kachori',
  'lassi',
  'kulfi',
  'ghewar',
  'mirchi-vada',
  'dal-baati',
  'golgappe',
] as const
export type DishId = (typeof DISHES)[number]
export const TOTAL_DISHES = DISHES.length

/** What goes over the taster's head for a moment. */
export const DISH_EMOJI: Record<DishId, string> = {
  chai: '☕',
  kachori: '🥟',
  lassi: '🥛',
  kulfi: '🍦',
  ghewar: '🥮',
  'mirchi-vada': '🌶️',
  'dal-baati': '🍲',
  golgappe: '🧆',
}

/** A tapri that serves: where its prop stands in its district's def (the test holds each to a real tapri). */
export interface Stall {
  district: DistrictId
  x: number
  z: number
}

/**
 * Which stalls serve each dish, districts in the city's order. Spread so that the whole list takes most of the
 * city: ghewar and kulfi are the Pink City's alone, dal baati churma is Nahargarh's, golgappe Amer's, lassi is
 * on MI Road or at Galta Ji, mirchi vada where the students are. Chai is everywhere, Galta Ji included (a
 * temple town's stalls pour chai and lassi, nothing else).
 */
export const SWAAD_STALLS: Record<DishId, readonly Stall[]> = {
  chai: [
    { district: 'walled-city', x: -12, z: -12 },
    { district: 'walled-city', x: 46, z: 19 },
    { district: 'mi-road', x: -46, z: 43.4 },
    { district: 'mi-road', x: 46, z: 43.4 },
    { district: 'mi-road', x: 40, z: 60.6 },
    { district: 'university', x: -60, z: 48.6 },
    { district: 'malviya-nagar', x: 28, z: 54.4 },
    { district: 'amer', x: 50, z: -6 },
    { district: 'amer', x: -36, z: 38 },
    { district: 'nahargarh', x: 40, z: -15 },
    { district: 'galta', x: -20, z: 84 },
    { district: 'galta', x: -66, z: -53 },
  ],
  kachori: [
    { district: 'walled-city', x: 12.5, z: 12.5 },
    { district: 'malviya-nagar', x: 70, z: 37.6 },
    { district: 'amer', x: 50, z: 10 },
  ],
  lassi: [
    { district: 'mi-road', x: -60, z: 43.4 },
    { district: 'mi-road', x: 60, z: 43.4 },
    { district: 'mi-road', x: -55, z: 60.6 },
    { district: 'galta', x: 21, z: 30 },
  ],
  kulfi: [
    { district: 'walled-city', x: 56, z: -7.4 },
    { district: 'walled-city', x: -5.6, z: 36 },
  ],
  ghewar: [{ district: 'walled-city', x: 5.8, z: -40 }],
  'mirchi-vada': [
    { district: 'university', x: 26, z: 48.6 },
    { district: 'malviya-nagar', x: -70, z: 37.6 },
  ],
  'dal-baati': [{ district: 'nahargarh', x: -66, z: -22 }],
  golgappe: [{ district: 'amer', x: 50, z: -22 }],
}

/** One stall and what it serves. */
export interface Serving extends Stall {
  dish: DishId
}

/** "Chakho" shows, and E tastes, within this many metres of a serving stall (a step wider than "Baitho"). */
export const SERVE_RANGE = 3.5

/** Every serving stall in `district`. */
export function servingsIn(district: DistrictId): Serving[] {
  return DISHES.flatMap((dish) =>
    SWAAD_STALLS[dish].filter((s) => s.district === district).map((s) => ({ ...s, dish })),
  )
}

/** The districts where `dish` is served, each once, in the data's order. */
export function dishDistricts(dish: DishId): DistrictId[] {
  const out: DistrictId[] = []
  for (const s of SWAAD_STALLS[dish]) if (!out.includes(s.district)) out.push(s.district)
  return out
}

/** The serving stall nearest `pos` within `range`, or null. Called every frame: allocates nothing. */
export function nearestServing(pos: Vec2, servings: readonly Serving[], range = SERVE_RANGE): Serving | null {
  let best: Serving | null = null
  let bestD = range
  for (let i = 0; i < servings.length; i++) {
    const s = servings[i]!
    const d = Math.hypot(s.x - pos.x, s.z - pos.z)
    if (d <= bestD) {
      best = s
      bestD = d
    }
  }
  return best
}

const isDish = (id: unknown): id is DishId => DISHES.includes(id as DishId)

/** The dishes tasted so far, in the order they were first had: each known dish once, nothing else. */
export function tastedDishes(): DishId[] {
  const saved = storage.getJSON<unknown>(KEY, [])
  if (!Array.isArray(saved)) return []
  return saved.filter((id, i): id is DishId => isDish(id) && saved.indexOf(id) === i)
}

export const swaadComplete = (dishes: readonly string[]) => DISHES.every((d) => dishes.includes(d))

type Listener = (dish: DishId, first: boolean) => void
const listeners = new Set<Listener>()

/** Listens for a dish being tasted (`first`: its first time on this device); returns the way to stop. */
export function onTasted(fn: Listener): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/**
 * A dish was just tasted: the one call made at that moment (see `createSwaad`). It joins the list the first
 * time, and every listener hears of it. Returns whether it was the first time. DOM-free, never sent.
 */
export function tasted(dish: DishId): boolean {
  const have = tastedDishes()
  const first = !have.includes(dish)
  if (first) storage.set(KEY, JSON.stringify([...have, dish]))
  for (const fn of [...listeners])
    try {
      fn(dish, first)
    } catch {
      // one broken listener must not break the tasting
    }
  return first
}
