import { DurableObject } from 'cloudflare:workers'
import { resolveUser } from './auth'
import { allowedOrigin } from './cors'
import type { Env } from './env'
import { ipKey } from './limits'
import benches from './benches.json'
import taxi from './taxi.json'
import { wordsOk } from './filter/server'
import { GATE_NAME, type Admit, type GateDO } from './gate'
import { firstName } from './names'
import { ACTIVE, cleanText, loadResident, MAX_STATUS, toPublic } from './profiles'
import type { RefreshWhy } from './refresh'
import { recentInvite } from './trust'
import {
  BENCH_SEATS,
  JOG_BURST_M,
  JOG_MAX_SPEED,
  LIVE_CLOSE,
  MAX_BENCH_LINE,
  REACT_PAIR_MS,
  REACT_PER_MINUTE,
  REACT_RANGE_M,
  REACTIONS,
  EMOTE_KINDS,
  EMOTE_PER_MINUTE,
  type BenchLine,
  type ClientMsg,
  type DistrictId,
  type EmoteKind,
  type LivePerson,
  type PosterView,
  type PublicPerson,
  type Reaction,
  type ReactRefusal,
  type ServerMsg,
  type Vehicle,
} from './protocol'

export const DISTRICT_IDS: readonly DistrictId[] = [
  'walled-city',
  'mi-road',
  'university',
  'malviya-nagar',
  'amer',
  'nahargarh',
  'galta',
]

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
/**
 * The auto-taxi, by district: where its parked autos stand (as its `props` place them) and, per landmark, the
 * point beside it where a ride sets the rider down, with the way the auto faces there. The same file is copied
 * to the frontend, whose district defs are tested against it (scripts/check-protocol.mjs keeps the copies equal).
 */
export const TAXI: Record<
  DistrictId,
  { stands: { x: number; z: number }[]; drops: Record<string, { x: number; z: number; ry: number }> }
> = taxi
/** A ride is given this close to a stand, by where the rider says they get in: a little over the client's 2.5 m. */
export const TAXI_RANGE_M = 3
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
  /** A resident who redeemed an invite in the last 24 hours: they skip the line for room (see `GateDO`). */
  skip?: true
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
/**
 * The fastest anyone may go on foot without claiming a jog, in m/s, measured against the last accepted point.
 * A jog (`JOG_SPEED`, 7.2 m/s) fits under it too, but with a burst too small for a jogger's stalls: a jogging
 * client says so (`pace: 'jog'`) and gets `JOG_BURST_M`.
 */
export const MAX_SPEED = 8
/**
 * How far ahead of that pace a burst may run: one second's worth. This is a deliberate tolerance for network
 * jitter: frames bunch up after a stall, and without it a walker arriving all at once would be pulled back.
 * It covers a stall of 2 s at a walk.
 * The average still never beats `MAX_SPEED`; the most anyone gains is one 8 m hop after standing still.
 */
export const SPEED_BURST_M = MAX_SPEED
/**
 * A move that says `v: 'auto'` gets this pace (1.5x walking) and a burst of two seconds' worth, as walking
 * does: the client also drives at 12 m/s, so a stall of up to 2 s must not rubber-band a driver at full
 * speed. The flag is the client's word: one that lies gets 1.5x the walking pace and 3x the walking burst
 * (24 m once, after standing still), an accepted cost.
 */
export const AUTO_MAX_SPEED = 12
export const AUTO_BURST_M = 2 * AUTO_MAX_SPEED
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
const MAX_LANDMARK_ID = 64
/** A user id in a `react` frame: longer than any we hand out. */
const MAX_PERSON_ID = 64
/** The window `REACT_PER_MINUTE` and `REACT_INBOUND_PER_MINUTE` count over. */
const REACT_WINDOW_MS = 60_000
/**
 * The most greetings one person is shown in a minute, from everyone together: several accounts cannot flood
 * one person. Past it a greeting is dropped unseen, and its sender is shown the usual success, so the cap
 * cannot be used to learn anything about the target.
 */
