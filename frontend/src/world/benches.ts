import { BENCH_SEATS, type BenchLine, type ClientMsg, type ServerMsg } from '../net/protocol'
import type { DistrictDef, PropSpec, Vec2 } from './types'

/** "Baitho" shows this close to a bench, and walking further than this from it stands the sitter up. */
export const BENCH_RANGE = 2.5

/** A tapri or bench prop that people can sit at, under the id the server knows it by. */
export interface Bench {
  /** `${districtId}:${n}`: the n-th tapri or bench in the district's `props`. */
  id: string
  kind: 'tapri' | 'bench'
  at: Vec2
  /** Degrees, as on the prop. */
  rot: number
}

export interface Pose {
  x: number
  z: number
  /** Radians about y; 0 faces +z. */
  ry: number
}

const isBench = (p: PropSpec): p is PropSpec & { kind: Bench['kind'] } =>
  p.kind === 'tapri' || p.kind === 'bench'

/** Every place to sit in a district, in the order the server numbers them. */
export function benchesOf(def: DistrictDef): Bench[] {
  return def.props
    .filter(isBench)
    .map((p, n) => ({ id: `${def.id}:${n}`, kind: p.kind, at: p.at, rot: p.rot ?? 0 }))
}

/** The bench nearest `pos` within `range`, or null. */
export function nearestBench(pos: Vec2, benches: readonly Bench[], range = BENCH_RANGE): Bench | null {
  let best: Bench | null = null
  let bestD = range
  for (let i = 0; i < benches.length; i++) {
    const b = benches[i]!
    const d = Math.hypot(b.at.x - pos.x, b.at.z - pos.z)
    if (d <= bestD) {
      best = b
      bestD = d
    }
  }
  return best
}

/**
 * Seats, in the prop's own frame (+z is its front): a row along the front, a step clear of it. On a bench you
 * sit with your back to it, looking out; at a tapri you stand at the counter, facing the chaiwala.
 */
const ROW: Record<Bench['kind'], { gap: number; out: number; facing: number }> = {
  bench: { gap: 0.5, out: 0.8, facing: 0 },
  tapri: { gap: 0.6, out: 1.3, facing: Math.PI },
}

/** Where seat `n` (0 to BENCH_SEATS - 1) of `bench` puts its sitter, and which way they face. */
export function seatPose(bench: Bench, n: number): Pose {
  const { gap, out, facing } = ROW[bench.kind]
  const lx = (n - (BENCH_SEATS - 1) / 2) * gap
  // The same turn the prop is drawn with: `rot` degrees, clockwise seen from above (90 sends +z to -x).
  const a = (-bench.rot * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const ry = a + facing
  return {
    x: bench.at.x + lx * c + out * s,
    z: bench.at.z - lx * s + out * c,
    ry: Math.atan2(Math.sin(ry), Math.cos(ry)),
  }
}

/** Why a sit or a line was turned down: the server's `error` codes that concern benches. */
export type BenchRefusal = 'ghost' | 'full' | 'far' | 'invalid' | 'rate' | 'muted' | 'words'

/** Where the player sits, as the server last said: the bench, their seat and the others' first names. */
export interface BenchSeat {
  bench: Bench
  seat: number
  with: string[]
}

/** What the sitting system tells React. Each is called only when its news changes. */
export interface BenchHooks {
  /** The bench in reach (whether or not the player sits there), or null. */
  near(bench: Bench | null): void
  /** The player sat down, someone joined or left their bench, or (null) they stood up. */
  seated(seat: BenchSeat | null): void
  /** A line said at the player's bench, theirs included. */
  line(line: BenchLine): void
  refused(code: BenchRefusal): void
}

export interface Sitting {
  /** Every frame: which bench is in reach, and walking off stands the player up. */
  update(pos: Vec2): void
  /** The district socket's news: `seated`, `bench`, and errors that answer a sit or a line. */
  apply(m: ServerMsg): void
  /** A new socket starts standing (the server stood the old one up). */
  reset(): void
  near(): boolean
  seated(): boolean
  /** Asks to sit at the bench in reach. Nothing moves until the server answers. */
  sit(): void
  stand(): void
  /** E: sits, or stands when seated. */
  toggle(): void
  /** Sends a line to the bench; false when there is nothing to send or nowhere to send it. */
  say(text: string): boolean
  dispose(): void
}

/**
 * Sitting at tapris and benches. The server decides: a sit is a request, and only its `seated` answer moves
 * the player onto their seat. Standing up is the player's own doing (Utho, E, walking off, leaving).
 */
export function createSitting(opts: {
  def: DistrictDef
  player: { position(): Vec2; teleport(x: number, z: number, ry?: number): void }
  hooks: BenchHooks
  send(m: ClientMsg): void
}): Sitting {
  const { player, hooks, send } = opts
  const benches = benchesOf(opts.def)
  const byId = new Map(benches.map((b) => [b.id, b]))
  let near: Bench | null = null
  let seat: BenchSeat | null = null
  /** A sit sent and not yet answered. */
  let asked = false

  const standHere = () => {
    if (!seat) return
    seat = null
    hooks.seated(null)
  }
  const stand = () => {
    if (!seat && !asked) return
    asked = false
    send({ t: 'sit', bench: null })
    standHere()
  }
  const sit = () => {
    if (!near || asked || seat?.bench === near) return
    asked = true
    send({ t: 'sit', bench: near.id })
  }
  const away = (b: Bench, pos: Vec2) => Math.hypot(pos.x - b.at.x, pos.z - b.at.z) > BENCH_RANGE

  return {
    update(pos) {
      if (seat && away(seat.bench, pos)) stand()
      const next = nearestBench(pos, benches)
      if (next !== near) hooks.near((near = next))
    },
    apply(m) {
      if (m.t === 'seated') {
        asked = false
        const bench = m.bench === null ? undefined : byId.get(m.bench)
        if (!bench || m.seat === null) return standHere()
        // an answer that comes after the player walked off is turned down
        if (away(bench, player.position())) return stand()
        if (seat?.bench !== bench || seat.seat !== m.seat) {
          const pose = seatPose(bench, m.seat)
          player.teleport(pose.x, pose.z, pose.ry)
        }
        seat = { bench, seat: m.seat, with: m.with }
        hooks.seated(seat)
      } else if (m.t === 'bench') {
        if (seat && m.bench === seat.bench.id)
          hooks.line({ from: m.from, name: m.name, text: m.text, at: m.at })
      } else if (m.t === 'error' && m.code !== 'too-fast') {
        if (asked && m.code !== 'rate') {
          asked = false
          hooks.refused(m.code)
        } else if (seat && (m.code === 'rate' || m.code === 'muted' || m.code === 'words'))
          hooks.refused(m.code)
      }
    },
    reset() {
      asked = false
      standHere()
    },
    near: () => near !== null,
    seated: () => seat !== null,
    sit,
    stand,
    toggle: () => (seat ? stand() : sit()),
    say(text) {
      const line = text.trim()
      if (!seat || !line) return false
      send({ t: 'say', text: line })
      return true
    },
    dispose() {
      standHere()
      if (near) hooks.near((near = null))
    },
  }
}
