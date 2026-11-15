import * as THREE from 'three'
import { expect, it, vi } from 'vitest'
import type { DistrictDef } from './types'

const good = vi.hoisted(() => ({ geometry: undefined as unknown, material: undefined as unknown }))

vi.mock('./districts/university', async () => {
  const three = await import('three')
  good.geometry = new three.BoxGeometry(1, 1, 1)
  good.material = new three.MeshBasicMaterial()
  const def = {
    id: 'university',
    name: { hi: 'x', en: 'x' },
    size: 100,
    spawn: { x: 0, z: 0 },
    station: { x: 0, z: 0 },
    centre: { x: 0, z: 0 },
    processionRoute: [],
    animals: { dogs: [], cats: [], cow: { x: 0, z: 0 } },
    ground: 'road',
    paving: [],
    buildings: [{ style: 'shop', x: 10, z: 10, w: 4, d: 4, h: 4 }],
    npcs: [],
    props: [],
    landmarks: [
      {
        id: 'ok',
        build: async () =>
          new three.Group().add(
            new three.Mesh(good.geometry as THREE.BufferGeometry, good.material as THREE.Material),
          ),
        footprint: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
      },
      {
        id: 'bad',
        build: async () => {
          throw new Error('landmark failed')
        },
        footprint: { minX: 2, maxX: 3, minZ: 2, maxZ: 3 },
      },
    ],
  } as unknown as DistrictDef
  return { default: def }
})

import { loadDistrict } from './district'

it('a landmark that fails to build frees what was already built', async () => {
  const geometries = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
  const materials = vi.spyOn(THREE.Material.prototype, 'dispose')
  await expect(loadDistrict('university')).rejects.toThrow('landmark failed')
  // ground, the block of buildings and the landmark that did build
  expect(geometries.mock.contexts).toContain(good.geometry)
  expect(materials.mock.contexts).toContain(good.material)
  expect(geometries.mock.calls.length).toBeGreaterThanOrEqual(3)
})