export const REACT_INBOUND_PER_MINUTE = 6
/** An emote kind in a frame: longer than any we know, or a later Worker is likely to. */
const MAX_EMOTE_KIND = 16
/** The window `EMOTE_PER_MINUTE` counts over, from a sender's first emote in it. */
export const EMOTE_WINDOW_MS = 60_000
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
const NO_RIDE = { t: 'error', code: 'no-ride' } as const
const STOOD: ServerMsg = { t: 'seated', bench: null, seat: null, with: [] }
/** What the walls may show this person changed (a block made or lifted): they fetch them again. */
const POSTERS: ServerMsg = { t: 'posters' }

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
  // A database hiccup makes this visit a ghost one rather than no visit at all (and a lost invite, one in line).
  const [person, skip] = user
    ? await Promise.all([
        loadResident(env, user.id).catch(() => null),
        recentInvite(env, user.id).catch(() => false),
      ])
    : [null, false]
  const who: Who = { userId: user?.id ?? null, person, ip: request.headers.get('CF-Connecting-IP') }
  if (person && skip) who.skip = true
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
      const { x, z, ry, v, pace } = m
      // absent, or exactly 'auto': null, a number or any other word is a bad frame
      if ('v' in m && v !== 'auto') return null
      if (!isNum(x, MAX_COORD) || !isNum(z, MAX_COORD) || !isNum(ry, MAX_TURN)) return null
      const move: ClientMsg = v === 'auto' ? { t: 'move', x, z, ry, v } : { t: 'move', x, z, ry }
      // a pace other than 'jog' is ignored, as any unknown field is: never a bad frame, just a walk
      return pace === 'jog' ? { ...move, pace } : move
    }
    case 'ride': {
      const { to, x, z } = m
      return typeof to === 'string' &&
        to.length <= MAX_LANDMARK_ID &&
        isNum(x, MAX_COORD) &&
        isNum(z, MAX_COORD)
        ? { t: 'ride', to, x, z }
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
    case 'react': {
      const { to, kind } = m
      return typeof to === 'string' &&
        to.length <= MAX_PERSON_ID &&
        (REACTIONS as readonly unknown[]).includes(kind)
        ? { t: 'react', to, kind: kind as Reaction }
        : null
    }
    case 'emote':
      // Any short word is a good frame, known or not: a newer page's kind must never count as a strike (five
      // would close its socket). `emote` drops the ones this Worker does not know. Nothing else is read.
      return typeof m.kind === 'string' && m.kind.length <= MAX_EMOTE_KIND
        ? { t: 'emote', kind: m.kind as EmoteKind }
        : null
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
    return person && who.skip === true ? { userId, person, ip, skip: true } : { userId, person, ip }
  } catch {
    return { userId: null, person: null, ip: null }
  }
}

const isLoopback = (ip: string) => ip === '::1' || ipKey(ip).startsWith('127.')

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
  /** Driving an auto, as of this point. */
  v?: Vehicle
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
  /**
   * A resident waiting in line for room in the city (see `GateDO`): their face, kept for when they get in. Until
   * then `person` is null, and they are a ghost in every way.
   */
  wait?: PublicPerson | null
  /** And the position in line they were last told. */
  place?: number
  /** What this person spent of `EMOTE_PER_MINUTE`: when the minute began, and how many since (see `emote`). */
  emotes?: EmoteSpend
}

