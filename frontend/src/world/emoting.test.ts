// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMOTE_KINDS, EMOTE_PER_MINUTE, type EmoteKind, type LivePerson } from '../net/protocol'
import { STRINGS } from '../i18n/strings'
import {
  createEmoteAllowance,
  createEmoting,
  emoted,
  emotePose,
  EMOTE_MARKS,
  EMOTE_SECONDS,
  onEmoted,
  SETTLE_S,
  type EmotePose,
} from './emoting'
import { createPeople } from './people'

afterEach(() => {
  document.body.innerHTML = ''
})

const pose = (kind: EmoteKind, t: number, still = false): EmotePose =>
  emotePose(kind, t, still, { y: 9, spin: 9, lean: 9, sway: 9 })

describe('the poses', () => {
  it('every kind has a mark, a length and a name in both languages', () => {
    const names = { dance: 'emoteDance', clap: 'emoteClap', sit: 'emoteSit', selfie: 'emoteSelfie', wave: 'emoteWave' }
    for (const kind of EMOTE_KINDS) {
      expect(EMOTE_MARKS[kind], kind).toBeTruthy()
      expect(EMOTE_SECONDS[kind], kind).toBeGreaterThan(2)
      expect(STRINGS[names[kind] as keyof typeof STRINGS].hi, kind).toBeTruthy()
      expect(STRINGS[names[kind] as keyof typeof STRINGS].en, kind).toBeTruthy()
    }
    // only sitting lasts: until the sitter walks on
    expect(EMOTE_KINDS.filter((k) => EMOTE_SECONDS[k] === Infinity)).toEqual(['sit'])
  })

  it('a dance turns the body round twice and leaves it facing the way it began', () => {
    expect(pose('dance', 0).spin).toBe(0)
    expect(pose('dance', EMOTE_SECONDS.dance / 2).spin).toBeCloseTo(2 * Math.PI)
    expect(pose('dance', EMOTE_SECONDS.dance).spin).toBeCloseTo(4 * Math.PI)
    // never under the ground
    for (let t = 0; t < 4; t += 0.05) expect(pose('dance', t).y).toBeGreaterThanOrEqual(0)
  })

  it('sitting lowers the figure onto the ground and holds it there', () => {
    expect(pose('sit', 0).y).toBeCloseTo(0)
    expect(pose('sit', 1).y).toBeCloseTo(-0.45)
    expect(pose('sit', 600).y).toBeCloseTo(-0.45)
    expect(pose('sit', 600).spin).toBe(0)
  })

  it('a clap bounces, a wave sways, a selfie leans back; none of them turns the body', () => {
    expect(Math.max(...[0.1, 0.2, 0.3].map((t) => pose('clap', t).y))).toBeGreaterThan(0.03)
    expect(Math.abs(pose('wave', 1 / 6).sway)).toBeGreaterThan(0.05)
    expect(pose('selfie', 1).lean).toBeLessThan(-0.1)
    for (const kind of ['clap', 'wave', 'selfie', 'sit'] as const)
      for (let t = 0; t < 3; t += 0.1) expect(pose(kind, t).spin, kind).toBe(0)
  })

  it('with reduced motion nothing turns, bounces or sways: each pose is the same at every moment', () => {
    for (const kind of EMOTE_KINDS) {
      const first = { ...pose(kind, 0, true) }
      for (let t = 0; t < 4; t += 0.13) expect(pose(kind, t, true), `${kind} at ${t}`).toEqual(first)
      expect(first.spin, kind).toBe(0)
    }
    // the held poses are still held
    expect(pose('sit', 0, true).y).toBeCloseTo(-0.45)
    expect(pose('dance', 1, true)).toEqual({ y: 0, spin: 0, lean: 0, sway: 0 })
  })

  it('writes into the object it is handed: a frame allocates nothing', () => {
    const out = { y: 1, spin: 1, lean: 1, sway: 1 }
    expect(emotePose('clap', 0, true, out)).toBe(out)
    expect(out).toEqual({ y: 0, spin: 0, lean: 0, sway: 0 })
  })
})

describe('the allowance', () => {
  it(`lets ${EMOTE_PER_MINUTE} go in any minute, and the next only once the oldest is a minute old`, () => {
    const a = createEmoteAllowance()
    for (let i = 0; i < EMOTE_PER_MINUTE; i++) expect(a.take(1000 + i * 100), `#${i}`).toBe(true)
    expect(a.take(3000)).toBe(false)
    expect(a.take(60_999)).toBe(false)
    expect(a.take(61_000)).toBe(true) // the first is a minute old
    expect(a.take(61_050)).toBe(false) // the second is not yet
    expect(a.take(61_100)).toBe(true)
  })
})

