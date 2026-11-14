import { DurableObject } from 'cloudflare:workers'
import type { DistrictDO } from './district'
import type { Env } from './env'
import { ipWindowLimit } from './limits'
import type { DistrictId } from './protocol'

/** The one gate for the whole city. */
export const GATE_NAME = 'global'
/** How many residents may be seen at once across every district, unless `MAX_LIVE` says. */
export const DEFAULT_MAX_LIVE = 300
/**
 * A person's slot outlives their last resident socket by this long: a reload, or a metro ride (the old
 * district's socket closes before the next one opens), takes it straight back. Only then is it free.
 */
export const HOLD_MS = 20_000
/** A slot or a place in line that no district has confirmed for this long is let go (a crashed district). */
export const STALE_MS = 2 * 60_000
/** Someone in line with no live socket for this long loses their place. */
export const QUEUE_DROP_MS = 10 * 60_000
/** While anything is held, the alarm comes round at least this often. */
export const SWEEP_MS = 60_000

export type Admit = { ok: true } | { ok: false; position: number }
/** A heartbeat's answer: each waiting person's position, and those of them who hold a slot after all. */
export interface Heartbeat {
  places: Record<string, number>
  admit: string[]
}

/** `MAX_LIVE` + 10%: as far as a fresh invite may go past the cap. */
export const skipCeiling = (cap: number) => Math.floor(cap * 1.1)

/**
 * The city's cap on residents (`MAX_LIVE`), across all four districts. A district asks `admit` before anyone
 * sees a resident, and calls `release` when that person's last resident socket there closes. One person is one
 * slot however many tabs or districts they have open: slots are kept per (person, district), so a person
 * moving between districts is counted once, and the slot outlives the last of them by `HOLD_MS`.
 *
 * Over the cap, a person waits in line, ordered by when they first asked and keyed by their id, so a reload
 * keeps the place. Their socket stays open as a ghost meanwhile. When a slot frees, the first in line with a
 * live socket is let in: the gate tells their district (`promote`), and that socket becomes a resident. Anyone
 * whose position changed is told (`place`).
 *
 * Everything lives in this object's SQLite storage, so it survives hibernation and eviction. Districts vouch
 * for the people they hold on every alarm (`heartbeat`); a slot nobody has vouched for in `STALE_MS` (a
 * district that crashed, or was evicted, without its releases) is let go by this object's own alarm.
 */
