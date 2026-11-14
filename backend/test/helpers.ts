import { env, SELF } from 'cloudflare:test'
import { afterAll, expect, vi } from 'vitest'
import type { ClientMsg, DistrictId, InboxMsg, ServerMsg } from '../src/protocol'

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

/** Marks a dev user verified, as an admin would: they can then send requests. */
export const verify = (name: string) =>
  env.DB.prepare('UPDATE users SET verified = 1, verified_by = ? WHERE id = ?')
    .bind('admin', devId(name))
    .run()

/**
 * A dev user with a complete profile: someone the map shows. Verified unless `verified: false` (the tier that
 * can send requests, which most tests need).
 */
export async function resident(
  name: string,
  over: Record<string, unknown> = {},
  { verified = true }: { verified?: boolean } = {},
): Promise<string> {
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
  if (verified) await verify(name)
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

const open: { close: () => void }[] = []

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

/** How long a file's end waits for the districts to finish with the sockets its last test closed. */
const SETTLE_MS = 250

/**
 * A socket closed by the last test reaches its district, and that district's release reaches the gate, after
 * the test has finished; an object woken while the file's runtime shuts down is reported as an unhandled
 * error. So every file that uses these helpers waits a moment at its end.
 */
afterAll(async () => {
  closeAll()
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
})

export function openInbox(
  opts: { token?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const query = opts.token ? `?token=${encodeURIComponent(opts.token)}` : ''
  return SELF.fetch(`${API}/api/inbox${query}`, { headers: { Upgrade: 'websocket', ...opts.headers } })
}

export interface InboxClient {
  ws: WebSocket
  messages: InboxMsg[]
  closes: number[]
  /** The first message of type `t` that `match` accepts, once it arrives. */
  next: <T extends InboxMsg['t']>(
    t: T,
    match?: (m: Extract<InboxMsg, { t: T }>) => boolean,
  ) => Promise<Extract<InboxMsg, { t: T }>>
  close: () => void
}

/** A resident's open inbox socket. */
export async function inbox(token: string): Promise<InboxClient> {
  const res = await openInbox({ token })
  expect(res.status).toBe(101)
  const ws = res.webSocket!
  ws.accept()
  const messages: InboxMsg[] = []
  const closes: number[] = []
  ws.addEventListener('message', (event) => {
    messages.push(JSON.parse(event.data as string))
  })
  ws.addEventListener('close', (event) => {
    closes.push(event.code)
  })
  const client: InboxClient = {
    ws,
    messages,
    closes,
    next: (t, match = () => true) =>
      vi.waitFor(() => {
        const found = messages.find((m) => m.t === t && match(m as never))
        expect(found, `an inbox '${t}' message`).toBeDefined()
        return found as never
      }, WAIT),
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

/** A signed-in API call. */
export const api = (path: string, token: string, init: RequestInit = {}) =>
  SELF.fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })

/** The dev user id a `resident(name)` gets. */
export const devId = (name: string) => `dev:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

/** Two residents, matched: their tokens, their ids and the match id. */
export async function pair(x: string, y: string) {
  const a = await resident(x)
  const b = await resident(y)
  const sent = await api('/api/requests', a, {
    method: 'POST',
    body: JSON.stringify({ to: devId(y), reason: 'Mujhe bhi pencil sketching pasand hai' }),
  })
  expect(sent.status).toBe(201)
  const { id: rid } = (await sent.json()) as { id: string }
  const res = await api(`/api/requests/${rid}/accept`, b, { method: 'POST' })
  expect(res.status).toBe(200)
  const { matchId } = (await res.json()) as { matchId: string }
  return { a, b, aId: devId(x), bId: devId(y), matchId }
}
