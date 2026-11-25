import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { DISTRICTS, loadDistrict } from './district'
import { CAST } from './cast'
import { createNpcs, stepAlongRoute } from './npcs'
import type { NpcDef } from './types'

const route = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
]

describe('stepAlongRoute', () => {
  it('walks toward the next waypoint and loops', () => {
    const a = stepAlongRoute({ x: 0, z: 0 }, route, 0, 2, 1)
    expect(a.pos).toEqual({ x: 2, z: 0 })
    const b = stepAlongRoute({ x: 9.5, z: 0 }, route, 0, 2, 1)
    expect(b.pos).toEqual({ x: 10, z: 0 })
    expect(b.legIndex).toBe(1) // reached (10,0), now heading back to (0,0)
    const c = stepAlongRoute({ x: 0.5, z: 0 }, route, 1, 2, 1)
    expect(c.pos).toEqual({ x: 0, z: 0 })
    expect(c.legIndex).toBe(0) // the loop-back leg closes
  })
})

describe('the cast', () => {
  it('has sixteen characters with bilingual role and status', () => {
    const all = Object.values(CAST)
    expect(all).toHaveLength(16)
    for (const c of all) {
      for (const text of [c.role, c.status]) {
        expect(text.hi.trim()).not.toBe('')
        expect(text.en.trim()).not.toBe('')
      }
    }
    expect(CAST.raju.status.hi).toBe('Kahan chalna hai, Hukum?')
  })
})

describe('district NPCs', () => {
  it.each(DISTRICTS)('%s: every NPC route stays out of colliders', async (id) => {
    const d = await loadDistrict(id)
    for (const npc of d.def.npcs) {
      expect(npc.route.length, npc.id).toBeGreaterThanOrEqual(2)
      npc.route.forEach((from, i) => {
        const to = npc.route[(i + 1) % npc.route.length]!
        const len = Math.hypot(to.x - from.x, to.z - from.z)
        const n = Math.max(1, Math.ceil(len / 0.5))
        for (let k = 0; k <= n; k++) {
          const p = { x: from.x + ((to.x - from.x) * k) / n, z: from.z + ((to.z - from.z) * k) / n }
          const hit = d.colliders.find(
            (c) => p.x > c.minX - 0.4 && p.x < c.maxX + 0.4 && p.z > c.minZ - 0.4 && p.z < c.maxZ + 0.4,
          )
          expect(hit, `${npc.id} leg ${i} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBeUndefined()
        }
      })
    }
    d.dispose()
  })

  it('walled-city has Imran, Raju and Ramesh ji', async () => {
    const d = await loadDistrict('walled-city')
    expect(d.def.npcs.map((n) => n.id).sort()).toEqual(['imran', 'raju', 'ramesh'])
    d.dispose()
  })
})

describe('createNpcs', () => {
  const def: NpcDef = { ...CAST.raju, route, speed: 2 }

  it('puts a body in the scene at the start of the route, walks it and cleans up', () => {
    const scene = new THREE.Group()
    const npcs = createNpcs([def], scene)
    expect(scene.children).toHaveLength(1)
    const body = npcs.entries[0]!.body
    expect(body.position.x).toBe(0)
    for (let i = 0; i < 60; i++) npcs.update(0.1) // 6 s
    expect(body.position.x).toBeGreaterThan(1)
    npcs.dispose()
    expect(scene.children).toHaveLength(0)
  })

  it('pauses 2-5 s at a waypoint', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // the shortest rest, 2 s
    const scene = new THREE.Group()
    const npcs = createNpcs([{ ...def, route: [route[0]!, { x: 1, z: 0 }], speed: 10 }], scene)
    npcs.update(0.2) // arrives at (1, 0)
    const x = npcs.entries[0]!.body.position.x
    npcs.update(1.9)
    expect(npcs.entries[0]!.body.position.x).toBe(x) // still resting
    for (let i = 0; i < 5; i++) npcs.update(0.1) // the rest is over: it has walked back to the start
    expect(npcs.entries[0]!.body.position.x).not.toBe(x)
    npcs.dispose()
    vi.restoreAllMocks()
  })

  it('picks an NPC by ray, and finds the nearest within a range', () => {
    const scene = new THREE.Group()
    const npcs = createNpcs([def], scene)
    npcs.update(0)
    const hit = new THREE.Raycaster(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 0, -1))
    expect(npcs.pick(hit)?.id).toBe('raju')
    const miss = new THREE.Raycaster(new THREE.Vector3(5, 1, 5), new THREE.Vector3(0, 0, -1))
    expect(npcs.pick(miss)).toBeNull()
    expect(npcs.nearest({ x: 1, z: 2 }, 3)?.id).toBe('raju')
    expect(npcs.nearest({ x: 1, z: 4 }, 3)).toBeNull()
    npcs.dispose()
  })
})

describe('freezing', () => {
  it('freeze(true) pauses every walker and freeze(false) lets them go on', () => {
    const scene = new THREE.Scene()
    const def = {
      id: 'ramesh',
      look: { skin: 0, outfit: 'pink', head: 'none' },
      route,
      speed: 1,
    } as unknown as NpcDef
    const npcs = createNpcs([def], scene)
    npcs.freeze(true)
    npcs.update(1)
    expect(npcs.entries[0]!.body.position.x).toBe(0)
    npcs.freeze(false)
    npcs.update(1)
    expect(npcs.entries[0]!.body.position.x).toBeGreaterThan(0)
    npcs.dispose()
  })
})
