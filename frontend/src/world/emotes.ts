import * as THREE from 'three'
import type { Reaction } from '../net/protocol'

/** How long an emote stays over a head, in seconds of play. */
export const EMOTE_S = 2.6
export const EMOTES: Record<Reaction, string> = { namaste: '🙏', wave: '👋' }
/** Emotes drawn at once: a greeting takes two (one over each person). */
const POOL = 8
/** Over the name label, which sits at 2.5 m. */
const ABOVE_HEAD = 3.3

/**
 * Where someone's head is now: fills `out` and answers true, or false when they are not drawn (gone, too far,
 * hidden). Called every frame for each emote showing, so it must not allocate.
 */
export type EmoteAt = (id: string, out: THREE.Vector3) => boolean

/**
 * Reaction emotes (a namaste, a wave) over people's heads, as a few pooled DOM nodes inside `host`, moved by
 * projection like the name labels. Showing one restarts its CSS pop (which `prefers-reduced-motion` turns
 * off); a frame costs a few transforms and allocates nothing. Decorative: the greeted person's toast is what
 * a screen reader hears.
 */
export function createEmotes(host: HTMLElement) {
  const v = new THREE.Vector3()
  const pool = Array.from({ length: POOL }, () => {
    const el = document.createElement('div')
    el.className = 'emote'
    el.hidden = true
    el.setAttribute('aria-hidden', 'true')
    host.append(el)
    return { el, id: null as string | null, left: 0 }
  })

  return {
    /** Puts `kind` over `id`'s head, in the place it already has if one is showing there. */
    show(id: string, kind: Reaction) {
      let slot = pool.find((s) => s.id === id) ?? pool.find((s) => s.id === null)
      if (!slot) slot = pool.reduce((a, b) => (b.left < a.left ? b : a))
      slot.id = id
      slot.left = EMOTE_S
      slot.el.textContent = EMOTES[kind]
      // the pop runs again from the start: off, a reflow, on
      slot.el.classList.remove('emote-pop')
      void slot.el.offsetWidth
      slot.el.classList.add('emote-pop')
    },
    update(dt: number, camera: THREE.Camera, at: EmoteAt) {
      const w = window.innerWidth
      const h = window.innerHeight
      for (let i = 0; i < POOL; i++) {
        const slot = pool[i]!
        if (slot.id === null) continue
        slot.left -= dt
        if (slot.left <= 0) {
          slot.id = null
          slot.el.hidden = true
          continue
        }
        if (!at(slot.id, v) || v.setY(v.y + ABOVE_HEAD).project(camera).z > 1) {
          slot.el.hidden = true
          continue
        }
        slot.el.hidden = false
        slot.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`
      }
    },
    /** Takes every emote down (the street emptied). */
    clear() {
      for (const slot of pool) {
        slot.id = null
        slot.el.hidden = true
      }
    },
    dispose() {
      for (const { el } of pool) el.remove()
    },
  }
}
