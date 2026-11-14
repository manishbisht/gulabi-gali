import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { connectLive, liveUrl } from './live'
import { LIVE_CLOSE, type ServerMsg } from './protocol'

/** Just enough of a browser WebSocket: the test opens, closes and messages it by hand. */
class FakeSocket {
  static all: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.readyState = 3
  }
  /** The server side. */
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  hangUp(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
  say(m: ServerMsg) {
    this.onmessage?.({ data: JSON.stringify(m) })
  }
}

const Impl = FakeSocket as unknown as typeof WebSocket
const last = () => FakeSocket.all.at(-1)!

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
})
afterEach(() => vi.useRealTimers())

function live(onMsg = vi.fn(), onReplaced = vi.fn(), token = async (): Promise<string | null> => null) {
  const conn = connectLive({ district: 'walled-city', token, onMsg, onReplaced, WebSocketImpl: Impl })
  return { conn, onMsg, onReplaced }
}

it('builds the socket URL from the API base, with the token only when there is one', () => {
  expect(liveUrl('mi-road', null)).toBe('ws://127.0.0.1:8787/api/districts/mi-road/live')
  expect(liveUrl('mi-road', 'a b')).toBe('ws://127.0.0.1:8787/api/districts/mi-road/live?token=a%20b')
})

it('connects with the token the getter gives at the time', async () => {
  let tok: string | null = 'dev.asha.1'
  const { conn } = live(vi.fn(), vi.fn(), async () => tok)
  await vi.advanceTimersByTimeAsync(0)
  expect(last().url).toContain('?token=dev.asha.1')
  tok = null
  last().open()
  last().hangUp()
  await vi.advanceTimersByTimeAsync(1000)
  expect(last().url).not.toContain('token')
  conn.close()
})

it('reconnects after the socket closes with growing delays', async () => {
  const { conn } = live()
  await vi.advanceTimersByTimeAsync(0)
  expect(FakeSocket.all).toHaveLength(1)
  expect(conn.state()).toBe('connecting')
  last().open()
  expect(conn.state()).toBe('open')
  const waits = [1000, 2000, 4000, 8000, 15000, 15000]
  for (const wait of waits) {
    const before = FakeSocket.all.length
    last().hangUp()
    expect(conn.state()).toBe('connecting')
    await vi.advanceTimersByTimeAsync(wait - 1)
    expect(FakeSocket.all, `still waiting ${wait} ms`).toHaveLength(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.all, `reconnected after ${wait} ms`).toHaveLength(before + 1)
  }
  // 30 s connected: the next drop starts over at 1 s
  last().open()
  await vi.advanceTimersByTimeAsync(30_000)
  last().hangUp()
  const before = FakeSocket.all.length
  await vi.advanceTimersByTimeAsync(1000)
  expect(FakeSocket.all).toHaveLength(before + 1)
  conn.close()
  expect(conn.state()).toBe('closed')
})

it('never reconnects after being replaced by another tab, and says so', async () => {
  const { conn, onReplaced } = live()
  await vi.advanceTimersByTimeAsync(0)
  last().open()
  last().hangUp(LIVE_CLOSE.replaced)
  expect(onReplaced).toHaveBeenCalledOnce()
  expect(conn.state()).toBe('closed')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(FakeSocket.all).toHaveLength(1)
})

it('a ban (4004) says so at once, then reconnects as anyone dropped does', async () => {
  const onBanned = vi.fn()
  const conn = connectLive({
    district: 'walled-city',
    token: async () => null,
    onMsg: vi.fn(),
    onBanned,
    WebSocketImpl: Impl,
  })
  await vi.advanceTimersByTimeAsync(0)
  last().open()
  last().hangUp(LIVE_CLOSE.banned)
  expect(onBanned).toHaveBeenCalledOnce()
  // the next socket is whoever the page now is (a ghost, once it knows): the server decides
  expect(conn.state()).toBe('connecting')
  conn.close()
})

it('close stops a pending reconnect and a pending token', async () => {
  let release: (t: string | null) => void = () => {}
  const { conn } = live(vi.fn(), vi.fn(), () => new Promise((r) => (release = r)))
  conn.close()
  release('dev.late.1')
  await vi.advanceTimersByTimeAsync(0)
  expect(FakeSocket.all).toHaveLength(0)

  const again = live()
  await vi.advanceTimersByTimeAsync(0)
  last().open()
  last().hangUp()
  again.conn.close()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(FakeSocket.all).toHaveLength(1)
})

