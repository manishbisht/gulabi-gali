import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storage } from '../storage'
import {
  bandarOff,
  createBandar,
  createBandarMemory,
  setBandarOff,
  type BandarEvent,
  type BandarOptions,
} from './bandar'
import type { AvatarLook, DistrictDef, Vec2 } from './types'

const LOOK: AvatarLook = { skin: 2, outfit: 'pink', head: 'safa' }
const landmark = (id: string, x: number, z: number) => ({
  id,
  name: { hi: id, en: id },
  at: { x, z },
  radius: 5,
  footprint: { minX: x - 3, maxX: x + 3, minZ: z - 3, maxZ: z + 3 },
})
const def = (id = 'walled-city') =>
  ({
    id,
    spawn: { x: 0, z: 0 },
    landmarks: [landmark('jantar-mantar', 0, 0), landmark('hawa-mahal', 60, 0)],
    buildings: [
      { x: 14, z: 0, w: 8, d: 8, floors: 2, style: 'shop' },
      { x: 14, z: 14, w: 8, d: 8, floors: 3, style: 'haveli' },
      { x: -14, z: 8, w: 8, d: 8, floors: 2, style: 'shop' },
    ],
  }) as unknown as DistrictDef

const FRAME = 0.5
function setup(over: Partial<BandarOptions> & { id?: string } = {}) {
  const scene = new THREE.Group()
  const pos: Vec2 = { x: 0, z: 0 }
  let clock = 0
  const player = {
    position: () => pos,
    driving: () => false,
    setLook: vi.fn<(l: AvatarLook) => void>(),
  }
  const events: BandarEvent[] = []
  const b = createBandar(def(over.id), scene, () => 0, {
    look: () => LOOK,
    colliders: [],
    now: () => clock,
    reducedMotion: false,
    memory: createBandarMemory(),
    ...over,
  })
  /** Steps `seconds` of the world, collecting what happened. */
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += FRAME) {
      clock += FRAME * 1000
      const e = b.update(FRAME, player)
      if (e) events.push(e)
    }
  }
  const kinds = () => events.map((e) => e.kind)
  /** Runs until the monkey has the headgear. */
  const untilSnatched = () => {
    for (let i = 0; i < 60 && !kinds().includes('snatched'); i++) run(1)
  }
  return { b, scene, pos, player, run, events, kinds, untilSnatched }
}

afterEach(() => storage.clear())

