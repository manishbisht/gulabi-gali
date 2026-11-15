import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DISTRICTS, loadDistrict } from '../world/district'
import { clearAt } from '../world/animals'
import type { Vec2 } from '../world/types'
import { t } from '../i18n/strings'
import {
  createProcession,
  dressOnly,
  processionCount,
  processionLine,
  processionPath,
  womanGeometry,
} from './procession'

const TIERS = [0, 1, 2] as const

/** The rows of women stand 0.8 m off the middle and the palanquin with its bearers is about 1.3 m wide each side; the palanquin is 2.7 m long. */
const BODY = 1.6

describe('processionCount', () => {
  it('is 40, 20 and 8 members for a Gangaur or Teej procession, and none for other festivals', () => {
    expect([2, 1, 0].map((q) => processionCount('gangaur', q as 0 | 1 | 2))).toEqual([40, 20, 8])
    expect([2, 1, 0].map((q) => processionCount('teej', q as 0 | 1 | 2))).toEqual([40, 20, 8])
    for (const id of ['sankranti', 'holi', 'diwali', 'jlf'] as const) expect(processionCount(id, 2)).toBe(0)
  })
})

describe('createProcession', () => {
  it.each(['gangaur', 'teej'] as const)('%s: counts by tier, in at most 3 draw calls', async (kind) => {
    const walled = await loadDistrict('walled-city')
    const other = await loadDistrict('mi-road')
    for (const tier of TIERS) {
      const p = createProcession(walled, kind, tier)
      expect(p.count).toBe(processionCount(kind, tier))
      const meshes = p.group.children.filter(
        (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
      )
      expect(meshes.length).toBe(p.group.children.length)
      expect(meshes.length).toBeLessThanOrEqual(3)
      const figures = meshes.reduce((n, m) => n + m.count, 0)
      expect(figures).toBe(p.count + 1) // the members, and the palanquin or swing cart
      p.dispose()
      // a smaller one along the main street of the other districts
      const small = createProcession(other, kind, tier)
      expect(small.count).toBeLessThan(p.count)
      expect(small.count).toBeGreaterThanOrEqual(4)
      small.dispose()
    }
    walled.dispose()
    other.dispose()
  })

  it('walks at about a metre a second and loops', async () => {
    const d = await loadDistrict('walled-city')
    const p = createProcession(d, 'gangaur', 2)
    const mesh = p.group.children[0] as THREE.InstancedMesh
    const at = (): Vec2 => {
      const m = new THREE.Matrix4()
      mesh.getMatrixAt(0, m)
      const v = new THREE.Vector3().setFromMatrixPosition(m)
      return { x: v.x, z: v.z }
    }
    p.update(0)
    const a = at()
    let walked = 0
    let last = a
    for (let i = 0; i < 30; i++) {
      p.update(1 / 30)
      const b = at()
      walked += Math.hypot(b.x - last.x, b.z - last.z)
      last = b
    }
    expect(walked).toBeGreaterThan(0.8)
    expect(walked).toBeLessThan(1.4)
    p.dispose()
    d.dispose()
  })

  it('takes itself out of the scene and frees its geometry', async () => {
    const d = await loadDistrict('walled-city')
    const scene = new THREE.Group()
    const p = createProcession(d, 'teej', 1)
    scene.add(p.group)
    const geometries = p.group.children.map((c) => (c as THREE.InstancedMesh).geometry)
    let freed = 0
    for (const g of geometries) g.addEventListener('dispose', () => freed++)
    p.dispose()
    expect(scene.children).toHaveLength(0)
    expect(freed).toBe(geometries.length)
    d.dispose()
  })
})

describe('processionRoute', () => {
  it.each(DISTRICTS)('%s: every leg, sampled every 0.5 m, is clear of colliders', async (id) => {
    const d = await loadDistrict(id)
    const half = d.def.size / 2
    expect(d.def.processionRoute.length).toBeGreaterThanOrEqual(4)
    // both as authored and as the line walks it, with its corners cut
    for (const route of [d.def.processionRoute, processionPath(d.def.processionRoute)]) {
      for (let i = 0; i < route.length; i++) {
        const a = route[i]!
        const b = route[(i + 1) % route.length]! // a loop: the last leg returns to the first point
        const len = Math.hypot(b.x - a.x, b.z - a.z)
        for (let s = 0; s <= len; s += 0.5) {
          const x = a.x + ((b.x - a.x) * s) / len
          const z = a.z + ((b.z - a.z) * s) / len
          expect(Math.abs(x) < half && Math.abs(z) < half, `${id} ${x},${z} inside`).toBe(true)
          expect(clearAt(d.colliders, x, z, BODY), `${id} blocked at ${x},${z}`).toBe(true)
        }
      }
    }
    d.dispose()
  })

  it('in the Walled City runs along Tripolia Bazaar to Badi Chaupar and round it', async () => {
    const d = await loadDistrict('walled-city')
    const xs = d.def.processionRoute.map((p) => p.x)
    expect(Math.min(...xs)).toBeLessThan(-60) // out along the bazaar
    expect(Math.max(...xs)).toBeLessThan(15) // and no further than the Chaupar
    const zs = d.def.processionRoute.map((p) => p.z)
    expect(Math.min(...zs)).toBeLessThan(-5) // it goes right round the Chaupar
    expect(Math.max(...zs)).toBeGreaterThan(5)
    d.dispose()
  })
})

describe('the HUD line', () => {
  it('names Tripolia only in the Walled City', () => {
    expect(t(processionLine('gangaur', 'walled-city')!, 'en')).toBe(
      'The Gangaur procession is leaving Tripolia',
    )
    for (const d of ['mi-road', 'university', 'malviya-nagar'] as const) {
      const key = processionLine('gangaur', d)!
      expect(t(key, 'en')).toBe('The Gangaur procession is on the road')
      expect(t(key, 'hi')).toBe('Gangaur ki sawari sadak par nikli hai')
    }
    expect(processionLine('teej', 'mi-road')).toBe('festivalTeejLine')
    expect(processionLine('holi', 'walled-city')).toBeUndefined()
    expect(processionLine(null, 'walled-city')).toBeUndefined()
  })
})

describe('the dress colour', () => {
  it('patches the instance colour so that only pure-white vertices take it', () => {
    const shader = { vertexShader: 'void main() {\n#include <color_vertex>\n}' }
    dressOnly(shader)
    expect(shader.vertexShader).not.toContain('#include <color_vertex>')
    expect(shader.vertexShader).not.toContain('vColor.rgb *= instanceColor.rgb;')
    expect(shader.vertexShader).toContain('USE_INSTANCING_COLOR')
    expect(shader.vertexShader).toContain(
      'float dress = step(0.999, min(vColor.r, min(vColor.g, vColor.b))); vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, dress);',
    )
  })

  it("keeps the woman's skin and kalash off white, and has white dress to tint", () => {
    const g = womanGeometry()
    const c = g.getAttribute('color')
    const pos = g.getAttribute('position')
    let white = 0
    let faces = 0
    let kalash = 0
    for (let i = 0; i < c.count; i++) {
      const isWhite = Math.min(c.getX(i), c.getY(i), c.getZ(i)) >= 0.999
      if (isWhite) white++
      const y = pos.getY(i)
      // the head sits at 1.33 m (radius 0.11), the kalash at 1.5 to 1.82 m: none of it may be white
      if (y > 1.22 && y < 1.44 && Math.abs(pos.getX(i)) < 0.12 && !isWhite) faces++
      if (y > 1.5 && !isWhite) kalash++
      if (y > 1.5) expect(isWhite).toBe(false)
    }
    expect(white).toBeGreaterThan(0)
    expect(faces).toBeGreaterThan(0)
    expect(kalash).toBeGreaterThan(0)
    g.dispose()
  })
})
