import { DurableObject } from 'cloudflare:workers'
import { resolveUser } from './auth'
import { allowedOrigin } from './cors'
import type { Env } from './env'
import benches from './benches.json'
import { wordsOk } from './filter/server'
import { cleanText, loadResident, MAX_STATUS, toPublic } from './profiles'
import type { RefreshWhy } from './refresh'
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
  /** Set only for a resident others may see (see `VISIBLE`): complete, neither banned nor hidden. */
  person: PublicPerson | null
  /** The address the socket came from (`CF-Connecting-IP`), for the per-address cap; null when unknown. */
  ip: string | null
}

/** A district holds at most this many sockets, ghosts and residents alike, unless `MAX_DISTRICT_SOCKETS` says. */
export const DEFAULT_MAX_SOCKETS = 400
/**
 * And at most this many from one address, unless `MAX_IP_SOCKETS` says: generous, since Indian mobile carriers
 * put many people behind one IPv4 address (CGNAT). IPv6 addresses count by their /64, the block one subscriber
 * gets. Loopback (local dev, the stress script) is exempt.
 */
export const DEFAULT_MAX_IP_SOCKETS = 24
/** After D1 fails to give the trust state, it is not asked again for this long (frames meanwhile are dropped). */
export const TRUST_RETRY_MS = 3_000
/** The alarm reloads every connected person's trust state at most this often: the backstop for a lost refresh. */
export const TRUST_SWEEP_MS = 60_000
/**
 * While any bench remembers a line, a timer this often keeps the object out of hibernation (which would forget
 * the lines): never longer than `TRANSCRIPT_MS` after the last one. Hibernation needs ~10 s with no pending
 * timer, so this stays under that.
 */
export const AWAKE_MS = 5_000

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
const MUTED = { t: 'error', code: 'muted' } as const
/** Not a bad frame, so never a strike: the line was fine to send, just not fit to show. */
const WORDS = { t: 'error', code: 'words' } as const
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
  const who: Who = { userId: user?.id ?? null, person, ip: request.headers.get('CF-Connecting-IP') }
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
    const ip = typeof who.ip === 'string' && who.ip.length <= 64 ? who.ip : null
    return { userId, person, ip }
  } catch {
    return { userId: null, person: null, ip: null }
  }
}

const isLoopback = (ip: string) => ip === '::1' || ip.startsWith('127.') || ip === '::ffff:127.0.0.1'

/**
 * What an address counts as for the per-address cap: an IPv4 address as itself, an IPv6 one as its /64 (written
 * out, so every spelling of it is the same key).
 */
