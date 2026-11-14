import { DurableObject } from 'cloudflare:workers'
import { resolveUser } from './auth'
import { allowedOrigin } from './cors'
import { WHO_HEADER } from './district'
import type { Env } from './env'
import { activeRow } from './profiles'
import { LIVE_CLOSE, type InboxNotice } from './protocol'

/** Open inbox sockets one person may keep (tabs, a phone and a laptop). The next one closes the oldest. */
export const INBOX_SOCKETS = 5
/** A client sends nothing but pings: anything longer is garbage, unread. */
const MAX_FRAME_CHARS = 64
/** Bad frames in a row before the socket is closed. A ping clears the count. */
const MAX_BAD_FRAMES = 5
/** Each socket's allowance, as a token bucket. A client pings every few seconds at most; past this it is a flood. */
const LANE = { perSecond: 2, burst: 10 }
/** The exact ping a client sends, answered at the edge without waking a hibernating object. */
const PING = '{"t":"ping"}'
const PONG = '{"t":"pong"}'

/** Hands work that must outlive the response to the runtime (`ctx.waitUntil`). */
export type Later = (work: Promise<unknown>) => void
/** For callers with no execution context (tests, scripts): the work just runs. It never rejects (see `notify`). */
export const floating: Later = (work) => void work

export const inboxOf = (env: Env, userId: string) => env.INBOX.get(env.INBOX.idFromName(`inbox:${userId}`))

/**
 * Tells `userId`'s open inbox sockets about `n`, over RPC. It never throws or rejects: a notice is a nudge to
 * refetch, and the request that caused it has already succeeded, so a failure here is only logged.
 */
export async function notify(env: Env, userId: string, n: InboxNotice): Promise<void> {
  try {
    await inboxOf(env, userId).notify(n)
  } catch (err) {
    console.error('inbox: notify failed', err)
  }
}

/**
 * `GET /api/inbox`, from the Worker: residents only (anyone else, a missing token included, is 403 `ghost`).
 * As for a district, a foreign page is turned away by its Origin, and the object hears who is asking only from
 * the header the Worker sets here, on a fresh request that carries nothing else of the client's.
 */
export async function openInbox(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
    return Response.json({ error: 'expected websocket' }, { status: 426 })
  const origin = request.headers.get('Origin')
  if (origin !== null && !allowedOrigin(origin)) return Response.json({ error: 'forbidden' }, { status: 403 })
  const headers = new Headers(request.headers)
  headers.delete(WHO_HEADER)
  const user = await resolveUser(new Request(request.url, { headers }), env)
  if (!user || !(await activeRow(env, user.id))) return Response.json({ error: 'ghost' }, { status: 403 })
  return inboxOf(env, user.id).fetch('https://inbox.internal/', {
    headers: { Upgrade: 'websocket', [WHO_HEADER]: encodeURIComponent(user.id) },
  })
}

/** What a socket carries through hibernation. */
interface Tab {
  /** Opening order: strictly increasing within the object, so the oldest is never a tie. */
  opened: number
  /** Closed by either side or pushed out by a newer tab; ignored even while workerd still lists it. */
  closed?: boolean
  bad: number
  tokens: number
  at: number
}

/**
 * One person's inbox (`inbox:<userId>`): their open sockets, told about requests, matches and messages as they
 * happen. It keeps no storage. Sockets hibernate, everything a socket needs lives in its attachment, and a
 * notice to an object with no sockets is simply dropped: the client fetches lists when it opens.
 */
export class InboxDO extends DurableObject<Env> {
  private tabs = new WeakMap<WebSocket, Tab>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('expected websocket', { status: 426 })
    if (!request.headers.get(WHO_HEADER)) return Response.json({ error: 'ghost' }, { status: 403 })
    const now = Date.now()
    const open = this.sockets().sort((x, y) => this.tab(x).opened - this.tab(y).opened)
    const opened = Math.max(now, ...open.map((ws) => this.tab(ws).opened + 1))
    while (open.length >= INBOX_SOCKETS) this.drop(open.shift()!, LIVE_CLOSE.replaced, 'too many tabs')
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    this.write(server, { opened, bad: 0, tokens: LANE.burst, at: now })
    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * RPC, from `refreshUser`: someone who may no longer act as themself (banned, profile gone; see `ACTIVE`) has
   * no inbox, so every socket closes with `LIVE_CLOSE.banned`, which the client does not reconnect after. A
   * hidden person keeps theirs.
   */
  async refresh(userId: string): Promise<void> {
    if (await activeRow(this.env, userId)) return
    for (const ws of this.sockets()) this.drop(ws, LIVE_CLOSE.banned, 'not a resident')
  }

  /** RPC: sends `n` to every open socket, serialised once. Answers how many it went to. */
  notify(n: InboxNotice): number {
    const text = JSON.stringify(n)
    let sent = 0
    for (const ws of this.sockets()) {
      try {
        ws.send(text)
        sent++
      } catch {
        // Closing under us: its close handler will tidy up.
      }
    }
    return sent
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const tab = this.tab(ws)
    if (tab.closed) return
    const now = Date.now()
    tab.tokens = Math.min(LANE.burst, tab.tokens + (LANE.perSecond * Math.max(0, now - tab.at)) / 1000)
    tab.at = now
    if (tab.tokens < 1) return this.drop(ws, LIVE_CLOSE.invalid, 'flood')
    tab.tokens -= 1
    if (typeof raw === 'string' && raw.length <= MAX_FRAME_CHARS && isPing(raw)) {
      tab.bad = 0
      this.write(ws, tab)
      try {
        ws.send(PONG)
      } catch {
        // Closing under us.
      }
      return
    }
    tab.bad++
    this.write(ws, tab)
    if (tab.bad >= MAX_BAD_FRAMES) this.drop(ws, LIVE_CLOSE.invalid, 'invalid')
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.write(ws, { ...this.tab(ws), closed: true })
    try {
      ws.close(1000, 'bye')
    } catch {
      // Already answered.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.write(ws, { ...this.tab(ws), closed: true })
  }

  private drop(ws: WebSocket, code: number, reason: string): void {
    this.write(ws, { ...this.tab(ws), closed: true })
    try {
      ws.close(code, reason)
    } catch {
      // Already closing.
    }
  }

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => !this.tab(ws).closed)
  }

  private tab(ws: WebSocket): Tab {
    let tab = this.tabs.get(ws)
    if (!tab) {
      tab = (ws.deserializeAttachment() as Tab | null) ?? { opened: 0, bad: 0, tokens: LANE.burst, at: 0 }
      this.tabs.set(ws, tab)
    }
    return tab
  }

  private write(ws: WebSocket, tab: Tab): void {
    this.tabs.set(ws, tab)
    try {
      ws.serializeAttachment(tab)
    } catch {
      // A socket that has finished closing keeps no attachment; it is no longer listed either.
    }
  }
}

/** A ping in any spelling the edge did not catch (spaces, key order). */
function isPing(text: string): boolean {
  try {
    const m = JSON.parse(text) as unknown
    return typeof m === 'object' && m !== null && (m as { t?: unknown }).t === 'ping'
  } catch {
    return false
  }
}
