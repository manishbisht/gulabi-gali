import { DurableObject } from 'cloudflare:workers'
import { resolveUser } from './auth'
import { allowedOrigin } from './cors'
import type { Env } from './env'
import { cleanText, loadResident, MAX_STATUS, toPublic } from './profiles'
import {
  LIVE_CLOSE,
  type ClientMsg,
  type DistrictId,
  type LivePerson,
  type PublicPerson,
  type ServerMsg,
} from './protocol'

export const DISTRICT_IDS: readonly DistrictId[] = ['walled-city', 'mi-road', 'university', 'malviya-nagar']

/**
 * Who a socket belongs to, as the Worker resolved it. The object trusts this header because only the Worker
 * can reach it; the Worker drops any copy a client sent before it does anything else.
 */
export const WHO_HEADER = 'X-GG-Who'
export interface Who {
  userId: string | null
  /** Set only for a resident: a complete profile whose owner is not banned. */
  person: PublicPerson | null
}

/** Moves are coalesced per person and sent out at most this often. */
export const MOVE_BATCH_MS = 100
/** A socket hears the moves of people within this many metres of its own last point. */
export const INTEREST_M = 60
/** The fastest anyone may go, in m/s, measured against the last accepted point. */
export const MAX_SPEED = 8
/**
 * How far ahead of that pace a burst may run: one second's worth. This is a deliberate tolerance for network
 * jitter: frames bunch up after a stall, and without it a walker arriving all at once would be pulled back.
 * The average still never beats `MAX_SPEED`; the most anyone gains is one 8 m hop after standing still.
 */
export const SPEED_BURST_M = MAX_SPEED
/** A socket with no move or ping for this long is closed, and its person leaves. */
export const IDLE_MS = 30_000
export const MAX_FRAME_CHARS = 2048
/** Bad frames in a row before the socket is closed. Any good frame clears the count. */
export const MAX_BAD_FRAMES = 5
/**
 * Per-socket allowances, as token buckets: a refill rate and how many may arrive at once. A client sends at
 * most 10 moves a second and a status now and then; `other` is pings, bench frames and bad frames.
 */
export const LANES = {
  move: { perSecond: 40, burst: 20 },
  status: { perSecond: 0.5, burst: 1 },
  other: { perSecond: 10, burst: 20 },
} as const
type Lane = keyof typeof LANES
/** Refusals further apart than this are separate floods; each new flood is told `rate` once. */
const FLOOD_GAP_MS = 1000
/** A flood that keeps on for this long closes the socket. */
export const MAX_FLOOD_MS = 3000
/** No district reaches half this far from its centre; anything past it is not a place. */
const MAX_COORD = 1000
const MAX_TURN = 2 * Math.PI
const MAX_BENCH_ID = 64
/** The exact ping a client sends, answered at the edge without waking a hibernating object. */
const PING = '{"t":"ping"}'
const PONG = '{"t":"pong"}'

const GHOST = { t: 'error', code: 'ghost' } as const
const INVALID = { t: 'error', code: 'invalid' } as const
const RATE = { t: 'error', code: 'rate' } as const

const notFound = () => Response.json({ error: 'not found' }, { status: 404 })

/**
 * `GET /api/districts/:id/live`, from the Worker: checks the district and the page, works out who is asking
 * and hands the upgrade to that district's object. CORS does not apply to a WebSocket, so a foreign page is
 * turned away by its Origin here; a request with none (tests, local tools) is let through.
 */
export async function openDistrict(request: Request, env: Env, id: string): Promise<Response> {
  if (!(DISTRICT_IDS as readonly string[]).includes(id)) return notFound()
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
    return Response.json({ error: 'expected websocket' }, { status: 426 })
  const origin = request.headers.get('Origin')
  if (origin !== null && !allowedOrigin(origin)) return Response.json({ error: 'forbidden' }, { status: 403 })
  const headers = new Headers(request.headers)
  headers.delete(WHO_HEADER)
  const user = await resolveUser(new Request(request.url, { headers }), env)
  // A database hiccup makes this visit a ghost one rather than no visit at all.
  const person = user ? await loadResident(env, user.id).catch(() => null) : null
  const who: Who = { userId: user?.id ?? null, person }
  // A fresh request: nothing of the client's (its token included) goes past this point but the upgrade.
  return env.DISTRICT.get(env.DISTRICT.idFromName(id)).fetch(`https://district.internal/${id}`, {
    headers: { Upgrade: 'websocket', [WHO_HEADER]: JSON.stringify(who) },
  })
}