interface EmoteSpend {
  since: number
  n: number
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

/** What a district can say about a bench for a report (see `DistrictDO.benchWitness`). */
export interface BenchWitness {
  reporter: boolean
  target: boolean
  remembers: boolean
  lines: BenchLine[]
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
  const { x, z, ry, v } = seat.pos!
  return { ...toPublic(seat.person!), x, z, ry, ...(v && { v }) }
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
 * deploy, or the runtime evicting the object anyway, still loses both: that is accepted, and a report then
 * rests on the seats, which survive (see `benchWitness`).
 *
 * Emotes (a dance, a clap, sitting down, a selfie pose, a wave): passed on to whoever hears the sender's moves
 * and forgotten (`emote`). Their allowance rides in the socket's attachment, so they arm no timer at all.
 *
 * Reactions (a namaste, a wave): passed on and forgotten. Only what each sender spent of their allowance is
 * remembered, in memory, for a minute (`reacts`), and that too keeps the object awake (`stayAwake`).
 *
 * Trust (blocks, mutes): each connected person's, in `trust`, loaded from D1 when they connect and again when
 * `refresh` says it changed. Memory only, never in an attachment (a long block list would break its size
 * cap): after a wake the first frame, or the alarm, loads it for everyone still connected before anything is
 * relayed (`ready`). Two people blocked either way never hear of each other: no join, leave, move, status or
 * bench line about one reaches the other.
 *
 * The city's cap (`GateDO`): a resident is seen only once the gate admits them. Over the cap they wait in line
 * on a ghost socket, their face kept in its attachment (`wait`) until the gate `promote`s them; their last
 * resident or waiting socket here closing `release`s them, and the alarm vouches for everyone here
 * (`heartbeat`).
 */
export class DistrictDO extends DurableObject<Env> {
  /** Now, in ms. A test swaps it to step past `IDLE_MS` without waiting. */
  clock: () => number = Date.now
  /**
   * When this instance began, by `clock`. Its memory of benches (`sat`, `transcripts`) covers only the time
   * since: a fresh instance (after hibernation or an eviction) cannot say who was *not* there (see
   * `benchWitness`). A test may move it back.
   */
  bornAt = this.clock()
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
  private refreshCount = 0
  /** Whether `trust` holds everyone connected since this instance started; `warming` while it loads. */
  private warm = false
  private warming: Promise<boolean> | null = null
  /** When D1 last failed to give trust state: none is asked for until `TRUST_RETRY_MS` after (see `load`). */
  private trustFailedAt = -Infinity
  /** When the alarm last reloaded everyone's trust state (see `alarm`). */
  private trustSweptAt = -Infinity
  /**
   * Per sender, the reactions they sent in the last `REACT_WINDOW_MS`, oldest first: when, and to whom (a
   * greeting dropped by the target's cap counts too: the sender saw it go). Memory
   * only (a reaction itself is never kept), by user id so a reconnect does not reset it, and kept awake for the
   * window like a bench's lines (see `stayAwake`).
   */
  private reacts = new Map<string, { at: number; to: string }[]>()
  /** Per target, when each greeting they were shown in the last `REACT_WINDOW_MS` came. Memory only, like `reacts`. */
  private greeted = new Map<string, number[]>()
  /**
   * Per sender, what they spent of `EMOTE_PER_MINUTE` (see `emote`), by user id so a new socket does not reset
   * it. Memory only, and it arms no timer: the same figures ride in the socket's attachment, so a sleep
   * forgets nothing a connected sender spent, and the object is never kept awake for an emote.
   */
  private emoteSpent = new Map<string, EmoteSpend>()

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
    // Seen, or waiting in line for room: the city's cap, asked before anyone hears of them.
    const pass = who.person ? await this.admit(who.userId!, district, who.skip === true) : null
    // Others may have come in while D1 and the gate answered.
    if (this.crowded(who)) {
      if (pass) this.releaseIfGone(who.userId!, district)
      return this.turnAway(who.userId)
    }
    const person = pass?.ok ? who.person : null
    const wait = pass && !pass.ok ? who.person : null
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
    const spent = before?.emotes ?? (who.userId ? this.emoteSpent.get(who.userId) : undefined)
    const seat: Seat = {
      district,
      userId: who.userId,
      person,
      shown: person !== null && before?.shown === true,
      pos: before?.pos ?? null,
      seen: now,
      bad: 0,
      lanes: fullLanes(now),
      flood: null,
      bench: null,
      ip: who.ip === null ? null : ipKey(who.ip),
      ...(pass && !pass.ok ? { wait, place: pass.position } : {}),
      // the emote allowance is the person's, not the socket's: a new socket does not refill it
      ...(spent && { emotes: spent }),
    }
    this.write(server, seat)
    this.send(server, {
      t: 'welcome',
      you:
        seat.place === undefined
          ? { id: who.userId, visible: person !== null }
          : { id: who.userId, visible: false, queued: seat.place },
      people: this.people(who.userId),
    })
    if (seat.shown) this.broadcast({ t: 'join', p: livePerson(seat) }, who.userId, server)
    else if (before?.shown) this.broadcast({ t: 'leave', id: who.userId! }, who.userId, server)
    // The socket this one replaced held a slot (or a place in line) this one does not.
    if (!person && !wait && (before?.person || before?.wait)) this.releaseIfGone(who.userId!, district)
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

  /** The gate's stub, kept: calls made on one stub arrive in the order they were made (a release, then an admit). */
  private gateStub: DurableObjectStub<GateDO> | null = null
  private gate(): DurableObjectStub<GateDO> {
    return (this.gateStub ??= this.env.GATE.get(this.env.GATE.idFromName(GATE_NAME)))
  }

  /** Whether `userId` may be seen here (see `GateDO.admit`). Null when the gate could not be asked: a ghost visit. */
  private async admit(userId: string, district: DistrictId, skip: boolean): Promise<Admit | null> {
    try {
      return await this.gate().admit(userId, district, skip)
    } catch (err) {
      console.error('district: gate admit failed', err)
      return null
    }
  }

  /** Releases still on their way to the gate. A test waits for them to land before its file ends. */
  private releasing = new Set<Promise<void>>()

  /**
   * Tells the gate `userId` holds nothing here any more, unless another socket of theirs here still does.
   * `forget`: they are no longer a resident at all (banned, hidden), so no hold is kept and no place in line.
   */
  private releaseIfGone(userId: string, district: DistrictId, forget = false): void {
    for (const ws of this.sockets()) {
      const seat = this.seat(ws)
      if (seat.userId === userId && (seat.person || seat.wait)) return
    }
    const done: Promise<void> = this.gate()
      .release(userId, district, forget)
      .catch((err: unknown) => console.error('district: gate release failed', err))
      .finally(() => this.releasing.delete(done))
    this.releasing.add(done)
    this.ctx.waitUntil(done)
  }

  /**
   * RPC, from the gate: `userId` may be seen now. Their waiting socket here becomes a resident (see `letIn`).
   * True when it did, or they are a resident here already; false when nobody of theirs waits here.
   */
  async promote(userId: string): Promise<boolean> {
    // So the join skips anyone blocked.
    if (!(await this.ready())) return false
    const mine = this.sockets().filter((ws) => this.seat(ws).userId === userId)
    if (mine.some((ws) => this.seat(ws).person)) return true
    const ws = mine.find((s) => this.seat(s).wait)
    if (!ws) return false
    this.letIn(ws)
    return true
  }