export class GateDO extends DurableObject<Env> {
  /** Now, in ms. A test swaps it to step past a hold, or a sweep, without waiting. */
  clock: () => number = Date.now
  private sql: SqlStorage
  private districts = new Map<string, DurableObjectStub<DistrictDO>>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    // `district` '' is a hold: the person's last resident socket closed at `seen`.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS slots (
        user_id TEXT NOT NULL, district TEXT NOT NULL, seen INTEGER NOT NULL, PRIMARY KEY (user_id, district));
      CREATE TABLE IF NOT EXISTS queue (
        user_id TEXT PRIMARY KEY, asked_at INTEGER NOT NULL, district TEXT, seen INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS queue_order ON queue (asked_at, user_id);
      CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v INTEGER);
    `)
  }

  /** The cap: a dev override (see `configure`), else `MAX_LIVE`, else `DEFAULT_MAX_LIVE`. */
  private cap(): number {
    const row = this.sql.exec<{ v: number }>("SELECT v FROM config WHERE k = 'max_live'").toArray()[0]
    if (row) return row.v
    const n = Number(this.env.MAX_LIVE)
    return this.env.MAX_LIVE && Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_LIVE
  }

  /** How many people hold a slot (held ones included). */
  count(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(DISTINCT user_id) AS n FROM slots').one().n
  }

  /** For the admin page: who holds a slot, and how many wait. */
  stats(): { live: number; queue: number } {
    return {
      live: this.count(),
      queue: this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM queue').one().n,
    }
  }

  /**
   * May `userId`, connecting to `district`, be seen? Yes when they already hold a slot (another district, a
   * tab, a hold), or when there is room left after everyone waiting (with a live socket) ahead of them. `skip`
   * (an invite redeemed in the last 24 hours) lets them past the line and the cap, up to `skipCeiling`.
   * Otherwise they wait in line, where they stand already or at the back, and are told their position.
   */
  admit(userId: string, district: string, skip = false): Admit {
    const now = this.clock()
    if (this.holds(userId)) {
      this.sql.exec("DELETE FROM slots WHERE user_id = ? AND district = ''", userId)
      this.sql.exec('DELETE FROM queue WHERE user_id = ?', userId)
      this.take(userId, district, now)
      return { ok: true }
    }
    const cap = this.cap()
    const live = this.count()
    const mine = this.sql
      .exec<{ asked_at: number }>('SELECT asked_at FROM queue WHERE user_id = ?', userId)
      .toArray()[0]
    const ahead = this.sql
      .exec<{ n: number }>(
        `SELECT COUNT(*) AS n FROM queue WHERE district IS NOT NULL AND seen >= ? AND user_id != ?
         AND (?3 IS NULL OR asked_at < ?3 OR (asked_at = ?3 AND user_id < ?2))`,
        now - STALE_MS,
        userId,
        mine?.asked_at ?? null,
      )
      .one().n
    if (live + ahead < cap || (skip && live < skipCeiling(cap))) {
      this.take(userId, district, now)
      if (mine) {
        this.sql.exec('DELETE FROM queue WHERE user_id = ?', userId)
        this.ctx.waitUntil(this.tellPlaces())
      }
      return { ok: true }
    }
    if (mine)
      this.sql.exec('UPDATE queue SET district = ?, seen = ? WHERE user_id = ?', district, now, userId)
    else
      this.sql.exec(
        'INSERT INTO queue (user_id, asked_at, district, seen) VALUES (?, ?, ?, ?)',
        userId,
        now,
        district,
        now,
      )
    this.ctx.waitUntil(this.schedule())
    return { ok: false, position: this.positions().get(userId)! }
  }

  /**
   * `userId`'s last resident (or waiting) socket in `district` closed. Their slot there goes; if it was their
   * last, it is held for `HOLD_MS` and then freed. Someone waiting keeps their place, away, for
   * `QUEUE_DROP_MS`. Calling it again changes nothing.
   */
  release(userId: string, district: string): void {
    const now = this.clock()
    const gone = this.run('DELETE FROM slots WHERE user_id = ? AND district = ?', userId, district)
    if (gone > 0 && !this.holds(userId))
      this.sql.exec("INSERT INTO slots (user_id, district, seen) VALUES (?, '', ?)", userId, now)
    this.sql.exec(
      'UPDATE queue SET district = NULL, seen = ? WHERE user_id = ? AND district = ?',
      now,
      userId,
      district,
    )
    this.ctx.waitUntil(this.schedule())
  }

  /**
   * From each district's alarm: who it holds as residents (`residents`) and who waits there (`waiting`), so
   * neither is swept as stale. Answers where each of those waiting stands, and which of them hold a slot
   * already (let in at another district, or in another tab) and so may be seen here too.
   */
  heartbeat(district: string, residents: string[], waiting: string[]): Heartbeat {
    const now = this.clock()
    const admit: string[] = []
    for (const id of residents) this.take(id, district, now)
    for (const id of waiting) {
      if (this.holds(id)) {
        this.take(id, district, now)
        admit.push(id)
        continue
      }
      // Someone the gate lost track of (a dev reset) goes to the back.
      this.sql.exec(
        `INSERT INTO queue (user_id, asked_at, district, seen) VALUES (?1, ?2, ?3, ?2)
         ON CONFLICT (user_id) DO UPDATE SET district = ?3, seen = ?2`,
        id,
        now,
        district,
      )
    }
    // Anyone vouched for is live: no hold of theirs runs out.
    for (const id of [...residents, ...admit])
      this.sql.exec("DELETE FROM slots WHERE user_id = ? AND district = ''", id)
    this.ctx.waitUntil(this.schedule())
    const at = this.positions()
    const places: Record<string, number> = {}
    for (const id of waiting) if (at.has(id)) places[id] = at.get(id)!
    return { places, admit }
  }

  /**
   * DEV_AUTH only (`POST /api/dev/gate`): sets the cap (null: back to `MAX_LIVE`) and, with `clear`, forgets
   * every slot and the whole line. For tests, which share this one object.
   */
  configure({ maxLive, clear }: { maxLive: number | null; clear?: boolean }): {
    live: number
    queue: number
  } {
    if (maxLive === null) this.sql.exec("DELETE FROM config WHERE k = 'max_live'")
    else this.sql.exec("INSERT OR REPLACE INTO config (k, v) VALUES ('max_live', ?)", maxLive)
    if (clear) this.sql.exec('DELETE FROM slots; DELETE FROM queue')
    return this.stats()
  }

  /**
   * Lets go of holds past `HOLD_MS`, slots no district has confirmed for `STALE_MS`, and anyone in line with no
   * live socket for `QUEUE_DROP_MS`; then lets in as many as there is room for.
   */
  async alarm(): Promise<void> {
    const now = this.clock()
    this.sql.exec("DELETE FROM slots WHERE district = '' AND seen <= ?", now - HOLD_MS)
    this.sql.exec("DELETE FROM slots WHERE district != '' AND seen < ?", now - STALE_MS)
    // A waiting socket nobody has vouched for is as good as gone: away since it was last heard of.
    this.sql.exec('UPDATE queue SET district = NULL WHERE district IS NOT NULL AND seen < ?', now - STALE_MS)
    const dropped = this.run('DELETE FROM queue WHERE district IS NULL AND seen < ?', now - QUEUE_DROP_MS)
    const promoted = await this.promote()
    if (promoted || dropped) await this.tellPlaces()
    await this.schedule()
  }

  /** Lets the first in line with a live socket in while there is room. Answers how many got in. */
  private async promote(): Promise<number> {
    let n = 0
    for (;;) {
      const now = this.clock()
      if (this.count() >= this.cap()) return n
      const next = this.firstLive(now)
      if (!next) return n
      // The slot is theirs before the district is asked, so nothing else can take it meanwhile.
      this.sql.exec('DELETE FROM queue WHERE user_id = ?', next.user_id)
      this.take(next.user_id, next.district, now)
      let ok = false
      try {
        ok = await this.district(next.district).promote(next.user_id)
      } catch (err) {
        console.error('gate: promote failed', err)
      }
      if (ok) {
        n++
        continue
      }
      // Their socket had gone (or the district could not be reached): back in line, away, in the same place.
      this.sql.exec('DELETE FROM slots WHERE user_id = ? AND district = ?', next.user_id, next.district)
      if (!this.holds(next.user_id))
        this.sql.exec(
          'INSERT OR IGNORE INTO queue (user_id, asked_at, district, seen) VALUES (?, ?, NULL, ?)',
          next.user_id,
          next.asked_at,
          this.clock(),
        )
    }
  }

  /** Tells every district with someone waiting there where each of them now stands. */
  private async tellPlaces(): Promise<void> {
    const at = this.positions()
    const by = new Map<string, Record<string, number>>()
    for (const { user_id, district } of this.sql
      .exec<{ user_id: string; district: string }>(
        'SELECT user_id, district FROM queue WHERE district IS NOT NULL',
      )
      .toArray()) {
      const list = by.get(district) ?? {}
      list[user_id] = at.get(user_id)!
      by.set(district, list)
    }
    const sent = await Promise.allSettled([...by].map(([d, list]) => this.district(d).place(list)))
    for (const s of sent) if (s.status === 'rejected') console.error('gate: place failed', s.reason)
  }

  /** The first in line with a live socket (one a district has vouched for within `STALE_MS`). */
  private firstLive(now: number): { user_id: string; asked_at: number; district: string } | undefined {
    return this.sql
      .exec<{ user_id: string; asked_at: number; district: string }>(
        `SELECT user_id, asked_at, district FROM queue WHERE district IS NOT NULL AND seen >= ?
         ORDER BY asked_at, user_id LIMIT 1`,
        now - STALE_MS,
      )
      .toArray()[0]
  }

  /** Everyone in line, by position (1 is next), away or not: a place is kept while away. */
  private positions(): Map<string, number> {
    const out = new Map<string, number>()
    for (const { user_id } of this.sql
      .exec<{ user_id: string }>('SELECT user_id FROM queue ORDER BY asked_at, user_id')
      .toArray())
      out.set(user_id, out.size + 1)
    return out
  }

  /** Runs a write; answers how many rows it changed. */
  private run(query: string, ...args: SqlStorageValue[]): number {
    const cursor = this.sql.exec(query, ...args)
    cursor.toArray()
    return cursor.rowsWritten
  }

  private holds(userId: string): boolean {
    return this.sql.exec('SELECT 1 FROM slots WHERE user_id = ? LIMIT 1', userId).toArray().length > 0
  }

  private take(userId: string, district: string, now: number): void {
    this.sql.exec(
      `INSERT INTO slots (user_id, district, seen) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id, district) DO UPDATE SET seen = ?3`,
      userId,
      district,
      now,
    )
  }

  /**
   * Keeps the alarm set while anything is held: for the earliest hold's end, at once when there is room and
   * someone waiting, and otherwise within `SWEEP_MS` for the stale sweep.
   */
  private async schedule(): Promise<void> {
    const now = this.clock()
    const any = this.sql.exec('SELECT 1 FROM slots UNION ALL SELECT 1 FROM queue LIMIT 1').toArray().length
    if (!any) return
    let next = now + SWEEP_MS
    const hold = this.sql
      .exec<{ at: number | null }>("SELECT MIN(seen) AS at FROM slots WHERE district = ''")
      .one().at
    if (hold !== null) next = Math.min(next, hold + HOLD_MS)
    // Room, and someone there to take it (the cap went up, or a promotion fell through): now.
    if (this.count() < this.cap() && this.firstLive(now)) next = now
    const set = await this.ctx.storage.getAlarm()
    if (set === null || set > next) await this.ctx.storage.setAlarm(next)
  }

  private district(id: string) {
    let stub = this.districts.get(id)
    if (!stub) {
      stub = this.env.DISTRICT.get(this.env.DISTRICT.idFromName(id as DistrictId))
      this.districts.set(id, stub)
    }
    return stub
  }
}

/** The longest email address there can be (RFC 5321's path limit). */
export const MAX_EMAIL = 254
/** RFC-ish: something@something.tld, of the characters an address may hold, with no spaces. */
const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
/** Waitlist sign-ups per address: 5 an hour, counted in D1 (see `ipWindowLimit`). */
export const WAITLIST_IP_LIMIT = { perWindow: 5, windowMs: 3600_000, bucket: 'waitlist-ip' } as const

/** The address `raw` means, trimmed and lowercased, or null when it is not one. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return email.length <= MAX_EMAIL && EMAIL.test(email) ? email : null
}

/**
 * `POST /api/waitlist {email}`: no sign-in (someone turned away as a ghost may have no account). Stored once;
 * listed already or not, the answer is the same 204, so it never says who is on the list. No email is sent:
 * the owner tells people from the admin page's CSV.
 */
export async function joinWaitlist(env: Env, request: Request, raw: unknown): Promise<Response> {
  const slow = await ipWindowLimit(env, request, WAITLIST_IP_LIMIT)
  if (slow) return slow
  const email = cleanEmail((raw as { email?: unknown } | null)?.email)
  if (!email) return Response.json({ error: 'invalid' }, { status: 400 })
  await env.DB.prepare('INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?, ?)')
    .bind(email, Date.now())
    .run()
  return new Response(null, { status: 204 })
}