export function ipKey(ip: string): string {
  const a = ip.toLowerCase().split('%')[0]!
  if (!a.includes(':')) return a
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return mapped[1]!
  const [head, tail] = a.split('::') as [string, string | undefined]
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups =
    tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/64`
}

/**
 * What a district keeps in memory about a connected person, loaded from D1 (see `loadTrust`): whether they are
 * banned, until when they are muted, and everyone on either side of a block with them. Never in a socket's
 * attachment, which has a size cap that a long block list would break.
 */
export interface Trust {
  banned: boolean
  hidden: boolean
  mutedUntil: number | null
  /** Ids blocked by, or blocking, this person: they never see each other. */
  blocked: Set<string>
  /** Of those, the ones this person blocked, and the ones who blocked them: who is stood up from a shared bench. Own load only. */
  blocking: Set<string>
  blockedBy: Set<string>
}

const noTrust = (): Trust => ({
  banned: false,
  hidden: false,
  mutedUntil: null,
  blocked: new Set(),
  blocking: new Set(),
  blockedBy: new Set(),
})

/** `ids`' trust state from D1, in one round trip. Someone with no row has none. */
export async function loadTrust(env: Env, ids: readonly string[]): Promise<Map<string, Trust>> {
  const out = new Map<string, Trust>()
  if (!ids.length) return out
  for (const id of ids) out.set(id, noTrust())
  const list = JSON.stringify(ids)
  const [users, blocks] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, banned, hidden, muted_until FROM users WHERE id IN (SELECT value FROM json_each(?1))',
    ).bind(list),
    env.DB.prepare(
      `SELECT a, b FROM blocks WHERE a IN (SELECT value FROM json_each(?1))
       UNION SELECT a, b FROM blocks WHERE b IN (SELECT value FROM json_each(?1))`,
    ).bind(list),
  ])
  for (const u of users.results as {
    id: string
    banned: number
    hidden: number
    muted_until: number | null
  }[]) {
    const t = out.get(u.id)!
    t.banned = u.banned === 1
    t.hidden = u.hidden === 1
    t.mutedUntil = u.muted_until
  }
  for (const { a, b } of blocks.results as { a: string; b: string }[]) {
    out.get(a)?.blocked.add(b)
    out.get(a)?.blocking.add(b)
    out.get(b)?.blocked.add(a)
    out.get(b)?.blockedBy.add(a)
  }
  return out
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
  /** Where the socket came from, for the per-address cap (see `Who`). */
  ip?: string | null
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

/** The district bench `id` belongs to (whose object keeps its transcript), or null for anything not a bench. */
export function benchDistrict(id: string): DistrictId | null {
  if (id.length > MAX_BENCH_ID) return null
  return DISTRICT_IDS.find((d) => benchAt(d, id) !== null) ?? null
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
 * is said there lives only in `transcripts`, in memory, and is never written to storage: bench chat is
 * ephemeral. Since a report of a bench carries its last 10 minutes, a bench with any line still in its
 * transcript keeps the object awake with a self-renewing timer (`stayAwake`), which lets go 10 minutes after
 * the last line; `sat` remembers who sat where for as long, so someone who only listened can still report. A
 * deploy, or the runtime evicting the object anyway, still loses both: that is accepted.
 *
 * Trust (blocks, mutes): each connected person's, in `trust`, loaded from D1 when they connect and again when
 * `refresh` says it changed. Memory only, never in an attachment (a long block list would break its size
 * cap): after a wake the first frame, or the alarm, loads it for everyone still connected before anything is
 * relayed (`ready`). Two people blocked either way never hear of each other: no join, leave, move, status or
 * bench line about one reaches the other.
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
  /** Per bench, who sat there and when they last got up (or sat down), for `TRANSCRIPT_MS`. Memory only. */
  private sat = new Map<string, Map<string, number>>()
  /** Set while a bench remembers a line (see `stayAwake`). */
  private awake: ReturnType<typeof setTimeout> | null = null
  /** Each connected person's trust state, by user id (see the class note). */
  private trust = new Map<string, Trust>()
  /** Per person, the newest `refresh` asked for (see there). */
  private refreshSeq = new Map<string, number>()
  /** Whether `trust` holds everyone connected since this instance started; `warming` while it loads. */
  private warm = false
  private warming: Promise<boolean> | null = null
  /** When D1 last failed to give trust state: none is asked for until `TRUST_RETRY_MS` after (see `load`). */
  private trustFailedAt = -Infinity
  /** When the alarm last reloaded everyone's trust state (see `alarm`). */
  private trustSweptAt = -Infinity

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
    // Full is full before anything is asked of D1: a turned-away connect costs nothing, even in an outage.
    if (this.crowded(who)) return this.turnAway(who.userId)
    // Blocks and mutes, theirs and everyone's already here, before anyone is told of anyone.
    if (!(await this.ready()) || (who.userId && !(await this.load([who.userId]))))
      return new Response('try again', { status: 503 })
    // Others may have come in while D1 answered.
    if (this.crowded(who)) return this.turnAway(who.userId)
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
      ip: who.ip === null ? null : ipKey(who.ip),
    }
    this.write(server, seat)
    this.send(server, {
      t: 'welcome',
      you: { id: who.userId, visible: who.person !== null },
      people: this.people(who.userId),
    })
    if (seat.shown) this.broadcast({ t: 'join', p: livePerson(seat) }, who.userId, server)
    else if (before?.shown) this.broadcast({ t: 'leave', id: who.userId! }, who.userId, server)
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + IDLE_MS)
    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Whether a new socket for `who` would be one too many: for the district (`MAX_DISTRICT_SOCKETS`), or for
   * its address (`MAX_IP_SOCKETS`, by `ipKey`). A person's own socket, which the new one replaces, does not count.
   */
  private crowded(who: Who): boolean {
    const max = Number(this.env.MAX_DISTRICT_SOCKETS) || DEFAULT_MAX_SOCKETS
    let all = 0
    let fromIp = 0
    const maxIp = Number(this.env.MAX_IP_SOCKETS) || DEFAULT_MAX_IP_SOCKETS
    const key = who.ip !== null && !isLoopback(who.ip) ? ipKey(who.ip) : null
    for (const ws of this.sockets()) {
      const seat = this.seat(ws)
      if (who.userId && seat.userId === who.userId) continue
      all++
      if (key !== null && seat.ip === key) fromIp++
    }
    return all >= max || fromIp >= maxIp
  }

  /**
   * Answers the upgrade, says `full` and closes with `LIVE_CLOSE.full`. Not a hibernatable socket: it is never
   * listed, and it is gone at once.
   */
  private turnAway(userId: string | null): Response {
    if (userId && !this.sockets().some((ws) => this.seat(ws).userId === userId)) this.trust.delete(userId)
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    server.accept()
    server.send(JSON.stringify(FULL))
    server.close(LIVE_CLOSE.full, 'full')
    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * True once `trust` holds everyone connected; after a wake, it loads them first (one D1 round trip, shared
   * by whatever arrives meanwhile). False when D1 could not be reached, or failed less than `TRUST_RETRY_MS`
   * ago: the caller must not relay anything.
   */
  private ready(): Promise<boolean> {
    if (this.warm) return Promise.resolve(true)
    const ids = new Set<string>()
    for (const ws of this.sockets()) {
      const { userId } = this.seat(ws)
      if (userId) ids.add(userId)
    }
    this.warming ??= this.load([...ids]).then((ok) => {
      this.warm = ok
      this.warming = null
      // Everyone was just loaded: the alarm's backstop need not do it again for a while.
      if (ok) this.trustSweptAt = this.clock()
      return ok
    })
    return this.warming
  }

  /**
   * Loads `ids`' trust state into memory. False when D1 could not be reached (logged), and, without asking it,
   * for `TRUST_RETRY_MS` after that: in an outage, a busy district's frames and connects would otherwise each
   * ask again.
   */
  private async load(ids: string[]): Promise<boolean> {
    if (!ids.length) return true
    if (this.clock() - this.trustFailedAt < TRUST_RETRY_MS) return false
    try {
      const got = await loadTrust(this.env, ids)
      for (const [id, t] of got) this.setTrust(id, t, true)
      return true
    } catch (err) {
      this.trustFailedAt = this.clock()
      console.error('district: trust load failed', err)
      return false
    }
  }

  /**
   * Records `id`'s trust state and keeps everyone else's in step with its blocks (a block is one row, but
   * each side's set names the other). `keep` false updates the others only: for someone not connected here.
   */
  private setTrust(id: string, t: Trust, keep: boolean): void {
    if (keep) this.trust.set(id, t)
    for (const [other, theirs] of this.trust) {
      if (other === id) continue
      if (t.blocked.has(other)) theirs.blocked.add(id)
      else theirs.blocked.delete(id)
    }
  }

  /** Whether `a` and `b` are kept apart by a block, either way. */
  private apart(a: string | null, b: string | null): boolean {
    if (!a || !b || a === b) return false
    return this.trust.get(a)?.blocked.has(b) === true || this.trust.get(b)?.blocked.has(a) === true
  }

  private muted(userId: string | null, now: number): boolean {
    const until = userId ? this.trust.get(userId)?.mutedUntil : null
    return until !== null && until !== undefined && until > now
  }

  /**
   * RPC, from `refreshUser`: `userId`'s state changed in D1. Reloads it (ban, hide, mute, blocks, public face)
   * and acts on it here at once (see `apply`). Nothing to do, and no D1 asked, when they have no socket here:
   * their state loads when they connect. Throws when D1 cannot be reached, so the caller can retry.
   */
  async refresh(userId: string, why: RefreshWhy): Promise<void> {
    if (!this.sockets().some((ws) => this.seat(ws).userId === userId)) return
    if (!(await this.ready())) throw new Error('district: trust state unavailable')
    // Loads can finish out of order: only the newest one asked for may be applied.
    const seq = (this.refreshSeq.get(userId) ?? 0) + 1
    this.refreshSeq.set(userId, seq)
    const [got, person] = await Promise.all([loadTrust(this.env, [userId]), loadResident(this.env, userId)])
    if (this.refreshSeq.get(userId) !== seq) return
    this.apply(userId, got.get(userId) ?? noTrust(), person, why)
  }

  /**
   * Acts on `userId`'s fresh trust state `t`: a ban closes their sockets with `LIVE_CLOSE.banned`; blocks made
   * or lifted take people out of, or put them back into, each other's view; a mute is simply kept (see
   * `muted`). With their public face (`person`, null when others may no longer see them): someone hidden is
   * taken off the map and told they are a ghost, someone visible again is told so (their next move lists them),
   * and a changed face (or `why` = `profile`) goes out as a `join`. Without it (`undefined`, from the alarm's
   * backstop) a hide still makes them a ghost, and nothing else about their face changes.
   */
  private apply(
    userId: string,
    t: Trust,
    person: PublicPerson | null | undefined,
    why: RefreshWhy | null,
  ): void {
    const mine = this.sockets().filter((ws) => this.seat(ws).userId === userId)
    const before = this.trust.get(userId)?.blocked ?? new Set<string>()
    this.setTrust(userId, t, mine.length > 0)
    if (!mine.length) return
    if (t.banned) {
      for (const ws of mine) this.drop(ws, LIVE_CLOSE.banned, 'banned')
      return
    }
    this.reblock(userId, mine, before, t)
    const face = t.hidden ? null : person
    if (face !== undefined) for (const ws of mine) this.reface(ws, face, why)
  }

  /**
   * The backstop for a refresh that never arrived (`refreshUser` retries once, then gives up): reloads everyone
   * connected and applies what changed, so a missed ban, hide, mute or block takes hold within
   * `TRUST_SWEEP_MS` or so. Run by the alarm, which comes round at least every `IDLE_MS` while anyone is here.
   */
  private async resweep(now: number): Promise<void> {
    this.trustSweptAt = now
    const ids = new Set<string>()
    for (const ws of this.sockets()) {
      const { userId } = this.seat(ws)
      if (userId) ids.add(userId)
    }
    if (!ids.size || now - this.trustFailedAt < TRUST_RETRY_MS) return
    let got: Map<string, Trust>
    try {
      got = await loadTrust(this.env, [...ids])
    } catch (err) {
      this.trustFailedAt = this.clock()
      console.error('district: trust sweep failed', err)
      return
    }
    for (const id of ids) this.apply(id, got.get(id) ?? noTrust(), undefined, null)
  }

  /** Stands `ws` up from its bench, because someone sitting there blocked them: `seated null`, no reason given. */
  private unseat(ws: WebSocket, seat: Seat): void {
    const was = seat.bench
    if (!was) return
    seat.bench = null
    this.write(ws, seat)
    this.send(ws, STOOD)
    this.noteSat(was.id, seat.userId, this.clock())
  }

  /** After `userId`'s blocks changed from `before` to `after`: each side hears the other leave, or come back. */
  private reblock(userId: string, mine: WebSocket[], before: Set<string>, t: Trust): void {
    const after = t.blocked
    const benches = new Set<string>()
    for (const other of this.sockets()) {
      const theirs = this.seat(other)
      if (!theirs.userId || theirs.userId === userId) continue
      const blocked = after.has(theirs.userId)
      if (blocked === before.has(theirs.userId)) continue
      if (theirs.bench) benches.add(theirs.bench.id)
      for (const ws of mine) {
        const seat = this.seat(ws)
        // On one bench, the blocked person is stood up and the blocker stays (both blocking: neither moves).
        if (blocked && seat.bench && seat.bench.id === theirs.bench?.id) {
          if (t.blockedBy.has(theirs.userId) && !t.blocking.has(theirs.userId)) this.unseat(ws, seat)
          else if (t.blocking.has(theirs.userId) && !t.blockedBy.has(theirs.userId))
            this.unseat(other, theirs)
        }
        if (blocked) {
          if (theirs.shown) this.send(ws, { t: 'leave', id: theirs.userId })
          if (seat.shown) this.send(other, { t: 'leave', id: userId })
        } else {
          if (theirs.shown && theirs.pos && theirs.person) this.send(ws, { t: 'join', p: livePerson(theirs) })
          if (seat.shown && seat.pos && seat.person) this.send(other, { t: 'join', p: livePerson(seat) })
        }
      }
    }
    // Who sits beside whom, as each now may see it.
    for (const bench of benches) this.tellBench(bench)
  }

  /** Brings `ws`'s person up to date with `person` (null: no longer a resident). */
  private reface(ws: WebSocket, person: PublicPerson | null, why: RefreshWhy | null): void {
    const seat = this.seat(ws)
    const userId = seat.userId!
    if (!person) {
      if (!seat.person) return
      // Off the map, and up from any bench: a ghost from here on.
      if (seat.shown) this.broadcast({ t: 'leave', id: userId }, userId, ws)
      this.write(ws, { ...seat, person: null, shown: false, bench: null })
      if (seat.bench) {
        this.noteSat(seat.bench.id, userId, this.clock())
        this.tellBench(seat.bench.id)
      }
      return this.send(ws, { t: 'welcome', you: { id: userId, visible: false }, people: this.people(userId) })
    }
    const next = { ...seat, person }
    this.write(ws, next)
    if (!seat.person)
      return this.send(ws, { t: 'welcome', you: { id: userId, visible: true }, people: this.people(userId) })
    const changed = JSON.stringify(seat.person) !== JSON.stringify(person)
    if (!changed && why !== 'profile') return
    if (seat.shown && seat.pos) this.broadcast({ t: 'join', p: livePerson(next) }, userId, ws)
    if (seat.bench) this.tellBench(seat.bench.id)
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    // After a wake, nothing is relayed until everyone's blocks are back; without them, the frame is dropped.
    if (!this.warm && !(await this.ready())) return
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
        if (!seat.person) return this.send(ws, GHOST)
        if (this.muted(seat.userId, now)) return this.send(ws, MUTED)
        return wordsOk(msg.text) ? this.status(ws, seat, msg.text) : this.send(ws, WORDS)
      case 'sit':
        return seat.person ? this.sit(ws, seat, msg.bench) : this.send(ws, GHOST)
      case 'say':
        if (!seat.person) return this.send(ws, GHOST)
        if (this.muted(seat.userId, now)) return this.send(ws, MUTED)
        return wordsOk(msg.text) ? this.say(ws, seat, msg.text, now) : this.send(ws, WORDS)
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close(1000, 'bye')
    } catch {
      // Already answered.
    }
    // So the leave skips anyone blocked; if D1 is down it goes regardless.
    if (!this.warm) await this.ready()
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
    if (!this.warm) await this.ready()
    this.depart(ws)
  }

  async alarm(): Promise<void> {
    // So the leaves the sweep sends skip anyone blocked; if D1 is down the sweep runs regardless.
    await this.ready()
    const now = this.clock()
    if (now - this.trustSweptAt >= TRUST_SWEEP_MS) await this.resweep(now)
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
      this.noteSat(bench.id, seat.userId, now)
      this.tellBench(bench.id)
    } else if (arriving) this.write(ws, seat)
    else this.keep(ws, seat, now)
    if (arriving) this.broadcast({ t: 'join', p: livePerson(seat) }, seat.userId, ws)
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
    if (seat.shown) this.broadcast(msg, userId)
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
    const now = this.clock()
    if (id === null) {
      seat.bench = null
      this.write(ws, seat)
      this.send(ws, STOOD)
      if (was) {
        this.noteSat(was.id, seat.userId, now)
        this.tellBench(was.id)
      }
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
    this.noteSat(id, seat.userId, now)
    if (was) {
      this.noteSat(was.id, seat.userId, now)
      this.tellBench(was.id)
    }
    this.tellBench(id)
  }

  /**
   * A seated resident's line, to everyone on that bench (the speaker too) but anyone blocked either way, and
   * into its transcript, which then keeps the object awake (see `stayAwake`).
   */
  private say(ws: WebSocket, seat: Seat, text: string, now: number): void {
    const bench = seat.bench
    if (!bench) return this.send(ws, INVALID)
    const line: BenchLine = { from: seat.userId!, name: seat.person!.name, text, at: now }
    const lines = this.transcript(bench.id, now)
    lines.push(line)
    if (lines.length > TRANSCRIPT_LINES) lines.splice(0, lines.length - TRANSCRIPT_LINES)
    this.transcripts.set(bench.id, lines)
    const out = JSON.stringify({ t: 'bench', bench: bench.id, ...line } satisfies ServerMsg)
    for (const s of this.sitters(bench.id))
      if (!this.apart(seat.userId, s.seat.userId)) this.sendRaw(s.ws, out)
    if (!this.awake) this.stayAwake()
  }

  /**
   * Keeps the object in memory while any bench remembers a line: drops lines past `TRANSCRIPT_MS`, and while
   * any are left arms a timer that runs this again in `AWAKE_MS` (a pending timer keeps a hibernatable object
   * awake). Once every transcript is empty it arms nothing, and the object may hibernate.
   */
  private stayAwake(): void {
    if (this.awake) clearTimeout(this.awake)
    this.awake = null
    const now = this.clock()
    for (const bench of [...this.transcripts.keys()]) this.transcript(bench, now)
    if (this.transcripts.size) this.awake = setTimeout(() => this.stayAwake(), AWAKE_MS)
  }

  /** Notes that `userId` sat at, or got up from, `bench` at `now`, and forgets anyone gone for 10 minutes. */
  private noteSat(bench: string, userId: string | null, now: number): void {
    if (!userId) return
    const log = this.sat.get(bench) ?? new Map<string, number>()
    for (const [id, at] of log) if (now - at > TRANSCRIPT_MS) log.delete(id)
    log.set(userId, now)
    this.sat.set(bench, log)
  }

  /**
   * RPC, for a bench report: whether `userId` sits at `bench` now, or sat there in the last `TRANSCRIPT_MS`.
   * Memory only, like the transcript.
   */
  satRecently(bench: string, userId: string): boolean {
    if (this.sitters(bench).some((s) => s.seat.userId === userId)) return true
    const at = this.sat.get(bench)?.get(userId)
    return at !== undefined && this.clock() - at <= TRANSCRIPT_MS
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

  /** Tells everyone at `bench` (or just `only`) where they sit and who with (but anyone blocked). */
  private tellBench(bench: string, only?: WebSocket): void {
    const all = this.sitters(bench)
    for (const { ws, seat } of all)
      if (!only || ws === only)
        this.send(ws, {
          t: 'seated',
          bench,
          seat: seat.bench!.seat,
          with: all
            .filter((s) => s.ws !== ws && !this.apart(seat.userId, s.seat.userId))
            .map((s) => s.seat.person!.name),
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
        if (m.id === userId || dx * dx + dz * dz > reach || this.apart(m.id, userId)) continue
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
    if (seat.shown && seat.userId) this.broadcast({ t: 'leave', id: seat.userId }, seat.userId)
    // Their last socket here: their trust state goes with it (the others' sets keep naming them, as they should).
    if (seat.userId && !this.sockets().some((s) => this.seat(s).userId === seat.userId))
      this.trust.delete(seat.userId)
  }

  /** Marks a socket closed and unlisted, and tells its bench (if any) that it got up. */
  private retire(ws: WebSocket): void {
    const seat = this.seat(ws)
    this.dirty.delete(ws)
    this.write(ws, { ...seat, shown: false, closed: true, bench: null })
    if (seat.bench) {
      this.noteSat(seat.bench.id, seat.userId, this.clock())
      this.tellBench(seat.bench.id)
    }
  }

  /** Everyone listed, but `asker` themself and anyone blocked either way with them. */
  private people(asker: string | null): LivePerson[] {
    const out: LivePerson[] = []
    for (const ws of this.sockets()) {
      const seat = this.seat(ws)
      if (seat.shown && seat.pos && seat.person && seat.userId !== asker && !this.apart(asker, seat.userId))
        out.push(livePerson(seat))
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
        ip: null,
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

  /** To every socket but `except` and anyone blocked either way with `about`, whom it is about. Serialised once. */
  private broadcast(msg: ServerMsg, about: string | null, except?: WebSocket): void {
    const text = JSON.stringify(msg)
    for (const ws of this.sockets())
      if (ws !== except && !this.apart(about, this.seat(ws).userId)) this.sendRaw(ws, text)
  }
}
