import { DurableObject } from 'cloudflare:workers'
import { resolveUser } from './auth'
import { allowedOrigin } from './cors'
import type { Env } from './env'
import benches from './benches.json'
import { cleanText, loadResident, MAX_STATUS, toPublic } from './profiles'
import {
  BENCH_SEATS,
  LIVE_CLOSE,
  MAX_BENCH_LINE,
  type BenchLine,
  type ClientMsg,
  type DistrictId,
  type LivePerson,
  type PublicPerson,
  type ServerMsg,
} from './protocol'

export const DISTRICT_IDS: readonly DistrictId[] = ['walled-city', 'mi-road', 'university', 'malviya-nagar']

/**
 * Every tapri and bench prop, by district: bench `${district}:${n}` is the n-th of them in the district's
 * `props`, standing at `BENCH_POSITIONS[district][n]`. The same file is copied to the frontend, whose
 * district defs are tested against it (scripts/check-protocol.mjs keeps the copies equal).
 */
export const BENCHES: Record<DistrictId, number> = benches.counts
export const BENCH_POSITIONS: Record<DistrictId, readonly { x: number; z: number }[]> = benches.positions
/**
 * A sitter must stand this close to the bench (by their last accepted point) to sit: a little more than the
 * client's 2.5 m, for the moves still on their way.
 */
export const SIT_RANGE_M = 3
/** Walking further than this from the bench stands a sitter up: the client's own reach. */
export const STAY_RANGE_M = 2.5
/** Each bench remembers what was said there for this long, and at most this many lines. */
export const TRANSCRIPT_MS = 10 * 60_000
export const TRANSCRIPT_LINES = 200

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
 * Per-socket allowances, as token buckets: a refill rate and how many may arrive at once. A resident's client
 * sends at most 10 moves a second (a ghost's 2), so `move` leaves a little room for jitter and no more;
 * `status` is the socket's own status line, which the web client does not use (see `status`); `other` is
 * pings, bench frames and bad frames.
 */
export const LANES = {
  move: { perSecond: 12, burst: 15 },
  status: { perSecond: 0.5, burst: 1 },
  /** Bench lines: one a second. */
  say: { perSecond: 1, burst: 1 },
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
/**
 * A moving socket's point is written to its attachment at most this often; the newest one is always written
 * within this long, and a seat change or a close writes at once. A wake from hibernation can lose at most
 * this much of a walk, and the speed check measures on from the older point, with the time since.
 */
export const SAVE_MS = 1000

const GHOST = { t: 'error', code: 'ghost' } as const
const INVALID = { t: 'error', code: 'invalid' } as const
const RATE = { t: 'error', code: 'rate' } as const
const FULL = { t: 'error', code: 'full' } as const
const FAR = { t: 'error', code: 'far' } as const
const STOOD: ServerMsg = { t: 'seated', bench: null, seat: null, with: [] }

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
    headers: { Upgrade: 'websocket', [WHO_HEADER]: whoHeader(who) },
  })
}

/**
 * `who` as an `X-GG-Who` value: JSON, percent-encoded, so a Devanagari or emoji name travels as plain ASCII
 * (header values are bytes, and only workerd's leniency carries UTF-8 in them).
 */
export const whoHeader = (who: Who): string => encodeURIComponent(JSON.stringify(who))

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
      // One line: newlines become spaces before the clean. Empty or too long is a bad frame.
      const text =
        typeof m.text === 'string' ? cleanText(m.text.replace(/[\r\n]+/g, ' '), MAX_BENCH_LINE) : null
      return text ? { t: 'say', text } : null
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