it('hands parsed server messages on and ignores garbage', async () => {
  const { conn, onMsg } = live()
  await vi.advanceTimersByTimeAsync(0)
  last().open()
  last().onmessage?.({ data: 'not json' })
  last().say({ t: 'leave', id: 'dev:asha' })
  expect(onMsg).toHaveBeenCalledExactlyOnceWith({ t: 'leave', id: 'dev:asha' })
  conn.close()
})

it("throttles a resident's moves to 10 Hz and skips tiny ones", async () => {
  const { conn } = live(vi.fn(), vi.fn(), async () => 'dev.asha.1')
  await vi.advanceTimersByTimeAsync(0)
  const ws = last()
  conn.send({ t: 'move', x: 0, z: 0, ry: 0 }) // not open yet: dropped
  ws.open()
  const moves = () => ws.sent.map((s) => JSON.parse(s)).filter((m) => m.t === 'move')

  conn.send({ t: 'move', x: 1, z: 0, ry: 0 })
  expect(moves()).toEqual([{ t: 'move', x: 1, z: 0, ry: 0 }])
  // a frame later: too soon, whatever it says
  await vi.advanceTimersByTimeAsync(16)
  conn.send({ t: 'move', x: 2, z: 0, ry: 0 })
  expect(moves()).toHaveLength(1)
  // a whole second of frames, walking: about ten go out
  for (let i = 0; i < 60; i++) {
    await vi.advanceTimersByTimeAsync(16)
    conn.send({ t: 'move', x: 2 + i * 0.07, z: 0, ry: 0 })
  }
  expect(moves().length).toBeGreaterThanOrEqual(9)
  expect(moves().length).toBeLessThanOrEqual(11)

  const n = moves().length
  const at = moves().at(-1)
  await vi.advanceTimersByTimeAsync(200)
  conn.send({ ...at, x: at.x + 0.04 }) // 4 cm: not worth sending
  conn.send({ ...at, ry: (1.5 * Math.PI) / 180 }) // 1.5°: nor this
  expect(moves()).toHaveLength(n)
  conn.send({ ...at, ry: (3 * Math.PI) / 180 }) // 3°: a real turn
  expect(moves()).toHaveLength(n + 1)
  await vi.advanceTimersByTimeAsync(200)
  conn.send({ ...at, x: at.x + 0.06, ry: (3 * Math.PI) / 180 }) // 6 cm
  expect(moves()).toHaveLength(n + 2)
  conn.close()
})

it("a ghost's moves go out every 500 ms (2 Hz): nobody watches a ghost walk", async () => {
  const { conn } = live()
  await vi.advanceTimersByTimeAsync(0)
  const ws = last()
  ws.open()
  const moves = () => ws.sent.map((s) => JSON.parse(s)).filter((m) => m.t === 'move')
  let x = 0
  const step = () => conn.send({ t: 'move', x: (x += 0.07), z: 0, ry: 0 })
  step()
  expect(moves()).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(499)
  step()
  expect(moves()).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  step()
  expect(moves()).toHaveLength(2)
  // two seconds of frames, walking: three or four more, never the twenty a resident's would be
  for (let i = 0; i < 125; i++) {
    await vi.advanceTimersByTimeAsync(16)
    step()
  }
  expect(moves().length).toBeGreaterThanOrEqual(5)
  expect(moves().length).toBeLessThanOrEqual(6)
  conn.close()
})

it('a new socket sends the same position again: the server needs one per socket', async () => {
  const { conn } = live()
  await vi.advanceTimersByTimeAsync(0)
  last().open()
  conn.send({ t: 'move', x: 1, z: 1, ry: 0 })
  last().hangUp()
  await vi.advanceTimersByTimeAsync(1000)
  last().open()
  conn.send({ t: 'move', x: 1, z: 1, ry: 0 })
  expect(last().sent).toEqual(['{"t":"move","x":1,"z":1,"ry":0}'])
  conn.close()
})

it('pings exactly {"t":"ping"} every 10 s while idle', async () => {
  const { conn } = live()
  await vi.advanceTimersByTimeAsync(0)
  const ws = last()
  ws.open()
  await vi.advanceTimersByTimeAsync(9_999)
  expect(ws.sent).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(ws.sent).toEqual(['{"t":"ping"}'])
  // moving counts as being heard: the ping waits for 10 s after the last move
  await vi.advanceTimersByTimeAsync(5_000)
  conn.send({ t: 'move', x: 5, z: 5, ry: 0 })
  await vi.advanceTimersByTimeAsync(9_999)
  expect(ws.sent).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(ws.sent.at(-1)).toBe('{"t":"ping"}')
  conn.close()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(ws.sent).toHaveLength(3)
})