  /** A waiting socket gets in: told it is seen, and shown to everyone where it stands, if it has stepped yet. */
  private letIn(ws: WebSocket): void {
    const seat = this.seat(ws)
    const userId = seat.userId!
    const next: Seat = { ...seat, person: seat.wait!, wait: null, place: undefined, shown: seat.pos !== null }
    this.write(ws, next)
    this.send(ws, { t: 'welcome', you: { id: userId, visible: true }, people: this.people(userId) })
    if (next.shown) this.broadcast({ t: 'join', p: livePerson(next) }, userId, ws)
  }

  /** RPC, from the gate: where these people now stand in line. A waiting socket hears of any change. */
  place(at: Record<string, number>): void {
    for (const ws of this.sockets()) {
      const seat = this.seat(ws)
      const position =
        seat.wait && seat.userId && Object.hasOwn(at, seat.userId) ? at[seat.userId] : undefined
      if (position === undefined || position === seat.place) continue
      this.write(ws, { ...seat, place: position })
      this.send(ws, { t: 'queued', position })
    }
  }

  /**
   * A ghost socket whose person may be seen again (an unhide): the gate is asked first, as on a connect, and
   * they are told what it said.
   */
  private async enterLive(ws: WebSocket, person: PublicPerson): Promise<void> {
    const { userId, district } = this.seat(ws)
    const pass = await this.admit(userId!, district, false)
    const seat = this.seat(ws)
    if (seat.closed || seat.person || seat.wait) {
      if (pass) this.releaseIfGone(userId!, district)
      return
    }
    if (!pass) return
    const you = pass.ok
      ? { id: userId, visible: true }
      : { id: userId, visible: false, queued: pass.position }
    this.write(ws, pass.ok ? { ...seat, person } : { ...seat, wait: person, place: pass.position })
    this.send(ws, { t: 'welcome', you, people: this.people(userId) })
  }

  /**
   * Vouches to the gate for everyone here, residents and waiting (see `GateDO.heartbeat`), from the alarm; tells
   * the waiting where they stand, and lets in any who hold a slot after all.
   */
  private async beat(): Promise<void> {
    let district: DistrictId | null = null
    const residents = new Set<string>()
    const waiting = new Set<string>()
    for (const ws of this.sockets()) {
      const seat = this.seat(ws)
      district = seat.district
      if (seat.userId && seat.person) residents.add(seat.userId)
      else if (seat.userId && seat.wait) waiting.add(seat.userId)
    }
    if (!district || (!residents.size && !waiting.size)) return
    try {
      const { places, admit } = await this.gate().heartbeat(district, [...residents], [...waiting])
      this.place(places)
      for (const id of admit) {
        const ws = this.sockets().find((s) => this.seat(s).userId === id && this.seat(s).wait)
        if (ws) this.letIn(ws)
      }
    } catch (err) {
      console.error('district: gate heartbeat failed', err)
    }
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
    // Their posters on this district's walls follow a hide or an unhide for everyone here, connected or not.
    if (why === 'hide') await this.refaceWalls(userId)
    if (!this.sockets().some((ws) => this.seat(ws).userId === userId)) return
    if (why === 'delete') {
      // Gone from D1: nothing to reload. Close everything they have here and let the gate forget them.
      for (const ws of this.sockets().filter((s) => this.seat(s).userId === userId))
        this.drop(ws, LIVE_CLOSE.deleted, 'deleted', true)
      return
    }
    if (!(await this.ready())) throw new Error('district: trust state unavailable')
    // Loads can finish out of order: only the newest one asked for may be applied.
    const seq = ++this.refreshCount
    this.refreshSeq.set(userId, seq)
    try {
      const [got, person] = await Promise.all([loadTrust(this.env, [userId]), loadResident(this.env, userId)])
      if (this.refreshSeq.get(userId) !== seq) return
      this.apply(userId, got.get(userId) ?? noTrust(), person, why)
    } finally {
      // Only the newest ask clears the entry, so the map holds just the people with a load in flight.
      if (this.refreshSeq.get(userId) === seq) this.refreshSeq.delete(userId)
    }
  }