describe('the Galta bandar', () => {
  it('snatches the headgear locally, and only the headgear', () => {
    const s = setup()
    s.untilSnatched()
    expect(s.events.find((e) => e.kind === 'snatched')).toEqual({ kind: 'snatched', gear: 'safa' })
    expect(s.player.setLook).toHaveBeenLastCalledWith({ ...LOOK, head: 'none' })
    expect(storage.get('gg-look')).toBeNull() // nothing persistent is touched
  })

  it('never more than once per 10 minutes', () => {
    const s = setup()
    s.untilSnatched()
    const at = s.b.peek()
    s.pos.x = at.x
    s.pos.z = at.z
    s.run(1)
    expect(s.kinds()).toContain('caught')
    s.run(9 * 60)
    expect(s.kinds().filter((k) => k === 'snatched')).toHaveLength(1)
    s.run(2 * 60)
    expect(s.kinds().filter((k) => k === 'snatched')).toHaveLength(2)
  })

  it('toggle disables', () => {
    storage.set('gg-no-bandar', '1')
    const s = setup()
    s.run(120)
    expect(s.events).toEqual([])
    expect(s.player.setLook).not.toHaveBeenCalled()
    expect(s.scene.children.every((c) => !c.visible)).toBe(true)
  })

  it('the switch round-trips through gg-no-bandar', () => {
    expect(bandarOff()).toBe(false)
    setBandarOff(true)
    expect(storage.get('gg-no-bandar')).toBe('1')
    expect(bandarOff()).toBe(true)
    setBandarOff(false)
    expect(bandarOff()).toBe(false)
  })

  it('only "1" in gg-no-bandar switches it off', () => {
    for (const junk of ['0', 'true', 'off', ' ']) {
      storage.set('gg-no-bandar', junk)
      expect(bandarOff()).toBe(false)
    }
    storage.set('gg-no-bandar', '1')
    expect(bandarOff()).toBe(true)
  })

  it('switched off while it drops, it never snatches', () => {
    const s = setup()
    s.run(FRAME) // the first look strikes: it is on its way down
    expect(s.b.peek().phase).toBe('drop')
    storage.set('gg-no-bandar', '1')
    s.run(2)
    expect(s.kinds()).not.toContain('snatched')
    expect(s.player.setLook).not.toHaveBeenCalledWith({ ...LOOK, head: 'none' })
    expect(s.b.peek().phase).toBe('idle')
    expect(s.scene.children.every((c) => !c.visible)).toBe(true)
  })

  it('a raid switched off while it drops does not burn the 10 minute cooldown', () => {
    const memory = createBandarMemory()
    const s = setup({ memory })
    s.run(FRAME)
    expect(memory.last).not.toBeNull()
    storage.set('gg-no-bandar', '1')
    s.run(2)
    expect(memory.last).toBeNull()
  })

  it('rolls its chance before reading the switch or the look', () => {
    const look = vi.fn(() => LOOK)
    const get = vi.spyOn(storage, 'get')
    const s = setup({ look })
    const b = createBandar(def(), s.scene, () => 0.99, {
      look,
      colliders: [],
      reducedMotion: false,
      memory: createBandarMemory(),
    })
    for (let i = 0; i < 30; i++) b.update(1, s.player)
    expect(get).not.toHaveBeenCalledWith('gg-no-bandar')
    expect(look).not.toHaveBeenCalled()
    get.mockRestore()
  })

  it('toggling off mid-snatch gives the look back', () => {
    const s = setup()
    s.untilSnatched()
    storage.set('gg-no-bandar', '1')
    s.run(2)
    expect(s.kinds()).toContain('ended')
    expect(s.player.setLook).toHaveBeenLastCalledWith(LOOK)
  })

  it('catching within 2 m returns headgear', () => {
    const s = setup()
    s.untilSnatched()
    s.run(3)
    const at = s.b.peek()
    s.pos.x = at.x + 1.5
    s.pos.z = at.z
    s.run(FRAME)
    expect(s.events.at(-1)).toEqual({ kind: 'caught' })
    expect(s.player.setLook).toHaveBeenLastCalledWith(LOOK)
    expect(s.b.peek().phase).toBe('idle')
  })

  it('a monkey out of reach is not caught', () => {
    const s = setup()
    s.untilSnatched()
    s.run(3)
    const at = s.b.peek()
    s.pos.x = at.x + 6
    s.pos.z = at.z
    s.run(FRAME)
    expect(s.kinds()).not.toContain('caught')
  })

  it('after 60 s headgear drops at the nearest landmark', () => {
    const s = setup()
    s.untilSnatched()
    s.run(61)
    const dropped = s.events.find((e) => e.kind === 'dropped')
    expect(dropped).toMatchObject({ kind: 'dropped', gear: 'safa' })
    const lm = (dropped as Extract<BandarEvent, { kind: 'dropped' }>).landmark
    expect(['jantar-mantar', 'hawa-mahal']).toContain(lm.en)
    // still without it until it is picked up
    expect(s.player.setLook).toHaveBeenLastCalledWith({ ...LOOK, head: 'none' })
    const spot = s.b.peek()
    s.pos.x = spot.dropX
    s.pos.z = spot.dropZ
    s.run(FRAME)
    expect(s.events.at(-1)).toEqual({ kind: 'recovered' })
    expect(s.player.setLook).toHaveBeenLastCalledWith(LOOK)
  })

  it('a dropped headgear nobody picks up is given back after a while', () => {
    const s = setup()
    s.untilSnatched()
    s.run(61)
    s.pos.x = 500
    s.run(61)
    expect(s.events.at(-1)).toEqual({ kind: 'recovered' })
    expect(s.player.setLook).toHaveBeenLastCalledWith(LOOK)
  })

  it('only in walled-city', () => {
    const s = setup({ id: 'mi-road' })
    s.run(120)
    expect(s.events).toEqual([])
    expect(s.scene.children).toHaveLength(0)
  })

  it('does not trigger without headgear to take', () => {
    const s = setup({ look: () => ({ ...LOOK, head: 'bun' }) })
    s.run(120)
    expect(s.events).toEqual([])
  })

  it('does not trigger while blocked, driving or far from Jantar Mantar', () => {
    let blocked = true
    const s = setup({ blocked: () => blocked })
    s.run(30)
    expect(s.events).toEqual([])
    blocked = false
    s.pos.x = 300
    s.run(30)
    expect(s.events).toEqual([])
    const d = setup()
    d.player.driving = () => true
    d.run(30)
    expect(d.events).toEqual([])
  })

  it('walks rather than scampers under reduced motion', () => {
    const fast = setup()
    const slow = setup({ reducedMotion: true })
    for (const s of [fast, slow]) {
      s.untilSnatched()
      s.run(5)
    }
    expect(slow.b.peek().speed).toBeLessThan(fast.b.peek().speed)
  })

  it('restores the look on dispose and removes its meshes', () => {
    const s = setup()
    s.untilSnatched()
    s.b.dispose()
    expect(s.player.setLook).toHaveBeenLastCalledWith(LOOK)
    expect(s.scene.children).toHaveLength(0)
  })
})