const isNum = (n: unknown, max: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max

/** A frame from a client, or null when it is not one we know. Nothing past this point sees raw input. */
export function parseClientMsg(text: string): ClientMsg | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const m = parsed as Record<string, unknown>
  switch (m.t) {
    case 'move': {
      const { x, z, ry } = m
      return isNum(x, MAX_COORD) && isNum(z, MAX_COORD) && isNum(ry, MAX_TURN)
        ? { t: 'move', x, z, ry }
        : null
    }
    case 'sit': {
      const { bench } = m
      return bench === null || (typeof bench === 'string' && bench.length <= MAX_BENCH_ID)
        ? { t: 'sit', bench }
        : null
    }
    case 'say': {
      const { text } = m
      return typeof text === 'string' ? { t: 'say', text } : null
    }
    case 'status': {
      // Cleaned here, so a line that is too long is a bad frame like any other.
      const text = cleanText(m.text, MAX_STATUS)
      return typeof m.text === 'string' && text !== null ? { t: 'status', text } : null
    }
    case 'ping':
      return { t: 'ping' }
    default:
      return null
  }
}

function readWho(raw: string | null): Who {
  try {
    const who = JSON.parse(raw ?? '') as Partial<Who>
    const userId = typeof who.userId === 'string' ? who.userId : null
    const person = userId && who.person?.id === userId ? toPublic(who.person) : null
    return { userId, person }
  } catch {
    return { userId: null, person: null }
  }
}

/** The last accepted point, when it was accepted, and how many metres of burst are left (see `SPEED_BURST_M`). */
interface Point {
  x: number
  z: number
  ry: number
  at: number
  budget: number
}

interface Bucket {
  tokens: number
  at: number
}

/** What a socket carries through hibernation. */
interface Seat {
  userId: string | null
  person: PublicPerson | null
  /** Listed: a resident who has moved at least once on this socket (or the one it replaced). */
  shown: boolean
  /**
   * Done with: closed by either side, or replaced by a newer socket. workerd can still list a socket while it
   * closes, and across a wake from hibernation this flag is the only thing that says to ignore it.
   */
  closed?: boolean
  pos: Point | null
  /** Last move or ping the object itself handled. */
  seen: number
  /** Bad frames in a row. */
  bad: number
  lanes: Record<Lane, Bucket>
  /** The flood under way, if any: when it began and when the last frame was refused. */
  flood: { since: number; at: number } | null
}

const fullLanes = (now: number): Record<Lane, Bucket> => ({
  move: { tokens: LANES.move.burst, at: now },
  status: { tokens: LANES.status.burst, at: now },
  other: { tokens: LANES.other.burst, at: now },
})

