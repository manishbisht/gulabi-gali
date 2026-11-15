import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { POSTER_WALLS, type DistrictId, type PosterView, type ServerMsg } from '../net/protocol'
import walledCity from './districts/walledCity'
import miRoad from './districts/miRoad'
import university from './districts/university'
import malviyaNagar from './districts/malviyaNagar'
import {
  createPosters,
  HIDDEN_PAPER,
  nearestWall,
  NUDGE_RETRY_MS,
  slotAt,
  wallDistance,
  wallsOf,
  wrap,
  type Sheet,
} from './posters'
import type { DistrictDef } from './types'

const DEFS: Record<DistrictId, DistrictDef> = {
  'walled-city': walledCity,
  'mi-road': miRoad,
  university,
  'malviya-nagar': malviyaNagar,
}

/** A canvas stand-in that counts what is drawn on it. */
function fakeSheet() {
  const ctx = {
    fillStyle: '',
    font: '',
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: (s: string) => ({ width: [...s].length * 8 }) as TextMetrics,
  }
  return { canvas: { width: 640, height: 320 } as unknown as HTMLCanvasElement, ctx } satisfies Sheet
}

const poster = (over: Partial<PosterView> = {}): PosterView => ({
  id: 'p1',
  wall: 0,
  slot: 0,
  text: 'Gully cricket, Sunday 7am',
  when: null,
  name: 'Asha',
  ...over,
})

/** A district of two walls: one facing +z at the origin, one turned 90 degrees at (20, 0). */
const DEF = {
  ...walledCity,
  props: [
    { kind: 'poster-wall', at: { x: 0, z: 0 } },
    { kind: 'lamp', at: { x: 5, z: 5 } },
    { kind: 'poster-wall', at: { x: 20, z: 0 }, rot: 90 },
  ],
} as DistrictDef

function setup(first: PosterView[] = []) {
  const scene = new THREE.Scene()
  const sheets: ReturnType<typeof fakeSheet>[] = []
  const hooks = { near: vi.fn(), tap: vi.fn(), gone: vi.fn() }
  let answer: (list: PosterView[]) => void = () => {}
  let refuse: (e: Error) => void = () => {}
  const load = vi.fn(
    () =>
      new Promise<PosterView[]>((resolve, reject) => {
        answer = resolve
        refuse = reject
      }),
  )
  const posters = createPosters({
    scene,
    def: DEF,
    hooks,
    load,
    sheet: () => {
      const s = fakeSheet()
      sheets.push(s)
      return s
    },
  })
  const meshes = () => scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
  const land = async (list = first) => {
    answer(list)
    await Promise.resolve()
    await Promise.resolve()
  }
  const fail = async () => {
    refuse(new Error('offline'))
    await Promise.resolve()
    await Promise.resolve()
  }
  return { scene, sheets, hooks, load, posters, meshes, land, fail }
}

