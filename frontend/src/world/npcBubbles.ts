import * as THREE from 'three'
import type { Lang } from '../i18n/strings'
import { t } from '../i18n/strings'
import type { Npcs } from './npcs'
import type { Vec2 } from './types'

/** Status bubbles show only for characters this close to the player, in metres. */
export const BUBBLE_RANGE = 15
/** Bubbles drawn at once; a district has two or three characters. */
const POOL = 4
const ABOVE_HEAD = 2.5

/**
 * Status bubbles as a few pooled DOM nodes inside `host`, moved by projecting the characters in range.
 * Text is rewritten only when it changes, and React is never involved, so a frame costs a few transforms.
 */
export function createBubbles(host: HTMLElement) {
  const v = new THREE.Vector3()
  const pool = Array.from({ length: POOL }, () => {
    const el = document.createElement('div')
    el.className = 'npc-bubble'
    el.hidden = true
    const badge = document.createElement('span')
    badge.className = 'npc-badge'
    badge.textContent = '✦'
    const text = document.createElement('span')
    el.append(badge, text)
    host.append(el)
    return { el, badge, text, key: '' }
  })

  return {
    update(camera: THREE.Camera, npcs: Npcs, from: Vec2, lang: Lang) {
      const w = window.innerWidth
      const h = window.innerHeight
      let used = 0
      for (const { def, body } of npcs.entries) {
        if (used === POOL) break
        if (Math.hypot(body.position.x - from.x, body.position.z - from.z) > BUBBLE_RANGE) continue
        v.set(body.position.x, ABOVE_HEAD, body.position.z).project(camera)
        if (v.z > 1) continue // behind the camera
        const slot = pool[used++]!
        const key = `${def.id}|${lang}`
        if (slot.key !== key) {
          slot.key = key
          slot.text.textContent = def.status[lang]
          slot.badge.title = t('npcBadge', lang)
        }
        slot.el.hidden = false
        slot.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`
      }
      for (let i = used; i < POOL; i++) pool[i]!.el.hidden = true
    },
    dispose() {
      for (const { el } of pool) el.remove()
    },
  }
}
