import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { Stage } from '../engine/stage'
import { createPatang } from './patang'
import { createPatangView } from './patangView'

describe('createPatangView', () => {
  const stage = () =>
    ({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 0.5, 0.1, 500) }) as unknown as Stage

  it('looks up from where the player stands: on the street, or up on a roof by its height', () => {
    const s = stage()
    const sim = createPatang(3, 2)
    const view = createPatangView(s, sim.state.rivals.length)
    const at = { x: 10, z: -4 }
    view.update(sim.state, at)
    const street = s.camera.position.clone()
    expect(street.y).toBeGreaterThan(1.5)
    expect(street.y).toBeLessThan(4)
    view.update(sim.state, at, 9.6)
    expect(s.camera.position.y).toBeCloseTo(street.y + 9.6)
    expect(s.camera.position.x).toBeCloseTo(street.x)
    expect(s.camera.position.z).toBeCloseTo(street.z)
    // and the sky the kites fly in still hangs in front of the camera, looking up
    const sky = s.scene.getObjectByName('patang')!
    expect(sky.position.y).toBeGreaterThan(s.camera.position.y)
    view.dispose()
    sim.dispose()
  })
})
