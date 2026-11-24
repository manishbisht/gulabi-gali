import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { storage } from '../storage'
import {
  DRESS_LIMITS,
  OUTFITS as WIRE_OUTFITS,
  SKIN_OF_TONE,
  TONE_COUNT,
  TONE_OF_SKIN,
  type AvatarLookWire,
  type Dress,
} from '../net/protocol'
import { PALETTE } from '../world/palette'
import type { AvatarLook } from '../world/types'
import {
  BODY_CACHE,
  buildAvatar,
  buildBodyGeometry,
  disposeAvatarCache,
  dressLook,
  dressOfLook,
  headgearOf,
  loadOrCreateLook,
  lookFromWire,
  lookKey,
  lookToWire,
  OUTFITS,
  randomLook,
  saveLocalLook,
  TONES,
  withoutHeadgear,
} from './avatar'

function triangleCount(group: THREE.Object3D): number {
  let n = 0
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    const g = o.geometry as THREE.BufferGeometry
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3
  })
  return n
}

function drawCalls(root: THREE.Object3D): number {
  let n = 0
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) n++
  })
  return n
}

describe('avatar', () => {
  it('an avatar is a single draw call', () => {
    for (const head of ['none', 'safa', 'cap', 'dupatta', 'bun'] as const) {
      const a = buildAvatar({ skin: 2, outfit: 'teal', head })
      expect(a).toBeInstanceOf(THREE.Mesh)
      expect(drawCalls(a)).toBe(1)
      expect(a.getObjectByProperty('isGroup', true)).toBeUndefined()
      expect(a.geometry.getAttribute('color')).toBeDefined()
    }
  })

  it('two identical looks share geometry and material; different looks do not', () => {
    const look = { skin: 1, outfit: 'pink', head: 'safa' } as const
    const a = buildAvatar(look)
    const b = buildAvatar({ ...look })
    expect(b.geometry).toBe(a.geometry)
    expect(b.material).toBe(a.material)
    expect(buildAvatar({ ...look, skin: 3 }).geometry).not.toBe(a.geometry)
  })

  it('casts a shadow by default (the local player) and not when asked', () => {
    const look = { skin: 0, outfit: 'pink', head: 'none' } as const
    expect(buildAvatar(look).castShadow).toBe(true)
    expect(buildAvatar(look, { castShadow: false }).castShadow).toBe(false)
  })

  it('stays under the triangle budget for every head', () => {
    for (const head of ['none', 'safa', 'cap', 'dupatta', 'bun'] as const)
      expect(triangleCount(buildAvatar({ skin: 2, outfit: 'teal', head }))).toBeLessThan(600)
  })

  it('gives each head its own geometry', () => {
    const count = (head: 'none' | 'safa') => triangleCount(buildAvatar({ skin: 0, outfit: 'pink', head }))
    expect(count('safa')).toBeGreaterThan(count('none'))
  })

  it('randomLook is deterministic for a given rand and always valid', () => {
    expect(randomLook(() => 0)).toEqual({ skin: 0, outfit: 'pink', head: 'none' })
    const top = randomLook(() => 0.999999)
    expect([0, 1, 2, 3, 4]).toContain(top.skin)
    expect(Object.keys(PALETTE)).toContain(top.outfit)
  })

  it('a random look never dresses someone in asphalt, sandstone, plain white or window glass', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) seen.add(randomLook(() => i / 200).outfit)
    for (const dull of ['road', 'sandstone', 'white', 'glass']) expect(seen.has(dull), dull).toBe(false)
    expect(seen.size).toBeGreaterThan(3) // and still varied
  })

  it('loadOrCreateLook creates once, persists under gg-look, and ignores junk', () => {
    storage.set('gg-look', '{"nope":1}')
    const made = loadOrCreateLook()
    expect(storage.getJSON('gg-look', null)).toEqual(made)
    expect(loadOrCreateLook()).toEqual(made)
  })
})