describe('poster walls', () => {
  it('numbers each district’s walls as the server does', () => {
    for (const [id, def] of Object.entries(DEFS))
      expect(wallsOf(def), id).toHaveLength(POSTER_WALLS[id as DistrictId])
  })

  it('is in reach within 3 m of the wall itself, not only of its middle, turned or not', () => {
    const [straight, turned] = wallsOf(DEF) as [ReturnType<typeof wallsOf>[0], ReturnType<typeof wallsOf>[0]]
    // 2 m out from the face, near its end: 2.9 m from the middle, but 1.75 m from the wall.
    expect(wallDistance({ x: 2, z: 2 }, straight)).toBeCloseTo(1.75)
    expect(nearestWall({ x: 2, z: 2 }, [straight])).toBe(straight)
    expect(nearestWall({ x: 0, z: 3.3 }, [straight])).toBeNull()
    // Turned 90 degrees, its face runs along z: 2 m along it and 2 m out is in reach, 4 m along is not.
    expect(nearestWall({ x: 22, z: 2 }, [turned])).toBe(turned)
    expect(wallDistance({ x: 20.2, z: 4 }, turned)).toBeCloseTo(1.9)
    expect(nearestWall({ x: 20, z: 5.2 }, [turned])).toBeNull()
  })

  it('finds the slot under a point of the sheet: three across, two down, from the top left', () => {
    expect(slotAt(0.1, 0.9)).toBe(0)
    expect(slotAt(0.5, 0.9)).toBe(1)
    expect(slotAt(0.9, 0.9)).toBe(2)
    expect(slotAt(0.1, 0.1)).toBe(3)
    expect(slotAt(0.99, 0.01)).toBe(5)
    expect(slotAt(1, 0)).toBe(5)
  })

  it('wraps by words, and a word too long for a line by characters', () => {
    const ctx = fakeSheet().ctx
    // 8 px a character, 96 px a line: 12 characters.
    expect(wrap(ctx, 'chai at six', 96)).toEqual(['chai at six'])
    expect(wrap(ctx, 'chai at six pm sharp', 96)).toEqual(['chai at six', 'pm sharp'])
    expect(wrap(ctx, 'a'.repeat(22), 96)).toEqual(['a'.repeat(12), 'a'.repeat(10)])
    // Markup is only characters on a poster.
    expect(wrap(ctx, '<b>hi</b>', 200)).toEqual(['<b>hi</b>'])
  })

  it('draws a wall only once it has posters, and redraws only the wall that changed', async () => {
    const { posters, sheets, meshes, land } = setup([poster()])
    posters.refresh()
    expect(meshes()).toHaveLength(2)
    expect(meshes().every((m) => !m.visible)).toBe(true)
    await land()
    expect(meshes().map((m) => m.visible)).toEqual([true, false])
    expect(sheets[0]!.ctx.fillText).toHaveBeenCalledWith('Gully cricket, Sunday', 16, 16, expect.any(Number))
    expect(sheets[1]!.ctx.fillRect).not.toHaveBeenCalled()

    const before = sheets[0]!.ctx.fillRect.mock.calls.length
    posters.apply({ t: 'poster', op: 'add', poster: poster({ id: 'p2', wall: 1, slot: 4 }) })
    expect(meshes().map((m) => m.visible)).toEqual([true, true])
    expect(sheets[0]!.ctx.fillRect.mock.calls.length).toBe(before)
    // The same news again changes nothing, so draws nothing.
    const second = sheets[1]!.ctx.fillRect.mock.calls.length
    posters.apply({ t: 'poster', op: 'add', poster: poster({ id: 'p2', wall: 1, slot: 4 }) })
    expect(sheets[1]!.ctx.fillRect.mock.calls.length).toBe(second)

    posters.apply({ t: 'poster', op: 'remove', id: 'p1' })
    expect(meshes().map((m) => m.visible)).toEqual([false, true])
  })

  it('fetches again on a nudge, and replays what the socket said meanwhile', async () => {
    const { posters, load, land } = setup()
    posters.refresh()
    await land([poster()])
    posters.apply({ t: 'posters' })
    expect(load).toHaveBeenCalledTimes(2)
    // News while the fetch is out: applied on top of what it brings.
    posters.apply({ t: 'poster', op: 'remove', id: 'p1' })
    posters.apply({ t: 'poster', op: 'add', poster: poster({ id: 'p3', slot: 2 }) })
    await land([poster(), poster({ id: 'p9', slot: 5 })])
    expect(
      posters
        .all()
        .map((a) => a.poster.id)
        .sort(),
    ).toEqual(['p3', 'p9'])
  })

  it('a nudge whose fetch fails leaves the walls bare and tries once more; any other failure keeps them', async () => {
    vi.useFakeTimers()
    try {
      const { posters, load, land, fail, meshes, hooks } = setup()
      posters.refresh()
      await land([poster()])
      // A welcome's fetch failing: the walls keep what they show.
      posters.refresh()
      await fail()
      expect(meshes()[0]!.visible).toBe(true)
      // A block's nudge failing: whoever was blocked may be on them, so they go bare, and it is asked again once.
      posters.apply({ t: 'posters' })
      await fail()
      expect(meshes()[0]!.visible).toBe(false)
      expect(hooks.gone).toHaveBeenLastCalledWith(['p1'])
      expect(load).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(NUDGE_RETRY_MS)
      expect(load).toHaveBeenCalledTimes(4)
      await fail()
      await vi.advanceTimersByTimeAsync(NUDGE_RETRY_MS * 3)
      expect(load).toHaveBeenCalledTimes(4)
      posters.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says which posters left: taken down, dropped by a fetch, or pushed out of their slot', async () => {
    const { posters, land, hooks } = setup()
    posters.refresh()
    await land([poster(), poster({ id: 'p2', slot: 1 }), poster({ id: 'p3', slot: 2 })])
    posters.apply({ t: 'poster', op: 'remove', id: 'p1' })
    expect(hooks.gone).toHaveBeenLastCalledWith(['p1'])
    posters.upsert(poster({ id: 'p4', slot: 1 }))
    expect(hooks.gone).toHaveBeenLastCalledWith(['p2'])
    posters.refresh()
    await land([poster({ id: 'p4', slot: 1 })])
    expect(hooks.gone).toHaveBeenLastCalledWith(['p3'])
    expect(hooks.gone).toHaveBeenCalledTimes(3)
  })

  it('your own hidden poster is drawn on grey paper; when it is back up, on its colour again', async () => {
    const { sheets, posters, land } = setup()
    const papers: string[] = []
    sheets[0]!.ctx.fillRect.mockImplementation(() => void papers.push(sheets[0]!.ctx.fillStyle))
    posters.refresh()
    await land([poster({ mine: true, hidden: true })])
    expect(papers.length).toBeGreaterThan(0)
    expect(papers.at(-1)).toBe(HIDDEN_PAPER)
    posters.apply({ t: 'poster', op: 'add', poster: poster({ mine: true }) })
    expect(papers.at(-1)).not.toBe(HIDDEN_PAPER)
  })

  it('a poster that moves (a replaced slot) is drawn once, where it now is', async () => {
    const { posters, land } = setup()
    posters.refresh()
    await land([poster({ id: 'old', slot: 3 })])
    posters.apply({ t: 'poster', op: 'remove', id: 'old' } satisfies ServerMsg)
    posters.upsert(poster({ id: 'new', slot: 3 }))
    posters.upsert(poster({ id: 'new', slot: 3, text: 'Same poster, mine' }))
    expect(posters.all().map((a) => [a.poster.id, a.poster.slot, a.poster.text])).toEqual([
      ['new', 3, 'Same poster, mine'],
    ])
  })

  it('says which wall is in reach, and whether it is empty, only when that changes', async () => {
    const { posters, hooks, land } = setup()
    posters.refresh()
    await land([])
    posters.update({ x: 0, z: 2 })
    posters.update({ x: 0.5, z: 2 })
    expect(hooks.near).toHaveBeenCalledTimes(1)
    expect(hooks.near).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0 }), true)
    posters.apply({ t: 'poster', op: 'add', poster: poster() })
    expect(hooks.near).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0 }), false)
    posters.update({ x: 0, z: 10 })
    expect(hooks.near).toHaveBeenLastCalledWith(null, true)
    expect(hooks.near).toHaveBeenCalledTimes(3)
  })

  it('a tap on a poster picks it by where it lands on the wall', async () => {
    const { posters, scene, land } = setup()
    posters.refresh()
    await land([poster({ id: 'top-left', slot: 0 }), poster({ id: 'bottom-right', slot: 5 })])
    scene.updateMatrixWorld()
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
    camera.position.set(0, 1.6, 6)
    camera.updateMatrixWorld()
    const ray = new THREE.Raycaster()
    const aim = (id: string) => {
      const at = posters.all().find((a) => a.poster.id === id)!.at
      ray.set(camera.position, at.clone().sub(camera.position).normalize())
      return posters.pick(ray)?.id ?? null
    }
    expect(aim('top-left')).toBe('top-left')
    expect(aim('bottom-right')).toBe('bottom-right')
    // An empty slot, and the sky, are nothing.
    ray.set(camera.position, new THREE.Vector3(0, 2.0, 0.2).sub(camera.position).normalize())
    expect(posters.pick(ray)).toBeNull()
    ray.set(camera.position, new THREE.Vector3(0, 1, 0))
    expect(posters.pick(ray)).toBeNull()
  })

  it('disposes every texture, material and the geometry, and leaves the scene', async () => {
    const { posters, scene, hooks, land } = setup()
    posters.refresh()
    await land([poster()])
    posters.update({ x: 0, z: 1 })
    const [mesh] = scene.children as THREE.Mesh[]
    const tex = vi.spyOn((mesh!.material as THREE.MeshLambertMaterial).map!, 'dispose')
    const mat = vi.spyOn(mesh!.material as THREE.Material, 'dispose')
    const geo = vi.spyOn(mesh!.geometry, 'dispose')
    posters.dispose()
    expect(tex).toHaveBeenCalled()
    expect(mat).toHaveBeenCalled()
    expect(geo).toHaveBeenCalled()
    expect(scene.children).toHaveLength(0)
    expect(hooks.near).toHaveBeenLastCalledWith(null, true)
  })
})
