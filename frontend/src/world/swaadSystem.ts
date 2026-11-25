import * as THREE from 'three'
import type { DistrictId } from '../net/protocol'
import { DISH_EMOJI, nearestServing, servingsIn, tasted, type Serving } from './swaad'
import type { Vec2 } from './types'

/** How long the dish stays over the taster's head, in seconds of play. */
export const TASTE_S = 3
/** Over the head, where a greeting's emote goes (see emotes.ts). */
const ABOVE_HEAD = 3.3

/** What the stalls tell React; `near` is called only when its news changes. */
export interface SwaadHooks {
  /** The serving stall in reach, or null. */
  near(serving: Serving | null): void
  /** The player just tasted there; `first` when the dish is new to their list. */
  tasted(serving: Serving, first: boolean): void
  /** Whether the dish card is up: then E closes it, and tastes nothing. */
  isOpen(): boolean
  /** Puts the dish card away (E, or another card opening over it). */
  close(): void
}

export interface Swaad {
  update(dt: number, pos: Vec2): void
  /** Whether a serving stall is in reach. */
  near(): boolean
  /** Tastes at the stall in reach: true when there was one. */
  taste(): boolean
  dispose(): void
}

/**
 * A district's serving stalls: which one is in reach, and the dish over the player's own head for a moment
 * after "Chakho" (one DOM node in `host`, moved by projection like the greeting emotes; its pop is CSS, which
 * `prefers-reduced-motion` turns off). Nothing is drawn in the scene and nothing is sent: only this page sees
 * it. A frame costs a scan of the district's handful of stalls and, for three seconds after a taste, one
 * transform.
 */
export function createSwaad(opts: {
  district: DistrictId
  host: HTMLElement
  camera: THREE.Camera
  /** How high the player's feet are (0 on the street). */
  elevation(): number
  /** While true no stall is in reach: seated, at a wheel, in the taxi, up on the roof. */
  blocked?(): boolean
  hooks?: SwaadHooks
}): Swaad {
  const { host, camera, hooks } = opts
  const servings = servingsIn(opts.district)
  const v = new THREE.Vector3()
  const el = document.createElement('div')
  el.className = 'emote swaad-emote'
  el.hidden = true
  el.setAttribute('aria-hidden', 'true')
  host.append(el)
  let near: Serving | null = null
  let left = 0

  return {
    update(dt, pos) {
      const found = opts.blocked?.() ? null : nearestServing(pos, servings)
      if (found !== near) {
        near = found
        hooks?.near(found)
      }
      if (left <= 0) return
      left -= dt
      if (left <= 0 || v.set(pos.x, opts.elevation() + ABOVE_HEAD, pos.z).project(camera).z > 1) {
        el.hidden = true
        return
      }
      el.hidden = false
      el.style.transform = `translate(${((v.x + 1) / 2) * window.innerWidth}px, ${((1 - v.y) / 2) * window.innerHeight}px) translate(-50%, -100%)`
    },
    near: () => near !== null,
    taste() {
      if (!near) return false
      const first = tasted(near.dish)
      left = TASTE_S
      el.textContent = DISH_EMOJI[near.dish]
      // the pop runs again from the start: off, a reflow, on
      el.classList.remove('swaad-pop')
      void el.offsetWidth
      el.classList.add('swaad-pop')
      hooks?.tasted(near, first)
      return true
    },
    dispose() {
      el.remove()
      if (near) hooks?.near(null)
      near = null
    },
  }
}
