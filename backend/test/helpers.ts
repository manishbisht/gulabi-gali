import { SELF } from 'cloudflare:test'
import { expect, vi } from 'vitest'
import type { ClientMsg, DistrictId, ServerMsg } from '../src/protocol'

/** Long enough for a 100 ms move batch under a busy suite, short enough to fail fast. */
export const WAIT = { timeout: 5_000, interval: 20 }

const API = 'https://api.test'

export async function login(name: string): Promise<string> {
  const res = await SELF.fetch(`${API}/api/dev/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { token: string }).token
}

/** A dev user with a complete profile: someone the map shows. */
export async function resident(name: string, over: Record<string, unknown> = {}): Promise<string> {
  const token = await login(name)
  const res = await SELF.fetch(`${API}/api/me/profile`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name,
      look: { skin: 1, outfit: 'pink', head: 'none' },
      status: 'chai pe',
      homeArea: 'Raja Park',
      hereFor: 'friends',
      about: 'Private: only for a signed-in viewer.',
      adult: true,
      pledge: true,
      ...over,
    }),
  })
  expect(res.status).toBe(200)
  return token
}

export function openLive(
  district: string,
  opts: { token?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const query = opts.token ? `?token=${encodeURIComponent(opts.token)}` : ''
  return SELF.fetch(`${API}/api/districts/${district}/live${query}`, {
    headers: { Upgrade: 'websocket', ...opts.headers },
  })
}

type Of<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>

export interface LiveClient {
  ws: WebSocket
  messages: ServerMsg[]
  closes: number[]
  send: (message: ClientMsg) => void
  /** Sends text as-is, for frames a well-behaved client would never send. */
  raw: (text: string) => void
  /** Where the log stands now: pass it to `next` to ask only about what arrives after. */
  mark: () => number
  /** The first message of type `t` (from `from` on) that `match` accepts, once it arrives. */
  next: <T extends ServerMsg['t']>(t: T, match?: (m: Of<T>) => boolean, from?: number) => Promise<Of<T>>
  all: <T extends ServerMsg['t']>(t: T, from?: number) => Of<T>[]
  /** Answers once a ping has made the round trip, so everything sent before it has been handled. */
  sync: () => Promise<void>
  close: () => void
}

const open: LiveClient[] = []

export async function live(district: DistrictId, opts: { token?: string } = {}): Promise<LiveClient> {
  const res = await openLive(district, opts)
  expect(res.status).toBe(101)
  const ws = res.webSocket!
  ws.accept()
  const messages: ServerMsg[] = []
  const closes: number[] = []
  ws.addEventListener('message', (event) => {
    messages.push(JSON.parse(event.data as string))
  })
  ws.addEventListener('close', (event) => {
    closes.push(event.code)
  })
  const all = <T extends ServerMsg['t']>(t: T, from = 0) =>
    messages.slice(from).filter((m): m is Of<T> => m.t === t)
  const client: LiveClient = {
    ws,
    messages,
    closes,
    send: (message) => ws.send(JSON.stringify(message)),
    raw: (text) => ws.send(text),
    mark: () => messages.length,
    all,
    next: (t, match = () => true, from = 0) =>
      vi.waitFor(() => {
        const found = all(t, from).find(match)
        expect(found, `a '${t}' message`).toBeDefined()
        return found!
      }, WAIT),
    sync: async () => {
      const from = messages.length
      // Not the exact auto-response text, so this one is answered by the object itself, in order.
      ws.send('{ "t": "ping" }')
      await client.next('pong', undefined, from)
    },
    close: () => {
      try {
        ws.close(1000, 'done')
      } catch {
        // Already closed.
      }
    },
  }
  open.push(client)
  return client
}

/** Closes every socket a test opened. */
export function closeAll(): void {
  for (const client of open.splice(0)) client.close()
}