describe('the body cache', () => {
  /** A different body for each n: tone, kurta, hat and hair colour all vary. */
  const nth = (n: number): AvatarLook =>
    dressLook(
      { skin: 0, outfit: OUTFITS[n % 10]!, head: 'none' },
      { tone: Math.floor(n / 10) % 8, hat: 1, hatC: Math.floor(n / 80) % 10, hair: 2 },
    )

  it('frees the least recently used bodies nobody on a stage wears, and never one that is worn', () => {
    disposeAvatarCache()
    const scene = new THREE.Scene()
    // the first ten stand on the street the whole time
    const worn = Array.from({ length: 10 }, (_, n) => {
      const m = buildAvatar(nth(n))
      scene.add(m)
      return m
    })
    const freed = vi.fn()
    for (const m of worn) m.geometry.addEventListener('dispose', freed)
    // a crowd passes: each joins, then leaves the street (its figure goes off the stage)
    const passed: THREE.Mesh[] = []
    const left = new Set<number>()
    for (let n = 10; n < 10 + BODY_CACHE * 2; n++) {
      const m = buildAvatar(nth(n))
      scene.add(m)
      m.removeFromParent()
      passed.push(m)
      m.geometry.addEventListener('dispose', () => left.add(n))
    }
    // the street's bodies are untouched and still the cached ones
    expect(freed).not.toHaveBeenCalled()
    worn.forEach((m, n) => expect(buildAvatar(nth(n)).geometry).toBe(m.geometry))
    // the oldest of those who left were freed, and come back fresh when worn again
    expect(left.has(10)).toBe(true)
    expect(left.has(9 + BODY_CACHE * 2)).toBe(false)
    expect(buildAvatar(nth(10)).geometry).not.toBe(passed[0]!.geometry)
    // the newest who left is still there
    expect(buildAvatar(nth(9 + BODY_CACHE * 2)).geometry).toBe(passed.at(-1)!.geometry)
  })

  it('a body whose figure is in a group that has left the scene is not worn any more', () => {
    disposeAvatarCache()
    const scene = new THREE.Scene()
    const body = new THREE.Group()
    const first = buildAvatar(nth(0))
    body.add(first)
    scene.add(body)
    const freed = vi.fn()
    first.geometry.addEventListener('dispose', freed)
    for (let n = 1; n <= BODY_CACHE; n++) buildAvatar(nth(n)) // never staged
    expect(freed).not.toHaveBeenCalled()
    body.removeFromParent() // the person left: their body group is off the stage
    buildAvatar(nth(BODY_CACHE + 1))
    expect(freed).toHaveBeenCalledTimes(1)
  })
})

describe('disposeAvatarCache', () => {
  const look = { skin: 1, outfit: 'pink', head: 'cap' } as const

  it('disposes the cached geometry and material, and the next avatar is fresh and usable', () => {
    const old = buildAvatar(look)
    const geoDispose = vi.fn()
    const matDispose = vi.fn()
    old.geometry.addEventListener('dispose', geoDispose)
    ;(old.material as THREE.Material).addEventListener('dispose', matDispose)
    disposeAvatarCache()
    expect(geoDispose).toHaveBeenCalledTimes(1)
    expect(matDispose).toHaveBeenCalledTimes(1)
    const fresh = buildAvatar(look)
    expect(fresh.geometry).not.toBe(old.geometry)
    expect(fresh.material).not.toBe(old.material)
    expect(fresh.geometry.getAttribute('position').count).toBeGreaterThan(0)
    expect(buildAvatar({ ...look }).geometry).toBe(fresh.geometry) // caching works again
  })

  it('is safe to call twice', () => {
    disposeAvatarCache()
    expect(() => disposeAvatarCache()).not.toThrow()
  })
})

