import * as THREE from 'three'
import type { AnimalKind } from './animals'
import type { Vec2 } from './types'

type Pet = Exclude<AnimalKind, 'cow'>

/** How long the emote stays over a petted animal, in seconds of play (the `.emote-pop` animation's length). */
export const PET_EMOTE_S = 2.6
/** A dog's wagging-tail happiness, a cat's purr. */
export const PET_EMOTES: Record<Pet, string> = { dog: '❤️', cat: '😻' }
/** Over the animal's back. */
const ABOVE: Record<Pet, number> = { dog: 1.1, cat: 0.8 }

/**
 * The small emote over a dog or cat that was just petted: one DOM node inside `host`, moved by projection
 * like the greeting emotes over people (emotes.ts), and styled as they are (its pop is off under
 * `prefers-reduced-motion`). One at a time: a pat is a second and a half. Decorative, and local to this page.
 * A frame with nothing showing costs one comparison; one showing costs a projection and allocates no objects.
 */
export function createPetEmote(host: HTMLElement, where: (id: string, out: Vec2) => boolean) {
  const el = document.createElement('div')
  el.className = 'emote pet-emote'
  el.hidden = true
  el.setAttribute('aria-hidden', 'true')
  host.append(el)
  const v = new THREE.Vector3()
  const at: Vec2 = { x: 0, z: 0 }
  let id: string | null = null
  let up = 0
  let left = 0

  return {
    show(animal: string, kind: Pet) {
      id = animal
      up = ABOVE[kind]
      left = PET_EMOTE_S
      el.textContent = PET_EMOTES[kind]
      // the pop runs again from the start: off, a reflow, on
      el.classList.remove('emote-pop')
      void el.offsetWidth
      el.classList.add('emote-pop')
    },
    /** The animal it is over, or null. */
    showing: () => id,
    update(dt: number, camera: THREE.Camera) {
      if (id === null) return
      left -= dt
      if (left <= 0) {
        id = null
        el.hidden = true
        return
      }
      if (!where(id, at) || v.set(at.x, up, at.z).project(camera).z > 1) {
        el.hidden = true
        return
      }
      el.hidden = false
      el.style.transform = `translate(${((v.x + 1) / 2) * window.innerWidth}px, ${((1 - v.y) / 2) * window.innerHeight}px) translate(-50%, -100%)`
    },
    dispose() {
      el.remove()
    },
  }
}