  /**
   * Acts on `userId`'s fresh trust state `t`: a ban closes their sockets with `LIVE_CLOSE.banned`; blocks made
   * or lifted take people out of, or put them back into, each other's view; a mute is simply kept (see
   * `muted`). With their public face (`person`, null when others may no longer see them): someone hidden is
   * taken off the map and told they are a ghost (out of the line, if waiting in it), someone visible again goes
   * through the gate first and is told what it said (admitted: their next move lists them), a waiting person's
   * new face is kept for when they get in, and a changed face (or `why` = `profile`) goes out as a `join`. Without it (`undefined`, from the alarm's
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
      for (const ws of mine) this.drop(ws, LIVE_CLOSE.banned, 'banned', true)
      return
    }
    this.reblock(userId, mine, before, t)
    // Their own blocks are theirs to apply to the walls: told on every block refresh (made or lifted, either
    // side), and whenever the backstop finds the set changed.
    if (why === 'block' || before.size !== t.blocked.size || [...before].some((id) => !t.blocked.has(id)))
      for (const ws of mine) this.send(ws, POSTERS)
    const face = t.hidden ? null : person
    if (face !== undefined) for (const ws of mine) this.reface(ws, face, why)
  }

  /**
   * The backstop for a refresh that never arrived (`refreshUser` retries once, then gives up): reloads everyone
   * connected and applies what changed, so a missed ban, hide, mute or block takes hold within
   * `TRUST_SWEEP_MS` or so. Run by the alarm, which comes round at least every `IDLE_MS` while anyone is here.
   */
  private async resweep(now: number): Promise<void> {
    const ids = new Set<string>()
    for (const ws of this.sockets()) {
      const { userId } = this.seat(ws)
      if (userId) ids.add(userId)
    }
    // Skipped for a recent failure: not counted as done, so the next alarm tries rather than waiting a minute.
    if (ids.size && now - this.trustFailedAt < TRUST_RETRY_MS) return
    this.trustSweptAt = now
    if (!ids.size) return
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
    if (seat.wait) {
      // In line: a new face is kept for when they get in. Hidden, they drop out of the running, and are told.
      if (person) return this.write(ws, { ...seat, wait: person })
      this.write(ws, { ...seat, wait: null, place: undefined })
      this.releaseIfGone(userId, seat.district, true)
      return this.send(ws, { t: 'welcome', you: { id: userId, visible: false }, people: this.people(userId) })
    }
    if (!person) {
      if (!seat.person) return
      // Off the map, and up from any bench: a ghost from here on.
      if (seat.shown) this.broadcast({ t: 'leave', id: userId }, userId, ws)
      this.write(ws, { ...seat, person: null, shown: false, bench: null })
      this.releaseIfGone(userId, seat.district, true)
      if (seat.bench) {
        this.noteSat(seat.bench.id, userId, this.clock())
        this.tellBench(seat.bench.id)
      }
      return this.send(ws, { t: 'welcome', you: { id: userId, visible: false }, people: this.people(userId) })
    }
    // Visible again: through the gate first, like any arrival.
    if (!seat.person) return void this.enterLive(ws, person)
    const next = { ...seat, person }
    this.write(ws, next)
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
      case 'ride':
        return this.ride(ws, seat, msg, now)
      case 'status':
        if (!seat.person) return this.send(ws, GHOST)
        if (this.muted(seat.userId, now)) return this.send(ws, MUTED)
        return wordsOk(msg.text, 'status') ? this.status(ws, seat, msg.text) : this.send(ws, WORDS)
      case 'sit':
        return seat.person ? this.sit(ws, seat, msg.bench) : this.send(ws, GHOST)
      case 'say':
        if (!seat.person) return this.send(ws, GHOST)
        if (this.muted(seat.userId, now)) return this.send(ws, MUTED)
        return wordsOk(msg.text) ? this.say(ws, seat, msg.text, now) : this.send(ws, WORDS)
      case 'react':
        return this.react(ws, seat, msg, now)
      case 'emote':
        return this.emote(ws, seat, msg.kind, now)
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
    await this.beat()
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
    const { v } = m
    // at the wheel the auto's allowance; on foot a claimed jog's, else a walk's
    const [pace, burst] =
      v === 'auto'
        ? [AUTO_MAX_SPEED, AUTO_BURST_M]
        : m.pace === 'jog'
          ? [JOG_MAX_SPEED, JOG_BURST_M]
          : [MAX_SPEED, SPEED_BURST_M]
    if (last) {
      const budget = Math.min(burst, last.budget + (pace * Math.max(0, now - last.at)) / 1000)
      const step = Math.hypot(x - last.x, z - last.z)
      if (step > budget) {
        this.keep(ws, seat, now)
        return this.send(ws, { t: 'error', code: 'too-fast', x: last.x, z: last.z, ry: last.ry })
      }
      seat.pos = { x, z, ry, at: now, budget: budget - step, ...(v && { v }) }
    } else seat.pos = { x, z, ry, at: now, budget: burst, ...(v && { v }) }
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
   * The auto-taxi. Given only from where the rider stands (a walk on from the last accepted point, as a move
   * would be) within `TAXI_RANGE_M` of one of this district's stands, to one of its landmarks, and not from a
   * bench. The rider is then set down at the landmark's drop point, from `TAXI`, with what was left of their
   * walking burst at the stand (a ride refills none): nothing the client says decides where they land. Seen,
   * they leave the street now and come back with their next move, beside the landmark (`arriving` in `move`),
   * so nobody watches them slide across the district.
   */
  private ride(ws: WebSocket, seat: Seat, m: Extract<ClientMsg, { t: 'ride' }>, now: number): void {
    seat.seen = now
    const line = TAXI[seat.district]
    const drop = Object.hasOwn(line.drops, m.to) ? line.drops[m.to] : undefined
    const last = seat.pos
    const at = { x: round(m.x, 100), z: round(m.z, 100) }
    // what is left of the walking burst once at the stand: the ride carries it over, never refills it
    const left = last
      ? Math.min(SPEED_BURST_M, last.budget + (MAX_SPEED * Math.max(0, now - last.at)) / 1000) -
        Math.hypot(at.x - last.x, at.z - last.z)
      : -1
    if (!drop || left < 0 || seat.bench || !line.stands.some((s) => !far(at, s, TAXI_RANGE_M))) {
      this.keep(ws, seat, now)
      return this.send(ws, NO_RIDE)
    }
    seat.pos = { x: drop.x, z: drop.z, ry: drop.ry, at: now, budget: left }
    this.dirty.delete(ws)
    if (seat.shown) {
      seat.shown = false
      this.broadcast({ t: 'leave', id: seat.userId! }, seat.userId, ws)
    }
    this.write(ws, seat)
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
   * A greeting from `seat`'s person to `m.to` (see `REACTIONS`). Refused, with a `react-no` to the sender only,
   * for a ghost or hidden sender, a muted one, anyone the sender may not greet here (gone, a ghost, hidden or
   * blocked either way: all `gone` alike, so a block is never told), a sender not on the street or more than
   * `REACT_RANGE_M` from them, and past the per-pair and per-minute allowances. A target already shown
   * `REACT_INBOUND_PER_MINUTE` this minute is not shown it, and nor is anyone else: only the sender, as if it
   * went (see there). Otherwise it goes to both and to
   * every other socket within `INTEREST_M` of the sender that is blocked either way with neither (ghosts
   * watching included: they see the street), and nowhere else. Nothing of it is stored.
   */
  private react(ws: WebSocket, seat: Seat, m: Extract<ClientMsg, { t: 'react' }>, now: number): void {
    const no = (why: ReactRefusal) => this.send(ws, { t: 'react-no', to: m.to, why })
    const from = seat.userId
    if (!seat.person || !from || this.trust.get(from)?.hidden) return no('ghost')
    if (this.muted(from, now)) return no('muted')
    const target = this.sockets().find((s) => this.seat(s).userId === m.to)
    const theirs = target && this.seat(target)
    if (
      !target ||
      !theirs ||
      m.to === from ||
      !theirs.person ||
      !theirs.shown ||
      !theirs.pos ||
      this.trust.get(m.to)?.hidden ||
      this.apart(from, m.to)
    )
      return no('gone')
    if (!seat.shown || !seat.pos || far(seat.pos, theirs.pos, REACT_RANGE_M)) return no('far')
    const sent = (this.reacts.get(from) ?? []).filter((r) => now - r.at < REACT_WINDOW_MS)
    if (sent.length >= REACT_PER_MINUTE || sent.some((r) => r.to === m.to && now - r.at < REACT_PAIR_MS)) {
      this.reacts.set(from, sent)
      return no('wait')
    }
    sent.push({ at: now, to: m.to })
    this.reacts.set(from, sent)
    if (!this.awake) this.stayAwake()
    const text = JSON.stringify({ t: 'react', from, to: m.to, kind: m.kind } satisfies ServerMsg)
    const heard = (this.greeted.get(m.to) ?? []).filter((at) => now - at < REACT_WINDOW_MS)
    if (heard.length >= REACT_INBOUND_PER_MINUTE) {
      // the target has had their fill: only the sender sees it go, as any other
      this.greeted.set(m.to, heard)
      return this.sendRaw(ws, text)
    }
    heard.push(now)
    this.greeted.set(m.to, heard)
    const reach = INTEREST_M * INTEREST_M
    for (const other of this.sockets()) {
      if (other === ws || other === target) {
        this.sendRaw(other, text)
        continue
      }
      const { userId, pos } = this.seat(other)
      if (!pos || this.apart(from, userId) || this.apart(m.to, userId)) continue
      const dx = pos.x - seat.pos.x
      const dz = pos.z - seat.pos.z
      if (dx * dx + dz * dz <= reach) this.sendRaw(other, text)
    }
  }

  /**
   * An emote from `seat`'s person (see `EMOTE_KINDS`): passed on, as `{t: 'emote', from, kind}`, to exactly the
   * sockets `flush` would send this person's moves to (they have said where they are, stand within
   * `INTEREST_M` of the sender's last accepted point, and are blocked neither way with them; ghosts watching
   * included, as they see the street), and never back to the sender, whose page already plays it. Dropped
   * without a word (the page plays its own regardless, so nothing is told) for anyone who is not a listed
   * resident on the street (a ghost, someone waiting in line, a hidden person, one who has not stepped out
   * yet), for a muted one, for a kind this Worker does not know (a newer page's: the frame parsed, so it is
   * no strike), and past `EMOTE_PER_MINUTE` in the minute that began with their first.
   *
   * Nothing is stored and no timer is armed: the allowance is two numbers in the socket's attachment (and in
   * `emoteSpent`, for a new socket of the same person), so this never keeps the object from sleeping.
   */
  private emote(ws: WebSocket, seat: Seat, kind: EmoteKind, now: number): void {
    const from = seat.userId
    if (!(EMOTE_KINDS as readonly string[]).includes(kind)) return
    if (!seat.person || !from || !seat.shown || !seat.pos || this.trust.get(from)?.hidden) return
    if (this.muted(from, now)) return
    const live = (s: EmoteSpend | undefined) => (s && now - s.since < EMOTE_WINDOW_MS ? s : undefined)
    const [mine, known] = [live(seat.emotes), live(this.emoteSpent.get(from))]
    // whichever remembers more: the attachment after a sleep, the map after a reconnect
    const spent = mine && known ? (mine.n >= known.n ? mine : known) : (mine ?? known ?? { since: now, n: 0 })
    if (spent.n >= EMOTE_PER_MINUTE) return
    const next = { since: spent.since, n: spent.n + 1 }
    // senders long quiet are forgotten whenever anyone emotes: the map never outgrows a minute's senders
    for (const [id, s] of this.emoteSpent) if (now - s.since >= EMOTE_WINDOW_MS) this.emoteSpent.delete(id)
    this.emoteSpent.set(from, next)
    seat.emotes = next
    this.write(ws, seat)
    const text = JSON.stringify({ t: 'emote', from, kind } satisfies ServerMsg)
    const reach = INTEREST_M * INTEREST_M
    for (const other of this.sockets()) {
      if (other === ws) continue
      const { userId, pos } = this.seat(other)
      // as for moves: a socket that has never said where it is hears nothing of the street
      if (!pos || userId === from || this.apart(from, userId)) continue
      const dx = pos.x - seat.pos.x
      const dz = pos.z - seat.pos.z
      if (dx * dx + dz * dz <= reach) this.sendRaw(other, text)
    }
  }

  /**
   * Keeps the object in memory while any bench remembers a line, or anyone's reactions still count against
   * them: drops lines past `TRANSCRIPT_MS` and reactions past `REACT_WINDOW_MS`, and while any are left arms a
   * timer that runs this again in `AWAKE_MS` (a pending timer keeps a hibernatable object awake). Once both
   * are empty it arms nothing, and the object may hibernate.
   */
  private stayAwake(): void {
    if (this.awake) clearTimeout(this.awake)
    this.awake = null
    const now = this.clock()
    for (const bench of [...this.transcripts.keys()]) this.transcript(bench, now)
    for (const [id, sent] of this.reacts) {
      const keep = sent.filter((r) => now - r.at < REACT_WINDOW_MS)
      if (keep.length) this.reacts.set(id, keep)
      else this.reacts.delete(id)
    }
    for (const [id, times] of this.greeted) {
      const keep = times.filter((at) => now - at < REACT_WINDOW_MS)
      if (keep.length) this.greeted.set(id, keep)
      else this.greeted.delete(id)
    }
    if (this.transcripts.size || this.reacts.size || this.greeted.size)
      this.awake = setTimeout(() => this.stayAwake(), AWAKE_MS)
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
   * RPC, for "Chai pe bulao" (see `sendChai`): whether `userId` sits at `bench` now as a resident others can see
   * here (a ghost, someone hidden or waiting for room, does not count). Memory and attachments only.
   */
  seatedAt(bench: string, userId: string): boolean {
    return this.sitters(bench).some((s) => s.seat.userId === userId && s.seat.person !== null)
  }

  /**
   * RPC, for a bench report, in one call: whether `reporter` and `target` sit at `bench` now or sat there in
   * the last `TRANSCRIPT_MS` (seats survive hibernation, the log of who sat does not), whether this instance
   * has been up for that whole window (`remembers`: only then does "not there" mean not there), and the
   * transcript.
   */
  benchWitness(bench: string, reporter: string, target: string): BenchWitness {
    return {
      reporter: this.satRecently(bench, reporter),
      target: this.satRecently(bench, target),
      remembers: this.clock() - this.bornAt >= TRANSCRIPT_MS,
      lines: this.benchTranscript(bench),
    }
  }

  /**
   * RPC, from the posters API: `poster` went up on one of this district's walls, owned by `owner` (an id that
   * never leaves this object), after `gone` came down to make room. Everyone here hears the removals; the new
   * one goes to everyone but anyone blocked either way with its owner, and the owner's own sockets hear it as
   * `mine`. Without trust state (D1 unreachable) only the removals go: nobody blocked may see it, and the next
   * fetch of the walls brings it to everyone else.
   */
  async posterAdded(poster: PosterView, owner: string, gone: string[]): Promise<void> {
    if (!this.sockets().length) return
    this.posterRemoved(gone)
    if (!(await this.ready())) return
    // Named field by field: nothing else that rode along on the RPC goes out.
    const { id, wall, slot, text: words, when, name } = poster
    const plain: PosterView = { id, wall, slot, text: words, when, name }
    const text = JSON.stringify({ t: 'poster', op: 'add', poster: plain } satisfies ServerMsg)
    const own = JSON.stringify({
      t: 'poster',
      op: 'add',
      poster: { ...plain, mine: true },
    } satisfies ServerMsg)
    for (const ws of this.sockets()) {
      const { userId } = this.seat(ws)
      if (userId === owner) this.sendRaw(ws, own)
      else if (!this.apart(owner, userId)) this.sendRaw(ws, text)
    }
  }

  /**
   * RPC, from the posters API: `poster`, owned by `owner` (an id that never leaves this object), was hidden.
   * Everyone here hears it come down but its owner, whose own sockets keep it, marked `hidden` (it still counts
   * toward their two, so they must be able to take it down). Nobody else is ever sent a hidden poster.
   */
  posterHidden(poster: PosterView, owner: string): void {
    // Named field by field: nothing else that rode along on the RPC goes out.
    const { id, wall, slot, text: words, when, name } = poster
    const own = JSON.stringify({
      t: 'poster',
      op: 'add',
      poster: { id, wall, slot, text: words, when, name, mine: true, hidden: true },
    } satisfies ServerMsg)
    const gone = JSON.stringify({ t: 'poster', op: 'remove', id } satisfies ServerMsg)
    for (const ws of this.sockets()) this.sendRaw(ws, this.seat(ws).userId === owner ? own : gone)
  }

  /**
   * After `userId` was hidden or unhidden: their posters up on this district's walls come down for everyone
   * here but them (hidden: their name and plans are no longer shown to anyone else; see `posterHidden`), or go
   * back up (visible again, as `posterAdded` sends them). Nothing is asked of D1 when nobody is here. Throws when D1 cannot be reached,
   * so `refreshUser` tries again.
   */
  private async refaceWalls(userId: string): Promise<void> {
    const here = this.sockets()[0]
    if (!here) return
    const { district } = this.seat(here)
    const { results } = await this.env.DB.prepare(
      `SELECT po.id, po.wall, po.slot, po.text, po.at_when, p.name,
         (u.hidden = 0 AND ${ACTIVE}) AS visible
       FROM posters po JOIN users u ON u.id = po.owner LEFT JOIN profiles p ON p.user_id = po.owner
       WHERE po.owner = ? AND po.district = ? AND po.hidden = 0 AND po.expires_at > ?`,
    )
      .bind(userId, district, Date.now())
      .all<{
        id: string
        wall: number
        slot: number
        text: string
        at_when: number | null
        name: string | null
        visible: number | null
      }>()
    for (const r of results) {
      if (r.visible === 1 && r.name !== null) {
        const poster = {
          id: r.id,
          wall: r.wall,
          slot: r.slot,
          text: r.text,
          when: r.at_when,
          name: firstName(r.name),
        }
        await this.posterAdded(poster, userId, [])
      } else if (r.name !== null) {
        const poster = {
          id: r.id,
          wall: r.wall,
          slot: r.slot,
          text: r.text,
          when: r.at_when,
          name: firstName(r.name),
        }
        this.posterHidden(poster, userId)
      } else this.posterRemoved([r.id])
    }
  }

  /** RPC, from the posters API and the cron: these posters came down. Everyone here hears it. */
  posterRemoved(ids: string[]): void {
    for (const id of ids) this.broadcast({ t: 'poster', op: 'remove', id }, null)
  }

  /**
   * RPC, for the admin page: the sockets here now, as residents (a public face: listed, or about to be once
   * they move) and ghosts (everyone else, the hidden included). Memory only: it reads no storage.
   */
  counts(): { residents: number; ghosts: number } {
    let residents = 0
    for (const ws of this.sockets()) if (this.seat(ws).person) residents++
    return { residents, ghosts: this.sockets().length - residents }
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
      const tuple = pos.v ? [userId, pos.x, pos.z, pos.ry, pos.v] : [userId, pos.x, pos.z, pos.ry]
      movers.push({ id: userId, x: pos.x, z: pos.z, json: JSON.stringify(tuple) })
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

  /** Closes `ws` with `code`; `forget` as for `depart`. */
  private drop(ws: WebSocket, code: number, reason: string, forget = false): void {
    this.depart(ws, forget)
    try {
      ws.close(code, reason)
    } catch {
      // Already closing.
    }
  }

  /**
   * A socket is done: forget its moves, mark it closed (in its attachment too, so a wake cannot bring it back),
   * stand it up from its bench and, if it was listed, tell everyone it left. Runs once per socket. `forget`: the
   * person is banned, so the gate keeps neither their slot nor their place in line (see `releaseIfGone`).
   */
  private depart(ws: WebSocket, forget = false): void {
    const seat = this.seat(ws)
    if (seat.closed) return
    this.retire(ws)
    if (seat.shown && seat.userId) this.broadcast({ t: 'leave', id: seat.userId }, seat.userId)
    if (seat.userId && (seat.person || seat.wait)) this.releaseIfGone(seat.userId, seat.district, forget)
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