describe('the hook', () => {
  it('emoted() tells whoever listens, and nobody once they stop', () => {
    const heard = vi.fn()
    const off = onEmoted(heard)
    emoted('dance')
    expect(heard).toHaveBeenCalledWith('dance')
    off()
    emoted('clap')
    expect(heard).toHaveBeenCalledTimes(1)
  })
})

const asha: LivePerson = {
  id: 'dev:asha',
  name: 'Asha',
  look: { skin: 1, outfit: 'teal', head: 'dupatta' },
  status: '',
  x: 3,
  z: 0,
  ry: 0,
}

function street(over: { can?: () => boolean; still?: () => boolean; offline?: boolean } = {}) {
  const ended = vi.fn()
  const scene = new THREE.Scene()
  const people = createPeople(scene)
  people.apply({ t: 'welcome', you: { id: 'dev:me', visible: true }, people: [asha] })
  const host = document.body.appendChild(document.createElement('div'))
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 2, 10)
  camera.lookAt(0, 2, 0)
  camera.updateMatrixWorld()
  const at = { x: 0, z: 0 }
  const player = {
    position: () => ({ ...at }),
    elevation: () => 0,
    setPose: vi.fn<(y: number, spin: number, lean: number, sway: number) => void>(),
  }
  const send = vi.fn<(kind: EmoteKind) => void>()
  const emoting = createEmoting({
    host,
    camera,
    player,
    people: over.offline ? null : people,
    can: over.can ?? (() => true),
    send,
    ended,
    still: over.still ?? (() => false),
  })
  /** A frame, as the session runs one: the people first, then the emotes. */
  const tick = (dt: number) => {
    people.update(dt, at)
    emoting.update(dt, at)
  }
  const marks = () =>
    [...host.querySelectorAll<HTMLElement>('.emote')].filter((el) => !el.hidden).map((el) => el.textContent)
  const figure = () => people.get('dev:asha')!.avatar
  return { people, emoting, player, send, ended, tick, marks, at, figure, host }
}