describe('the dressing room', () => {
  /** The five skins every figure was drawn with before tones. */
  const OLD_SKINS = ['#F1C9A5', '#D9A877', '#B98055', '#8D5A3B', '#5E3A26']
  const LEGACY: AvatarLook[] = (['none', 'safa', 'cap', 'dupatta', 'bun'] as const).flatMap((head) =>
    ([0, 1, 2, 3, 4] as const).map((skin) => ({ skin, outfit: 'teal' as const, head })),
  )
  /** Every dressing-room choice, one field at a time, on top of a dressed look. */
  const everyDress = (): AvatarLook[] => {
    const base: AvatarLook = dressLook({ skin: 2, outfit: 'pink', head: 'none' }, {})
    const out: AvatarLook[] = []
    for (const [k, n] of Object.entries(DRESS_LIMITS) as [keyof Dress, number][])
      for (let i = 0; i < n; i++) out.push(dressLook(base, { hat: 1, dup: 2, [k]: i }))
    return out
  }
  /** The colours a body is drawn in, as #rrggbb. */
  const colours = (look: AvatarLook) => {
    const c = buildBodyGeometry(look).getAttribute('color')
    const seen = new Set<string>()
    for (let i = 0; i < c.count; i++)
      seen.add('#' + new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)).getHexString())
    return seen
  }

  it('the older five skins are tones of the new range, so nobody changes colour', () => {
    expect(TONES).toHaveLength(TONE_COUNT)
    OLD_SKINS.forEach((hex, skin) => expect(TONES[TONE_OF_SKIN[skin as 0]]).toBe(hex))
    // and each of those tones' nearest older skin is the skin it is
    TONE_OF_SKIN.forEach((tone, skin) => expect(SKIN_OF_TONE[tone]).toBe(skin))
    // the colour indices on the wire are the palette's own order
    expect(OUTFITS).toEqual([...WIRE_OUTFITS])
  })

  it('an older look is drawn exactly as it always was, the same as its dressed twin', () => {
    for (const look of LEGACY) {
      const twin = dressLook(look, {})
      expect(lookKey(twin), JSON.stringify(look)).toBe(lookKey(look))
      expect(buildAvatar(twin).geometry).toBe(buildAvatar(look).geometry)
      const a = buildBodyGeometry(look).getAttribute('position')
      const b = buildBodyGeometry(twin).getAttribute('position')
      expect(Array.from(b.array)).toEqual(Array.from(a.array))
    }
    // a safa in marigold, a white cap, a dupatta in the outfit's colour, as before
    expect(colours({ skin: 0, outfit: 'teal', head: 'safa' })).toContain(PALETTE.marigold.toLowerCase())
    expect(colours({ skin: 0, outfit: 'teal', head: 'cap' })).toContain(PALETTE.white.toLowerCase())
    expect(colours({ skin: 0, outfit: 'pink', head: 'dupatta' })).toEqual(
      new Set([PALETTE.pink, PALETTE.road, OLD_SKINS[0]!].map((h) => h.toLowerCase())),
    )
  })

  it('every choice is one draw call under the triangle budget, and drawn its own way', () => {
    const keys = new Set<string>()
    for (const look of everyDress()) {
      const a = buildAvatar(look)
      expect(drawCalls(a)).toBe(1)
      expect(triangleCount(a), JSON.stringify(look)).toBeLessThan(600)
      keys.add(lookKey(look))
    }
    // one field at a time over a shared base: all but the repeats of the base are new figures
    const total = Object.values(DRESS_LIMITS).reduce((a, b) => a + b, 0)
    expect(keys.size).toBeGreaterThan(total - Object.keys(DRESS_LIMITS).length - 2)
    expect(colours(dressLook({ skin: 0, outfit: 'teal', head: 'none' }, { hat: 2, hatC: 0 }))).toContain(
      PALETTE.pink.toLowerCase(),
    )
  })

  it('a client from before the dressing room can read every dressed look', () => {
    // what an older build does with a look from the server (its `lookFromWire`), check for check
    const oldRead = (w: AvatarLookWire) => {
      const l = { skin: w.skin, outfit: w.outfit, head: w.head }
      const ok =
        Number.isInteger(l.skin) &&
        l.skin >= 0 &&
        l.skin <= 4 &&
        l.outfit in PALETTE &&
        ['none', 'safa', 'cap', 'dupatta', 'bun'].includes(l.head)
      return ok ? l : null
    }
    for (const look of everyDress()) expect(oldRead(lookToWire(look)), JSON.stringify(look)).not.toBeNull()
    // and it draws the nearest: a pagdi is a safa, a stole alone a bare head
    const plain = LEGACY[0]!
    expect(oldRead(lookToWire(dressLook(plain, { hat: 2, tone: 7 })))).toMatchObject({
      head: 'safa',
      skin: 4,
    })
    expect(oldRead(lookToWire(dressLook(plain, { dup: 2 })))).toMatchObject({ head: 'none' })
  })

  it('a look from the server keeps what it knows and drops what it does not, the older fields filling in', () => {
    expect(lookFromWire({ skin: 3, outfit: 'teal', head: 'safa' })).toEqual({
      skin: 3,
      outfit: 'teal',
      head: 'safa',
    })
    // a newer option (a fifth hat) or junk: that field goes, the rest stays, the older head fills in
    const newer = lookFromWire({ skin: 1, outfit: 'teal', head: 'cap', hat: 9, hair: 3, dup: 'x' } as never)!
    expect(dressOfLook(newer)).toMatchObject({ hat: 3, hair: 3, dup: 0 })
    expect(lookFromWire({ skin: 9, outfit: 'teal', head: 'none', tone: 2 } as never)).toBeNull()
  })

  it('a guest keeps their dressed look on this device', () => {
    const look = dressLook({ skin: 0, outfit: 'grass', head: 'none' }, { tone: 6, hair: 4, dup: 2, dupC: 3 })
    saveLocalLook(look)
    expect(loadOrCreateLook()).toEqual(look)
    // a stored look with a broken dressing field still loads, without it
    storage.set('gg-look', JSON.stringify({ ...look, hair: 'long' }))
    expect(dressOfLook(loadOrCreateLook()).hair).toBe(0)
  })

  it('the monkey takes the headwear first, then a dupatta, and nothing from a bare head', () => {
    const all = dressLook({ skin: 0, outfit: 'teal', head: 'none' }, { hat: 3, hatC: 9, dup: 1, dupC: 0 })
    expect(headgearOf(all)).toEqual({ gear: 'cap', hex: PALETTE.glass })
    const capless = withoutHeadgear(all)
    expect(dressOfLook(capless)).toMatchObject({ hat: 0, dup: 1 })
    expect(headgearOf(capless)).toEqual({ gear: 'dupatta', hex: PALETTE.pink })
    expect(headgearOf(withoutHeadgear(capless))).toBeNull()
    expect(headgearOf({ skin: 0, outfit: 'teal', head: 'bun' })).toBeNull()
    expect(withoutHeadgear({ skin: 0, outfit: 'teal', head: 'safa' })).toEqual({
      skin: 0,
      outfit: 'teal',
      head: 'none',
    })
  })
})
