// @vitest-environment happy-dom
import * as THREE from 'three'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { connectLive } from './live'
import type { LivePerson, ServerMsg } from './protocol'
import walledCity from '../world/districts/walledCity'
import { createSitting } from '../world/benches'
import { createPeople } from '../world/people'

/**
 * The Worker deploys before the site, so for a while the page people already have open (built before emotes
 * existed) is sent `{t: 'emote', from, kind}` frames it has never heard of. This file runs such a frame through
 * that page's whole path for a district frame, as it was when emotes were added:
 *
 *   socket.onmessage (net/live.ts: JSON.parse, then onMsg)
 *     -> the presence's onMsg (world/session.ts): a chain of `if (m.t === ...) return ...` for the frames it
 *        handles itself, then `people.apply(m)` and `sitting?.apply(m)` for every other frame, then
 *        `if (m.t === 'welcome') ...`
 *
 * `people.apply` and `sitting.apply` are the same code the old page runs (emotes changed neither), and
 * `oldOnMsg` below is the old chain, written out. An unknown `t` falls through every one of them: nothing
 * throws, nothing is drawn, nothing is told to the page. So sending is not gated behind a client capability.
 */
class FakeSocket {
  static all: FakeSocket[] = []
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {}
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
})
afterEach(() => vi.useRealTimers())

const asha: LivePerson = {
  id: 'dev:asha',
  name: 'Asha',
  look: { skin: 1, outfit: 'teal', head: 'dupatta' },
  status: 'chai pe',
  x: 2,
  z: 0,
  ry: 0,
}

/** The frames a new Worker may send an old page: an emote as it is, and the shapes a later one might take. */
const NEW_FRAMES = [
  { t: 'emote', from: 'dev:asha', kind: 'dance' },
  { t: 'emote', from: 'dev:asha', kind: 'sit' },
  { t: 'emote', from: 'dev:nobody-here', kind: 'wave' },
  { t: 'emote', from: 'dev:asha', kind: 'a-kind-from-the-future' },
  { t: 'emote' },
  { t: 'emote-no', why: 'wait' },
] as unknown as ServerMsg[]

it('the page built before emotes takes an emote frame in its stride: nothing throws, nothing changes', async () => {
  const scene = new THREE.Scene()
  const people = createPeople(scene)
  const player = { position: () => ({ x: 0, z: 0 }), teleport: vi.fn() }
  const bench = { near: vi.fn(), seated: vi.fn(), line: vi.fn(), refused: vi.fn() }
  const sent: unknown[] = []
  const sitting = createSitting({ def: walledCity, player, hooks: bench, send: (m) => sent.push(m) })
  const posters = { apply: vi.fn(), refresh: vi.fn() }
  const reactions = { got: vi.fn(), sent: vi.fn(), refused: vi.fn() }
  const taxi = { refused: vi.fn() }
  const queued = vi.fn()
  const welcomed = vi.fn()

  /** world/session.ts `createPresence` > `onMsg`, as the live page has it (main at 2b5f8dc). */
  const oldOnMsg = (m: ServerMsg) => {
    if (m.t === 'error' && m.code === 'too-fast') return player.teleport(m.x, m.z, m.ry)
    if (m.t === 'error' && m.code === 'no-ride') return taxi.refused()
    if (m.t === 'queued') return queued(m.position, false)
    if (m.t === 'poster' || m.t === 'posters') return posters.apply(m)
    if (m.t === 'react') return reactions.got(m.from, m.kind)
    if (m.t === 'react-no') return reactions.refused(m.to, m.why)
    people.apply(m)
    sitting.apply(m)
    if (m.t === 'welcome') welcomed()
  }

  const conn = connectLive({
    district: 'walled-city',
    token: async () => null,
    onMsg: oldOnMsg,
    WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
  })
  await vi.advanceTimersByTimeAsync(0)
  const ws = FakeSocket.all[0]!
  ws.onopen?.()
  ws.onmessage?.({
    data: JSON.stringify({ t: 'welcome', you: { id: 'dev:me', visible: true }, people: [asha] }),
  })
  expect(welcomed).toHaveBeenCalledTimes(1)
  const before = JSON.stringify(people.list())
  const calls = () =>
    [player.teleport, taxi.refused, queued, posters.apply, reactions.got, reactions.refused, welcomed]
      .concat(Object.values(bench))
      .reduce((n, f) => n + f.mock.calls.length, 0)
  const was = calls()

  for (const frame of NEW_FRAMES)
    expect(() => ws.onmessage?.({ data: JSON.stringify(frame) }), JSON.stringify(frame)).not.toThrow()

  // the street is as it was, nobody was told anything, and the page sent nothing back
  expect(JSON.stringify(people.list())).toBe(before)
  expect(scene.children.filter((c) => c.name.startsWith('person-'))).toHaveLength(1)
  expect(calls()).toBe(was)
  expect(sent).toEqual([])
  expect(ws.sent).toEqual([])
  // and it goes on working: the next frames it does know are handled as ever
  ws.onmessage?.({ data: JSON.stringify({ t: 'moves', m: [['dev:asha', 4, 0, 0]] }) })
  people.update(10, { x: 0, z: 0 })
  expect(people.list()[0]!.x).toBeCloseTo(4)
  expect(conn.state()).toBe('open')
  conn.close()
  sitting.dispose()
  people.dispose()
})