describe("the player's own emote", () => {
  it('plays at once: a mark overhead, the pose on the body, the street told, the hook called', () => {
    const { emoting, player, send, tick, marks } = street()
    const heard = vi.fn()
    const off = onEmoted(heard)
    expect(emoting.play('clap')).toBe(true)
    expect(send).toHaveBeenCalledExactlyOnceWith('clap')
    expect(heard).toHaveBeenCalledExactlyOnceWith('clap')
    tick(0.1)
    expect(marks()).toEqual([EMOTE_MARKS.clap])
    expect(emoting.playing().self).toBe('clap')
    expect(player.setPose).toHaveBeenLastCalledWith(expect.closeTo(0.07 * Math.sin(Math.PI * 0.25)), 0, 0, 0)
    off()
  })

  it('ends by itself when its time is up, and the body stands straight again', () => {
    const { emoting, player, tick, marks } = street()
    emoting.play('wave')
    tick(EMOTE_SECONDS.wave - 0.1)
    expect(emoting.playing().self).toBe('wave')
    tick(0.2)
    expect(emoting.playing().self).toBeNull()
    expect(player.setPose).toHaveBeenLastCalledWith(0, 0, 0, 0)
    expect(marks()).toEqual([])
  })

  it('a step ends it, sitting too: which otherwise lasts as long as the sitter stays', () => {
    const { emoting, player, tick, at } = street()
    emoting.play('sit')
    tick(600)
    expect(emoting.playing().self).toBe('sit')
    expect(player.setPose).toHaveBeenLastCalledWith(expect.closeTo(-0.45), 0, expect.closeTo(-0.08), 0)
    at.x = 0.2
    tick(1 / 60)
    expect(emoting.playing().self).toBeNull()
    expect(player.setPose).toHaveBeenLastCalledWith(0, 0, 0, 0)
  })

  it('is played standing: while the player walks none begins, nothing is sent and the hook is not called', () => {
    const { emoting, send, tick, marks, at } = street()
    const heard = vi.fn()
    const off = onEmoted(heard)
    tick(1 / 60)
    // the stick is held: each frame moves them on
    for (let i = 0; i < 3; i++) {
      at.x += 4 / 60
      tick(1 / 60)
      expect(emoting.play('sit'), `frame ${i}`).toBe(false)
    }
    expect(send).not.toHaveBeenCalled()
    expect(heard).not.toHaveBeenCalled()
    expect(emoting.playing().self).toBeNull()
    expect(marks()).toEqual([])
    // let go: the next frame finds them standing, and it plays
    tick(1 / 60)
    expect(emoting.play('sit')).toBe(true)
    expect(send).toHaveBeenCalledExactlyOnceWith('sit')
    off()
  })

  it('says so when it ends early (a step, or somewhere it may not go on), and not when its time is simply up', () => {
    let ok = true
    const { emoting, ended, tick, at } = street({ can: () => ok })
    emoting.play('wave')
    tick(EMOTE_SECONDS.wave + 0.1)
    expect(emoting.playing().self).toBeNull()
    expect(ended).not.toHaveBeenCalled()
    // the smallest step that ends one: just past 5 cm from where it began
    emoting.play('sit')
    tick(1)
    at.x += 0.05
    tick(1 / 60)
    expect(emoting.playing().self).toBe('sit')
    at.x += 0.002
    tick(1 / 60)
    expect(emoting.playing().self).toBeNull()
    expect(ended).toHaveBeenCalledTimes(1)
    tick(1 / 60)
    emoting.play('sit')
    ok = false
    tick(1 / 60)
    expect(ended).toHaveBeenCalledTimes(2)
    // and only once each
    tick(1 / 60)
    expect(ended).toHaveBeenCalledTimes(2)
  })

  it('cannot start, and does not go on, where the player may not emote (a bench, a wheel, a taxi)', () => {
    let ok = false
    const { emoting, send, tick, marks } = street({ can: () => ok })
    const heard = vi.fn()
    const off = onEmoted(heard)
    expect(emoting.play('dance')).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(heard).not.toHaveBeenCalled()
    tick(0.1)
    expect(marks()).toEqual([])
    ok = true
    expect(emoting.play('dance')).toBe(true)
    tick(0.1)
    ok = false // sat down at a bench mid-dance
    tick(0.1)
    expect(emoting.playing().self).toBeNull()
    off()
  })

  it('plays offline too: nobody else to draw, the player still dances', () => {
    const { emoting, tick, marks } = street({ offline: true })
    expect(emoting.play('dance')).toBe(true)
    emoting.heard('dev:asha', 'wave') // no street: nobody to show it on
    tick(0.1)
    expect(marks()).toEqual([EMOTE_MARKS.dance])
    expect(emoting.playing()).toEqual({ self: 'dance', others: [] })
  })
})