/** The `X-GG-Who` the Worker set (see `whoHeader`); anything else is a ghost. */
export function readWho(raw: string | null): Who {
  try {
    const who = JSON.parse(decodeURIComponent(raw ?? '')) as Partial<Who>
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
  /** The district this object is: the socket's own copy, since a woken object is told nothing else. */
  district: DistrictId
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
  /** The bench this person sits at, and which of its seats. Kept here, so it survives hibernation. */
  bench: { id: string; seat: number } | null
}

const fullLanes = (now: number): Record<Lane, Bucket> => ({
  move: { tokens: LANES.move.burst, at: now },
  status: { tokens: LANES.status.burst, at: now },
  say: { tokens: LANES.say.burst, at: now },
  other: { tokens: LANES.other.burst, at: now },
})

/** Spends one token from the lane's bucket, refilled for the time since it was last touched. False when empty. */
function take(lanes: Record<Lane, Bucket>, lane: Lane, now: number): boolean {
  const { perSecond, burst } = LANES[lane]
  // A socket from before a lane existed starts that lane full.
  const bucket = (lanes[lane] ??= { tokens: burst, at: now })
  bucket.tokens = Math.min(burst, bucket.tokens + (perSecond * Math.max(0, now - bucket.at)) / 1000)
  bucket.at = now
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

const laneOf = (msg: ClientMsg | null): Lane =>
  msg?.t === 'move' || msg?.t === 'status' || msg?.t === 'say' ? msg.t : 'other'

/** Where bench `id` stands, when it is one of `district`'s; null for anything else. */
function benchAt(district: DistrictId, id: string): { x: number; z: number } | null {
  const n = id.startsWith(`${district}:`) ? id.slice(district.length + 1) : ''
  if (!/^(0|[1-9]\d{0,2})$/.test(n)) return null
  return BENCH_POSITIONS[district][Number(n)] ?? null
}

const far = (p: { x: number; z: number }, b: { x: number; z: number }, range: number) =>
  Math.hypot(p.x - b.x, p.z - b.z) > range

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
 *
 * Benches: who sits where lives in each socket's attachment, so it survives hibernation like the rest. What
 * is said there lives only in `transcripts`, in memory, and is never written to storage: an object that
 * hibernates forgets it. That is the design (bench chat is ephemeral), and a bench where people are talking
 * keeps its object awake anyway.
 */
export class DistrictDO extends DurableObject<Env> {
  /** Now, in ms. A test swaps it to step past `IDLE_MS` without waiting. */
  clock: () => number = Date.now
  private seats = new WeakMap<WebSocket, Seat>()
  private dirty = new Set<WebSocket>()
  private batch: ReturnType<typeof setTimeout> | null = null
  /** When each socket's point was last written to its attachment, and the sockets whose newest one waits. */
  private savedAt = new WeakMap<WebSocket, number>()
  private unsaved = new Set<WebSocket>()
  private saving: ReturnType<typeof setTimeout> | null = null
  /** Each bench's recent lines, oldest first (see `benchTranscript`). Memory only. */
  private transcripts = new Map<string, BenchLine[]>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('expected websocket', { status: 426 })
    const district = new URL(request.url).pathname.slice(1) as DistrictId
    if (!DISTRICT_IDS.includes(district)) return notFound()
    const who = readWho(request.headers.get(WHO_HEADER))
    const now = this.clock()
    // Newest socket wins: the old one closes, and the new one stands where it stood.
    let before: Seat | null = null
    if (who.userId) {
      for (const ws of this.sockets()) {
        const seat = this.seat(ws)
        if (seat.userId !== who.userId) continue
        before = seat
        this.retire(ws)
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
      district,
      userId: who.userId,
      person: who.person,
      shown: who.person !== null && before?.shown === true,
      pos: before?.pos ?? null,
      seen: now,
      bad: 0,
      lanes: fullLanes(now),
      flood: null,
      bench: null,
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
        return seat.person ? this.sit(ws, seat, msg.bench) : this.send(ws, GHOST)
      case 'say':
        return seat.person ? this.say(ws, seat, msg.text, now) : this.send(ws, GHOST)
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
    if (take(seat.lanes, lane, now)) return true
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
        this.keep(ws, seat, now)
        return this.send(ws, { t: 'error', code: 'too-fast', x: last.x, z: last.z, ry: last.ry })
      }
      seat.pos = { x, z, ry, at: now, budget: budget - step }
    } else seat.pos = { x, z, ry, at: now, budget: SPEED_BURST_M }
    const arriving = seat.person !== null && !seat.shown
    if (arriving) seat.shown = true
    const bench = seat.bench
    if (bench && far(seat.pos, benchAt(seat.district, bench.id)!, STAY_RANGE_M)) {
      // Walked off: stood up, and the bench told.
      seat.bench = null
      this.write(ws, seat)
      this.send(ws, STOOD)
      this.tellBench(bench.id)
    } else if (arriving) this.write(ws, seat)
    else this.keep(ws, seat, now)
    if (arriving) this.broadcast({ t: 'join', p: livePerson(seat) }, ws)
    else if (seat.shown) {
      this.dirty.add(ws)
      this.batch ??= setTimeout(() => this.flush(), MOVE_BATCH_MS)
    }
  }

  /**
   * A moving socket's seat, written through now if its point has not been for `SAVE_MS`; otherwise it is held
   * in memory and written by one timer for every such socket, so the newest point still lands within
   * `SAVE_MS`.
   */
  private keep(ws: WebSocket, seat: Seat, now: number): void {
    const saved = this.savedAt.get(ws)
    if (saved === undefined || now - saved >= SAVE_MS) return this.write(ws, seat)
    this.unsaved.add(ws)
    this.saving ??= setTimeout(() => this.save(), SAVE_MS)
  }

  private save(): void {
    this.saving = null
    for (const ws of this.unsaved) {
      const seat = this.seat(ws)
      if (!seat.closed) this.write(ws, seat)
    }
    this.unsaved.clear()
  }

  /**
   * `text` is already clean (see `parseClientMsg`). The same line again is a no-op, not a broadcast. The web
   * client never sends it: a status is set by saving the profile, after which the client reconnects and the
   * new socket carries the new line (see `fetch`). It is kept as a working part of the protocol, and its
   * tight lane is what the rate tests lean on.
   */
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

  /**
   * Sits at `id` (leaving any other bench), or stands up for null. Answered with `seated` either way; a
   * bench that is not this district's is `invalid`, one too far from the last accepted point `far`, and
   * one with every seat taken `full` (and the sitter stays where they were).
   */
  private sit(ws: WebSocket, seat: Seat, id: string | null): void {
    const was = seat.bench
    if (id === null) {
      seat.bench = null
      this.write(ws, seat)
      this.send(ws, STOOD)
      if (was) this.tellBench(was.id)
      return
    }
    const at = benchAt(seat.district, id)
    if (!at) return this.send(ws, INVALID)
    if (was?.id === id) return this.tellBench(id, ws)
    if (!seat.pos || far(seat.pos, at, SIT_RANGE_M)) return this.send(ws, FAR)
    const taken = this.sitters(id).map((s) => s.seat.bench!.seat)
    if (taken.length >= BENCH_SEATS) return this.send(ws, FULL)
    let free = 0
    while (taken.includes(free)) free++
    seat.bench = { id, seat: free }
    this.write(ws, seat)
    if (was) this.tellBench(was.id)
    this.tellBench(id)
  }

  /** A seated resident's line, to everyone on that bench (the speaker too), and into its transcript. */
  private say(ws: WebSocket, seat: Seat, text: string, now: number): void {
    const bench = seat.bench
    if (!bench) return this.send(ws, INVALID)
    const line: BenchLine = { from: seat.userId!, name: seat.person!.name, text, at: now }
    const lines = this.transcript(bench.id, now)
    lines.push(line)
    if (lines.length > TRANSCRIPT_LINES) lines.splice(0, lines.length - TRANSCRIPT_LINES)
    this.transcripts.set(bench.id, lines)
    const out = JSON.stringify({ t: 'bench', bench: bench.id, ...line } satisfies ServerMsg)
    for (const s of this.sitters(bench.id)) this.sendRaw(s.ws, out)
  }

  /**
   * What was said at `bench` in the last `TRANSCRIPT_MS`, oldest first, at most `TRANSCRIPT_LINES`: for phase
   * 3's reports, over RPC. Empty after the object has hibernated (see the class note).
   */
  benchTranscript(bench: string): BenchLine[] {
    return [...this.transcript(bench, this.clock())]
  }

  /** The bench's live list, with lines older than `TRANSCRIPT_MS` dropped. */
  private transcript(bench: string, now: number): BenchLine[] {
    const lines = this.transcripts.get(bench) ?? []
    const keep = lines.findIndex((l) => now - l.at <= TRANSCRIPT_MS)
    if (keep !== 0) lines.splice(0, keep === -1 ? lines.length : keep)
    if (lines.length) this.transcripts.set(bench, lines)
    else this.transcripts.delete(bench)
    return lines
  }

  /** Who sits at `bench`, by seat. */
  private sitters(bench: string): { ws: WebSocket; seat: Seat }[] {
    const out: { ws: WebSocket; seat: Seat }[] = []
    for (const ws of this.sockets()) {
      const seat = this.seat(ws)
      if (seat.bench?.id === bench) out.push({ ws, seat })
    }
    return out.sort((a, b) => a.seat.bench!.seat - b.seat.bench!.seat)
  }

  /** Tells everyone at `bench` (or just `only`) where they sit and who with. */
  private tellBench(bench: string, only?: WebSocket): void {
    const all = this.sitters(bench)
    for (const { ws, seat } of all)
      if (!only || ws === only)
        this.send(ws, {
          t: 'seated',
          bench,
          seat: seat.bench!.seat,
          with: all.filter((s) => s.ws !== ws).map((s) => s.seat.person!.name),
        })
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
   * A socket is done: forget its moves, mark it closed (in its attachment too, so a wake cannot bring it back),
   * stand it up from its bench and, if it was listed, tell everyone it left. Runs once per socket.
   */
  private depart(ws: WebSocket): void {
    const seat = this.seat(ws)
    if (seat.closed) return
    this.retire(ws)
    if (seat.shown && seat.userId) this.broadcast({ t: 'leave', id: seat.userId })
  }

  /** Marks a socket closed and unlisted, and tells its bench (if any) that it got up. */
  private retire(ws: WebSocket): void {
    const seat = this.seat(ws)
    this.dirty.delete(ws)
    this.write(ws, { ...seat, shown: false, closed: true, bench: null })
    if (seat.bench) this.tellBench(seat.bench.id)
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
        district: 'walled-city',
        userId: null,
        person: null,
        shown: false,
        pos: null,
        seen: 0,
        bad: 0,
        lanes: fullLanes(0),
        flood: null,
        bench: null,
      }
      this.seats.set(ws, seat)
    }
    return seat
  }

  private write(ws: WebSocket, seat: Seat): void {
    this.seats.set(ws, seat)
    this.unsaved.delete(ws)
    if (seat.pos) this.savedAt.set(ws, this.clock())
    try {
      ws.serializeAttachment(seat)
    } catch (err) {
      // A socket that is closing or closed keeps no attachment, and is no longer listed: nothing is lost. On
      // an open socket, a failed write means a wake would bring back an older seat.
      if (ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED)
        console.error('district: attachment write failed', err)
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