/** Spends one token from `bucket`, refilled for the time since it was last touched. False when it is empty. */
function take(bucket: Bucket, lane: Lane, now: number): boolean {
  const { perSecond, burst } = LANES[lane]
  bucket.tokens = Math.min(burst, bucket.tokens + (perSecond * Math.max(0, now - bucket.at)) / 1000)
  bucket.at = now
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

const laneOf = (msg: ClientMsg | null): Lane =>
  msg?.t === 'move' ? 'move' : msg?.t === 'status' ? 'status' : 'other'

const round = (n: number, per: number) => Math.round(n * per) / per

function livePerson(seat: Seat): LivePerson {
  const { x, z, ry } = seat.pos!
  return { ...toPublic(seat.person!), x, z, ry }
}

/**
 * One district's live presence. Sockets hibernate: everything a socket needs survives in its attachment,
 * and the in-memory maps here are caches and batches that an evicted object can do without.
 *
 * Moves are batched with a `setTimeout`, armed by the first move after a quiet spell and never re-armed by
 * itself, so a district where nobody is moving has no timer and hibernates. An alarm would cost a storage
 * write ten times a second for the same effect. The alarm is kept for the idle sweep, which must run while
 * the object sleeps; it is set for the earliest moment any socket could go idle, and not at all once the
 * last socket has gone.
 */
export class DistrictDO extends DurableObject<Env> {
  /** Now, in ms. A test swaps it to step past `IDLE_MS` without waiting. */
  clock: () => number = Date.now
  private seats = new WeakMap<WebSocket, Seat>()
  private dirty = new Set<WebSocket>()
  private batch: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('expected websocket', { status: 426 })
    const who = readWho(request.headers.get(WHO_HEADER))
    const now = this.clock()
    // Newest socket wins: the old one closes, and the new one stands where it stood.
    let before: Seat | null = null
    if (who.userId) {
      for (const ws of this.sockets()) {
        const seat = this.seat(ws)
        if (seat.userId !== who.userId) continue
        before = seat
        this.dirty.delete(ws)
        this.write(ws, { ...seat, shown: false, closed: true })
        try {
          ws.close(LIVE_CLOSE.replaced, 'replaced')
        } catch {
          // Already closing.
        }
      }
    }
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    const seat: Seat = {
      userId: who.userId,
      person: who.person,
      shown: who.person !== null && before?.shown === true,
      pos: before?.pos ?? null,
      seen: now,
      bad: 0,
      lanes: fullLanes(now),
      flood: null,
    }
    this.write(server, seat)
    this.send(server, {
      t: 'welcome',
      you: { id: who.userId, visible: who.person !== null },
      people: this.people(who.userId),
    })
    if (seat.shown) this.broadcast({ t: 'join', p: livePerson(seat) }, server)
    else if (before?.shown) this.broadcast({ t: 'leave', id: who.userId! }, server)
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + IDLE_MS)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const seat = this.seat(ws)
    if (seat.closed) return
    // Measured before parsing, so an oversized frame costs nothing but this.
    const size = typeof raw === 'string' ? raw.length : raw.byteLength
    const text = size > MAX_FRAME_CHARS ? null : typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    const msg = text === null ? null : parseClientMsg(text)
    const now = this.clock()
    if (!this.allow(ws, seat, laneOf(msg), now)) return
    if (!msg) return this.refuse(ws, seat)
    if (seat.bad) {
      seat.bad = 0
      this.write(ws, seat)
    }
    switch (msg.t) {
      case 'ping':
        seat.seen = now
        this.write(ws, seat)
        return this.send(ws, { t: 'pong' })
      case 'move':
        return this.move(ws, seat, msg, now)
      case 'status':
        return seat.person ? this.status(ws, seat, msg.text) : this.send(ws, GHOST)
      case 'sit':
      case 'say':
        // Benches arrive with their own task; until then only a ghost hears why not.
        return this.send(ws, seat.person ? INVALID : GHOST)
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close(1000, 'bye')
    } catch {
      // Already answered.
    }
    this.depart(ws)
  }

  /**
   * Whether this frame fits the socket's allowance. A refused frame is dropped; the first refusal of a flood
   * says `rate`, and a flood that keeps on for `MAX_FLOOD_MS` closes the socket. Refusals touch memory only:
   * an object cannot hibernate mid-flood, and one that wakes simply starts the socket on full buckets.
   */
  private allow(ws: WebSocket, seat: Seat, lane: Lane, now: number): boolean {
    if (take(seat.lanes[lane], lane, now)) return true
    const flood = seat.flood
    if (!flood || now - flood.at > FLOOD_GAP_MS) {
      seat.flood = { since: now, at: now }
      this.send(ws, RATE)
    } else {
      flood.at = now
      if (now - flood.since >= MAX_FLOOD_MS) this.drop(ws, LIVE_CLOSE.invalid, 'flood')
    }
    return false
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.depart(ws)
  }

  async alarm(): Promise<void> {
    const now = this.clock()
    this.sweep(now)
    let next = Infinity
    for (const ws of this.sockets()) next = Math.min(next, this.lastHeard(ws) + IDLE_MS)
    if (next !== Infinity) await this.ctx.storage.setAlarm(Math.max(next, now + 1000))
  }

  /** Closes every socket not heard from for `IDLE_MS` as of `now`, and says they left. */
  sweep(now: number): void {
    for (const ws of this.sockets()) {
      if (now - this.lastHeard(ws) < IDLE_MS) continue
      this.drop(ws, LIVE_CLOSE.idle, 'idle')
    }
  }

  private lastHeard(ws: WebSocket): number {
    const auto = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0
    return Math.max(this.seat(ws).seen, auto)
  }

  private move(ws: WebSocket, seat: Seat, m: Extract<ClientMsg, { t: 'move' }>, now: number): void {
    seat.seen = now
    const x = round(m.x, 100)
    const z = round(m.z, 100)
    const ry = round(m.ry, 1000)
    const last = seat.pos
    if (last) {
      const budget = Math.min(SPEED_BURST_M, last.budget + (MAX_SPEED * Math.max(0, now - last.at)) / 1000)
      const step = Math.hypot(x - last.x, z - last.z)
      if (step > budget) {
        this.write(ws, seat)
        return this.send(ws, { t: 'error', code: 'too-fast', x: last.x, z: last.z, ry: last.ry })
      }
      seat.pos = { x, z, ry, at: now, budget: budget - step }
    } else seat.pos = { x, z, ry, at: now, budget: SPEED_BURST_M }
    const arriving = seat.person !== null && !seat.shown
    if (arriving) seat.shown = true
    this.write(ws, seat)
    if (arriving) this.broadcast({ t: 'join', p: livePerson(seat) }, ws)
    else if (seat.shown) {
      this.dirty.add(ws)
      this.batch ??= setTimeout(() => this.flush(), MOVE_BATCH_MS)
    }
  }

  /** `text` is already clean (see `parseClientMsg`). The same line again is a no-op, not a broadcast. */
  private status(ws: WebSocket, seat: Seat, text: string): void {
    if (text === seat.person!.status) return
    const userId = seat.userId!
    seat.person = { ...seat.person!, status: text }
    this.write(ws, seat)
    const msg = { t: 'status', id: userId, text } as const
    if (seat.shown) this.broadcast(msg)
    else this.send(ws, msg)
    this.ctx.waitUntil(
      this.env.DB.prepare('UPDATE profiles SET status = ?, updated_at = ? WHERE user_id = ?')
        .bind(text, Date.now(), userId)
        .run()
        .catch((err: unknown) => console.error('district: status write failed', err)),
    )
  }

  /** One `moves` frame per socket that has anyone moving near it. Each mover is serialised once. */
  private flush(): void {
    this.batch = null
    const movers: { id: string; x: number; z: number; json: string }[] = []
    for (const ws of this.dirty) {
      const { userId, shown, pos, closed } = this.seat(ws)
      if (closed || !shown || !pos || !userId) continue
      movers.push({ id: userId, x: pos.x, z: pos.z, json: JSON.stringify([userId, pos.x, pos.z, pos.ry]) })
    }
    this.dirty.clear()
    if (!movers.length) return
    const reach = INTEREST_M * INTEREST_M
    for (const ws of this.sockets()) {
      const { userId, pos } = this.seat(ws)
      // A socket that has never said where it is hears no moves; its welcome placed everyone.
      if (!pos) continue
      let list = ''
      for (const m of movers) {
        const dx = m.x - pos.x
        const dz = m.z - pos.z
        if (m.id === userId || dx * dx + dz * dz > reach) continue
        list += list ? `,${m.json}` : m.json
      }
      if (list) this.sendRaw(ws, `{"t":"moves","m":[${list}]}`)
    }
  }

  private refuse(ws: WebSocket, seat: Seat): void {
    seat.bad++
    this.write(ws, seat)
    this.send(ws, INVALID)
    if (seat.bad >= MAX_BAD_FRAMES) this.drop(ws, LIVE_CLOSE.invalid, 'invalid')
  }

  private drop(ws: WebSocket, code: number, reason: string): void {
    this.depart(ws)
    try {
      ws.close(code, reason)
    } catch {
      // Already closing.
    }
  }

  /**
   * A socket is done: forget its moves, mark it closed (in its attachment too, so a wake cannot bring it back)
   * and, if it was listed, tell everyone it left. Runs once per socket.
   */
  private depart(ws: WebSocket): void {
    const seat = this.seat(ws)
    if (seat.closed) return
    this.dirty.delete(ws)
    this.write(ws, { ...seat, shown: false, closed: true })
    if (seat.shown && seat.userId) this.broadcast({ t: 'leave', id: seat.userId })
  }

  /** Everyone listed, but `except` (the asker themself). */
  private people(except: string | null): LivePerson[] {
    const out: LivePerson[] = []
    for (const ws of this.sockets()) {
      const seat = this.seat(ws)
      if (seat.shown && seat.pos && seat.person && seat.userId !== except) out.push(livePerson(seat))
    }
    return out
  }

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => !this.seat(ws).closed)
  }

  private seat(ws: WebSocket): Seat {
    let seat = this.seats.get(ws)
    if (!seat) {
      seat = (ws.deserializeAttachment() as Seat | null) ?? {
        userId: null,
        person: null,
        shown: false,
        pos: null,
        seen: 0,
        bad: 0,
        lanes: fullLanes(0),
        flood: null,
      }
      this.seats.set(ws, seat)
    }
    return seat
  }

  private write(ws: WebSocket, seat: Seat): void {
    this.seats.set(ws, seat)
    try {
      ws.serializeAttachment(seat)
    } catch {
      // A socket that has finished closing keeps no attachment; it is no longer listed either.
    }
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    this.sendRaw(ws, JSON.stringify(msg))
  }

  private sendRaw(ws: WebSocket, text: string): void {
    try {
      ws.send(text)
    } catch {
      // Closing under us: its close handler will tidy up.
    }
  }

  /** Serialised once, whoever it goes to. */
  private broadcast(msg: ServerMsg, except?: WebSocket): void {
    const text = JSON.stringify(msg)
    for (const ws of this.sockets()) if (ws !== except) this.sendRaw(ws, text)
  }
}