describe("someone else's emote", () => {
  it('poses their figure and puts the mark over them, then lets go when its time is up', () => {
    const { emoting, tick, marks, figure } = street()
    emoting.heard('dev:asha', 'dance')
    tick(1)
    expect(marks()).toEqual([EMOTE_MARKS.dance])
    expect(emoting.playing().others).toEqual([{ id: 'dev:asha', kind: 'dance' }])
    expect(figure().rotation.y).toBeGreaterThan(0.5)
    tick(EMOTE_SECONDS.dance)
    expect(emoting.playing().others).toEqual([])
    expect(figure().rotation.toArray().slice(0, 3)).toEqual([0, 0, 0])
    expect(figure().position.y).toBe(0)
  })

  it('their next step ends it for this page: there is no other word that it stopped', () => {
    const { emoting, people, tick, figure } = street()
    emoting.heard('dev:asha', 'sit')
    tick(SETTLE_S + 0.1)
    tick(300)
    expect(emoting.playing().others).toHaveLength(1)
    expect(figure().position.y).toBeCloseTo(-0.45)
    people.apply({ t: 'moves', m: [['dev:asha', 3.5, 0, 0]] })
    tick(1 / 60)
    expect(emoting.playing().others).toEqual([])
    tick(1 / 60)
    expect(figure().position.y).toBe(0)
    expect(figure().rotation.x).toBe(0)
  })

  it("ends on the smallest step their page ends its own by, as the server rounds it: 5 cm less a centimetre's rounding", () => {
    const { emoting, people, tick } = street()
    emoting.heard('dev:asha', 'sit')
    tick(SETTLE_S + 0.1)
    // the same point said again (a reconnect's first move) is no step
    people.apply({ t: 'moves', m: [['dev:asha', 3, 0, 0]] })
    tick(1 / 60)
    expect(emoting.playing().others).toHaveLength(1)
    // 5.2 cm from where it began, heard as 4.5 cm at the worst rounding at both ends
    people.apply({ t: 'moves', m: [['dev:asha', 3.045, 0, 0]] })
    tick(1 / 60)
    expect(emoting.playing().others).toEqual([])
  })

  it("their page's word that it stopped ends it at once, with no step: sat, then a game began where they stood", () => {
    const { emoting, tick, marks, figure } = street()
    emoting.heard('dev:asha', 'sit')
    tick(2)
    expect(figure().position.y).toBeCloseTo(-0.45)
    emoting.heard('dev:asha', 'stop')
    expect(emoting.playing().others).toEqual([])
    tick(1 / 60)
    expect(figure().position.y).toBe(0)
    expect(figure().rotation.x).toBe(0)
    expect(marks()).toEqual([])
    // a stop for nobody playing, or nobody at all, is nothing
    emoting.heard('dev:asha', 'stop')
    emoting.heard('dev:stranger', 'stop')
    expect(emoting.playing().others).toEqual([])
  })

  it('sat, then nudged within the first moments: the step does not count yet, and the stop ends it all the same', () => {
    expect(SETTLE_S).toBeLessThanOrEqual(0.2)
    const { emoting, people, tick } = street()
    emoting.heard('dev:asha', 'sit')
    tick(0.05)
    // their nudge, 0.1 s after they sat: inside the time a step is not yet counted
    people.apply({ t: 'moves', m: [['dev:asha', 3.06, 0, 0]] })
    tick(0.05)
    expect(emoting.playing().others).toHaveLength(1)
    emoting.heard('dev:asha', 'stop')
    expect(emoting.playing().others).toEqual([])
  })

  it('a move that arrives just after the emote it was sent before does not end it', () => {
    const { emoting, people, tick } = street()
    emoting.heard('dev:asha', 'wave')
    tick(0.05)
    // where the emote began, overtaken on the way (a Worker that does not send it first)
    people.apply({ t: 'moves', m: [['dev:asha', 3.3, 0, 0]] })
    tick(0.05)
    expect(emoting.playing().others).toHaveLength(1)
    tick(SETTLE_S)
    expect(emoting.playing().others).toHaveLength(1)
    // a step after that is a real one
    people.apply({ t: 'moves', m: [['dev:asha', 3.6, 0, 0]] })
    tick(1 / 60)
    expect(emoting.playing().others).toEqual([])
  })

  it('is drawn only for someone the street lists, and only a kind this page knows', () => {
    const { emoting, tick, marks } = street()
    // blocked people and ghosts are never listed; the player's own id is not either
    emoting.heard('dev:stranger', 'dance')
    emoting.heard('dev:me', 'dance')
    // a newer server's kind, or a frame that is not what it should be
    emoting.heard('dev:asha', 'cartwheel')
    emoting.heard('dev:asha', undefined)
    emoting.heard(undefined, 'dance')
    emoting.heard({ id: 'dev:asha' }, 'dance')
    tick(0.1)
    expect(marks()).toEqual([])
    expect(emoting.playing().others).toEqual([])
  })

  it('goes with them when they leave the street, or the street empties', () => {
    const { emoting, people, tick, marks } = street()
    emoting.heard('dev:asha', 'sit')
    tick(1)
    people.apply({ t: 'leave', id: 'dev:asha' })
    tick(1 / 60)
    expect(emoting.playing().others).toEqual([])
    expect(marks()).toEqual([])
    // back again: a late joiner's view, standing (the emote is not replayed)
    people.apply({ t: 'join', p: asha })
    tick(1 / 60)
    expect(people.get('dev:asha')!.avatar.position.y).toBe(0)
    expect(emoting.playing().others).toEqual([])
  })

  it('someone at the wheel of an auto is not posed', () => {
    const { emoting, people, tick } = street()
    people.apply({ t: 'moves', m: [['dev:asha', 3, 0, 0, 'auto']] })
    emoting.heard('dev:asha', 'dance')
    tick(0.1)
    expect(emoting.playing().others).toEqual([])
  })

  it('dispose takes every mark off the page and stands everyone straight', () => {
    const { emoting, tick, host, figure, player } = street()
    emoting.play('sit')
    emoting.heard('dev:asha', 'selfie')
    tick(1)
    expect(figure().rotation.x).toBeLessThan(0)
    emoting.dispose()
    expect(host.querySelectorAll('.emote')).toHaveLength(0)
    expect(figure().rotation.x).toBe(0)
    expect(player.setPose).toHaveBeenLastCalledWith(0, 0, 0, 0)
  })
})
