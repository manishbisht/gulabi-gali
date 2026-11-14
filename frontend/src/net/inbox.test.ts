import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { connectInbox, inboxUrl } from './inbox'
import { LIVE_CLOSE } from './protocol'

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
const Impl = FakeSocket as unknown as typeof WebSocket
const last = () => FakeSocket.all.at(-1)!

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
})
afterEach(() => vi.useRealTimers())

function inbox() {
  const onNotice = vi.fn()
  const onOpen = vi.fn()
  const onReplaced = vi.fn()
  const conn = connectInbox({ token: async () => 'tok', onNotice, onOpen, onReplaced, WebSocketImpl: Impl })
  return { conn, onNotice, onOpen, onReplaced }
}

it('connects with the token, reports notices and every open', async () => {
  const { onNotice, onOpen } = inbox()
  await vi.advanceTimersByTimeAsync(0)
  expect(last().url).toBe(inboxUrl('tok'))
  last().onopen!()
  expect(onOpen).toHaveBeenCalledTimes(1)
  last().onmessage!({ data: JSON.stringify({ t: 'request', id: 'r1' }) })
  last().onmessage!({ data: JSON.stringify({ t: 'pong' }) })
  last().onmessage!({ data: 'garbage' })
  expect(onNotice).toHaveBeenCalledTimes(1)
  expect(onNotice).toHaveBeenCalledWith({ t: 'request', id: 'r1' })
  await vi.advanceTimersByTimeAsync(25_000)
  expect(last().sent).toEqual(['{"t":"ping"}'])
})

it('reconnects with backoff and says it is open again, so the lists are fetched again', async () => {
  const { onOpen } = inbox()
  await vi.advanceTimersByTimeAsync(0)
  last().onopen!()
  last().onclose!({ code: 1006 })
  expect(FakeSocket.all).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(FakeSocket.all).toHaveLength(2)
  last().onopen!()
  expect(onOpen).toHaveBeenCalledTimes(2)
})

it('does not reconnect once the person is no longer a resident (4004: banned or hidden)', async () => {
  const a = inbox()
  await vi.advanceTimersByTimeAsync(0)
  last().onopen!()
  last().onclose!({ code: LIVE_CLOSE.banned })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(FakeSocket.all).toHaveLength(1)
  expect(a.onReplaced).not.toHaveBeenCalled()
})

it('does not reconnect after another tab took the inbox (4001), and not after close()', async () => {
  const a = inbox()
  await vi.advanceTimersByTimeAsync(0)
  last().onopen!()
  last().onclose!({ code: LIVE_CLOSE.replaced })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(FakeSocket.all).toHaveLength(1)
  expect(a.onReplaced).toHaveBeenCalledTimes(1)

  const b = inbox()
  await vi.advanceTimersByTimeAsync(0)
  b.conn.close()
  last().onclose!({ code: 1000 })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(FakeSocket.all).toHaveLength(2)
})
