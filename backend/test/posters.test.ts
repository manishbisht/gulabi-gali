import { applyD1Migrations, env, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/env'
import { DAY_MS } from '../src/limits'
import { listPosters, pinPoster, POSTER_BUCKET, POSTERS_PER_DAY, purgePosters } from '../src/posters'
import { refreshUser } from '../src/refresh'
import { windowStart } from '../src/limits'
import { POSTER_SLOTS, type PosterView } from '../src/protocol'
import { api, devId, live, login, resident, settle, type LiveClient } from './helpers'

// Placeholder tokens only: no real slur appears in any test.
vi.mock('../src/filter/words', () => ({ WORDS: ['badword', 'ganda'], NAME_SAFE: [] }))

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const db = testEnv.DB
const API = 'https://api.test'
const HOUR = 3600_000

beforeAll(async () => {
  await applyD1Migrations(db, testEnv.TEST_MIGRATIONS)
})
// Each test starts with bare walls: six slots go fast.
beforeEach(async () => {
  await db.prepare('DELETE FROM posters').run()
})
afterEach(() => settle())

const PLAN = 'Gully cricket, Sunday 7am, Central Park'
const pin = (token: string, body: Record<string, unknown>) =>
  api('/api/posters', token, {
    method: 'POST',
    body: JSON.stringify({ district: 'university', wall: 0, text: PLAN, ...body }),
  })
/** The public list, signed out (or as `token`). */
const wall = (district: string, token?: string) =>
  SELF.fetch(`${API}/api/districts/${district}/posters`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
const listed = async (district: string, token?: string) =>
  (await (await wall(district, token)).json()) as PosterView[]
const count = async (sql: string, ...args: unknown[]) =>
  (await db
    .prepare(sql)
    .bind(...args)
    .first<{ n: number }>())!.n
const sql = (q: string, ...args: unknown[]) =>
  db
    .prepare(q)
    .bind(...args)
    .run()
/** A poster straight from the function, at a moment of the test's choosing. */
const pinAt = async (userId: string, now: number, body: Record<string, unknown> = {}) =>
  pinPoster(testEnv, userId, { district: 'mi-road', wall: 0, text: PLAN, ...body }, undefined, now)
const ageAccount = (id: string, days: number) =>
  sql('UPDATE users SET created_at = ? WHERE id = ?', Date.now() - days * DAY_MS, id)
const report = (token: string, posterId: string) =>
  api('/api/reports', token, {
    method: 'POST',
    body: JSON.stringify({ kind: 'poster', targetId: posterId, reason: 'spam' }),
  })
const asOwner = async (path: string, init: RequestInit = {}) => api(path, await login('Owner'), init)

describe('posters', () => {
  it('verified can pin, residents cannot', async () => {
    const verified = await resident('Pin Verified Vimla')
    const plain = await resident('Pin Resident Ramesh', {}, { verified: false })
    const ghost = await login('Pin Ghost Gopal')

    const res = await pin(verified, {})
    expect(res.status).toBe(201)
    const made = (await res.json()) as PosterView
    expect(made).toMatchObject({ wall: 0, text: PLAN, when: null, name: 'Pin', mine: true })
    expect(made.slot).toBeGreaterThanOrEqual(0)

    expect(await (await pin(plain, {})).json()).toEqual({ error: 'not-verified' })
    expect((await pin(plain, {})).status).toBe(403)
    expect(await (await pin(ghost, {})).json()).toEqual({ error: 'ghost' })
    expect((await SELF.fetch(`${API}/api/posters`, { method: 'POST', body: '{}' })).status).toBe(401)

    // Muted and hidden people cannot pin either, verified or not.
    const muted = await resident('Pin Muted Mohan')
    await sql('UPDATE users SET muted_until = ? WHERE id = ?', Date.now() + HOUR, devId('Pin Muted Mohan'))
    expect(await (await pin(muted, {})).json()).toMatchObject({ error: 'muted' })
    const hidden = await resident('Pin Hidden Hema')
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', devId('Pin Hidden Hema'))
    expect(await (await pin(hidden, {})).json()).toEqual({ error: 'ghost' })

    // Bad places are 400s: an unknown district, a wall that district does not have.
    expect((await pin(verified, { district: 'jaisalmer' })).status).toBe(400)
    expect((await pin(verified, { wall: 1 })).status).toBe(400)
    expect((await pin(verified, { wall: -1 })).status).toBe(400)
    expect((await pin(verified, { wall: 0.5 })).status).toBe(400)
    expect(
      await count('SELECT COUNT(*) AS n FROM posters WHERE owner = ?', devId('Pin Verified Vimla')),
    ).toBe(1)
  })

  it('max 2 live per person, and 5 pins a day', async () => {
    const token = await resident('Two Live Tanvi')
    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
      const res = await pin(token, { text: `${PLAN} ${i}` })
      expect(res.status).toBe(201)
      ids.push(((await res.json()) as PosterView).id)
    }
    const third = await pin(token, { text: `${PLAN} 3` })
    expect(third.status).toBe(409)
    expect(await third.json()).toEqual({ error: 'limit' })

    // Taking one down makes room; someone else's is not yours to take down.
    const other = await resident('Two Live Other')
    expect((await api(`/api/posters/${ids[0]}`, other, { method: 'DELETE' })).status).toBe(404)
    expect((await api(`/api/posters/${ids[0]}`, token, { method: 'DELETE' })).status).toBe(204)
    expect((await api(`/api/posters/${ids[0]}`, token, { method: 'DELETE' })).status).toBe(404)
    expect((await pin(token, { text: `${PLAN} 4` })).status).toBe(201)

    // The day's allowance counts every pin: 5, then 429 however many come down.
    const id = devId('Two Live Tanvi')
    const now = Date.now()
    await sql('DELETE FROM posters WHERE owner = ?', id)
    for (let i = 0; i < POSTERS_PER_DAY - 3; i++) {
      const res = await pinAt(id, now)
      expect(res.status).toBe(201)
      await sql('DELETE FROM posters WHERE id = ?', ((await res.json()) as PosterView).id)
    }
    const over = await pinAt(id, now)
    expect(over.status).toBe(429)
    expect(over.headers.get('Retry-After')).not.toBeNull()
  })

  it('past when rejected; 30 days inclusive', async () => {
    await resident('When Waman')
    const id = devId('When Waman')
    const now = Date.now()
    const at = (when: unknown) => pinAt(id, now, { when })
    for (const when of [now - 1, now, now - DAY_MS, now + 30 * DAY_MS + 1, now + 1.5, '1700000000000', NaN]) {
      const res = await at(when)
      expect(res.status, String(when)).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid', field: 'when' })
    }
    const edge = await at(now + 30 * DAY_MS)
    expect(edge.status).toBe(201)
    expect(((await edge.json()) as PosterView).when).toBe(now + 30 * DAY_MS)
    const soon = await at(now + 1)
    expect(soon.status).toBe(201)
    // Left out or null: no time on it.
    await sql('DELETE FROM posters WHERE owner = ?', id)
    expect(((await (await at(null)).json()) as PosterView).when).toBeNull()
  })

  it('expiry hides', async () => {
    await resident('Expiry Esha')
    const id = devId('Expiry Esha')
    const now = Date.now()
    const timed = (await (
      await pinAt(id, now, { when: now + HOUR, text: 'Chai at six, Raja Park' })
    ).json()) as PosterView
    const plain = (await (await pinAt(id, now, { text: 'Sketching meetup, any day' })).json()) as PosterView
    const shown = async (at: number) =>
      ((await (await listPosters(testEnv, 'mi-road', null, at)).json()) as PosterView[]).map((p) => p.id)

    // `when + 6h` for the one with a time, 7 days for the one without.
    expect(await shown(now + 7 * HOUR - 1)).toEqual(expect.arrayContaining([timed.id, plain.id]))
    expect(await shown(now + 7 * HOUR)).not.toContain(timed.id)
    expect(await shown(now + 7 * HOUR)).toContain(plain.id)
    expect(await shown(now + 7 * DAY_MS)).not.toContain(plain.id)

    // While listed as gone, they still count until the cron sweeps them; then they are deleted.
    await purgePosters(testEnv, now + 7 * HOUR)
    expect(await count('SELECT COUNT(*) AS n FROM posters WHERE id = ?', timed.id)).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM posters WHERE id = ?', plain.id)).toBe(1)
    // An expired poster no longer counts toward the two live.
    await sql('UPDATE posters SET expires_at = ? WHERE id = ?', now - 1, plain.id)
    expect((await pinAt(id, now, { text: 'Third one, after expiry' })).status).toBe(201)
    expect((await pinAt(id, now, { text: 'Fourth one, still fine' })).status).toBe(201)
  })

  it('filter applies', async () => {
    const token = await resident('Filter Poster Pari')
    const res = await pin(token, { text: 'Come play, you b4dword people' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'words', field: 'text' })
    // Too short, too long (in characters, after the clean), or not text: invalid.
    for (const text of ['short', 'x'.repeat(141), 42, '   chai     ']) {
      const bad = await pin(token, { text })
      expect(bad.status, String(text)).toBe(400)
      expect(await bad.json()).toEqual({ error: 'invalid', field: 'text' })
    }
    // Cleaned to one line: control characters and runs of space go; 140 emoji is 140 characters.
    const ok = await pin(token, { text: '  Gandalf  marathon\n\ntonight‮  ' })
    expect(ok.status).toBe(201)
    expect(((await ok.json()) as PosterView).text).toBe('Gandalf marathon tonight')
    expect((await pin(token, { text: '🪁'.repeat(140), wall: 0 })).status).toBe(201)
  })

  it('full wall replaces oldest, never your own', async () => {
    const names = ['Full Anil', 'Full Bina', 'Full Chetan', 'Full Dolly']
    for (const n of names) await resident(n)
    const [a, b, c, d] = names.map(devId) as [string, string, string, string]
    const now = Date.now()
    const watcher = await live('walled-city')
    watcher.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await watcher.sync()
    const here = { district: 'walled-city', wall: 1 }
    const made: PosterView[] = []
    // Dolly's is the oldest; then two each from Anil and Bina, one from Chetan: the wall is full.
    for (const [who, i] of [
      [d, 0],
      [a, 1],
      [a, 2],
      [b, 3],
      [b, 4],
      [c, 5],
    ] as const) {
      const res = await pinAt(who, now + i, here)
      expect(res.status).toBe(201)
      made.push((await res.json()) as PosterView)
    }
    expect(new Set(made.map((p) => p.slot)).size).toBe(POSTER_SLOTS)
    const from = watcher.mark()
    // Dolly pins again: her own is the oldest, so Anil's first goes, and hers takes its slot.
    const res = await pinAt(d, now + 10, { ...here, text: 'Second plan from Dolly' })
    expect(res.status).toBe(201)
    const fresh = (await res.json()) as PosterView
    expect(fresh.slot).toBe(made[1]!.slot)
    const ids = (await listed('walled-city')).filter((p) => p.wall === 1).map((p) => p.id)
    expect(ids).toHaveLength(POSTER_SLOTS)
    expect(ids).not.toContain(made[1]!.id)
    expect(ids).toEqual(expect.arrayContaining([made[0]!.id, fresh.id]))
    // Everyone in the district hears the one go and the other arrive, with no owner id on it.
    await watcher.next('poster', (m) => m.op === 'remove' && m.id === made[1]!.id, from)
    const added = await watcher.next('poster', (m) => m.op === 'add' && m.poster.id === fresh.id, from)
    expect(JSON.stringify(added)).not.toContain(d)
    expect(added).toEqual({ t: 'poster', op: 'add', poster: { ...fresh, mine: undefined } })
  })

  it('public list exposes first name only', async () => {
    const token = await resident('Public Priyanka Sharma')
    expect((await pin(token, { district: 'walled-city', wall: 2, when: Date.now() + HOUR })).status).toBe(201)
    const res = await wall('walled-city')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=30')
    const mine = (await res.json()) as Record<string, unknown>[]
    const poster = mine.find((p) => p.text === PLAN && p.wall === 2)!
    expect(Object.keys(poster).sort()).toEqual(['id', 'name', 'slot', 'text', 'wall', 'when'])
    expect(poster.name).toBe('Public')
    const raw = JSON.stringify(mine)
    expect(raw).not.toContain('Sharma')
    expect(raw).not.toContain(devId('Public Priyanka Sharma'))
    // A signed-in list is that person's own (blocks, `mine`): never cached for anyone else.
    const signed = await wall('walled-city', token)
    expect(signed.headers.get('cache-control')).toBe('private, no-store')
    expect(((await signed.json()) as PosterView[]).find((p) => p.id === poster.id)?.mine).toBe(true)
    expect((await wall('jaisalmer')).status).toBe(404)
  })

  it('blocks apply both ways, in the list and in live events', async () => {
    const owner = await resident('Block Poster Om')
    const blocker = await resident('Block Poster Bela')
    const blocked = await resident('Block Poster Kabir')
    const neutral = await resident('Block Poster Nina')
    const ownerId = devId('Block Poster Om')
    await api('/api/blocks', blocker, { method: 'POST', body: JSON.stringify({ id: ownerId }) })
    await api('/api/blocks', owner, {
      method: 'POST',
      body: JSON.stringify({ id: devId('Block Poster Kabir') }),
    })

    const sockets: Record<string, LiveClient> = {}
    for (const [name, token] of Object.entries({ owner, blocker, blocked, neutral, ghost: undefined })) {
      const c = await live('university', { token })
      c.send({ t: 'move', x: 0, z: 0, ry: 0 })
      await c.sync()
      sockets[name] = c
    }
    const res = await pin(owner, { text: 'Board games at the library steps' })
    expect(res.status).toBe(201)
    const poster = (await res.json()) as PosterView
    const added = (c: LiveClient) => c.next('poster', (m) => m.op === 'add' && m.poster.id === poster.id)
    expect((await added(sockets.neutral!)) as unknown).toMatchObject({ poster: { id: poster.id } })
    expect((await added(sockets.ghost!)) as unknown).toMatchObject({ poster: { id: poster.id } })
    expect((await added(sockets.owner!)) as unknown).toMatchObject({ poster: { mine: true } })
    for (const name of ['blocker', 'blocked']) await sockets[name]!.sync()
    expect(sockets.blocker!.all('poster')).toEqual([])
    expect(sockets.blocked!.all('poster')).toEqual([])
    expect(sockets.neutral!.all('poster').every((m) => m.op !== 'add' || m.poster.mine === undefined)).toBe(
      true,
    )

    const ids = async (token?: string) => (await listed('university', token)).map((p) => p.id)
    expect(await ids()).toContain(poster.id)
    expect(await ids(neutral)).toContain(poster.id)
    expect(await ids(blocker)).not.toContain(poster.id)
    expect(await ids(blocked)).not.toContain(poster.id)

    // A block made now tells both sides' sockets to fetch the walls again; unblocking does too.
    const nina = sockets.neutral!.mark()
    const om = sockets.owner!.mark()
    await api('/api/blocks', neutral, { method: 'POST', body: JSON.stringify({ id: ownerId }) })
    await sockets.neutral!.next('posters', undefined, nina)
    await sockets.owner!.next('posters', undefined, om)
    expect(await ids(neutral)).not.toContain(poster.id)
    await api(`/api/blocks/${encodeURIComponent(ownerId)}`, neutral, { method: 'DELETE' })
    expect(await ids(neutral)).toContain(poster.id)

    // Blocking from a poster: the owner's id never leaves the server, the poster's is enough.
    const fresh = await resident('Block Poster Farah')
    expect(await ids(fresh)).toContain(poster.id)
    const by = await api('/api/blocks', fresh, {
      method: 'POST',
      body: JSON.stringify({ poster: poster.id }),
    })
    expect(by.status).toBe(204)
    expect(await ids(fresh)).not.toContain(poster.id)
    const list = (await (await api('/api/blocks', fresh)).json()) as { id: string; name: string }[]
    expect(list).toEqual([{ id: ownerId, name: 'Block' }])
  })

  it('auto-hide needs 3 verified reporters, a week old, whom the owner has not blocked', async () => {
    const owner = await resident('Hide Poster Harsh')
    const ownerId = devId('Hide Poster Harsh')
    const poster = (await (await pin(owner, { text: 'Cheap phones, DM me now' })).json()) as PosterView
    const watcher = await live('university')
    watcher.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await watcher.sync()

    // None of these count: a resident, a verified account a day old, and one the owner blocked.
    const plain = await resident('Hide Reporter Plain', {}, { verified: false })
    const young = await resident('Hide Reporter Young')
    const shut = await resident('Hide Reporter Shut')
    for (const n of ['Hide Reporter Plain', 'Hide Reporter Shut']) await ageAccount(devId(n), 30)
    await ageAccount(devId('Hide Reporter Young'), 1)
    await api('/api/blocks', owner, {
      method: 'POST',
      body: JSON.stringify({ id: devId('Hide Reporter Shut') }),
    })
    for (const token of [plain, young, shut]) {
      const res = await report(token, poster.id)
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({ autoHidden: false })
    }
    // Two that count, then a repeat from one of them: still two.
    const counted: string[] = []
    for (const n of ['Hide Reporter One', 'Hide Reporter Two', 'Hide Reporter Three']) {
      counted.push(await resident(n))
      await ageAccount(devId(n), 8)
    }
    for (const token of [counted[0]!, counted[1]!, counted[1]!])
      expect(await (await report(token, poster.id)).json()).toEqual({ autoHidden: false })
    expect((await listed('university')).map((p) => p.id)).toContain(poster.id)

    // The third distinct one hides it: off the list, and off every wall in the district at once.
    const from = watcher.mark()
    expect(await (await report(counted[2]!, poster.id)).json()).toEqual({ autoHidden: true })
    expect((await listed('university')).map((p) => p.id)).not.toContain(poster.id)
    await watcher.next('poster', (m) => m.op === 'remove' && m.id === poster.id, from)

    // The person is not hidden for it: poster reports never count toward a person's auto-hide.
    expect(await count('SELECT hidden AS n FROM users WHERE id = ?', ownerId)).toBe(0)
    expect(await (await pin(owner, { text: 'A different plan entirely' })).json()).toMatchObject({
      text: 'A different plan entirely',
    })
    // Every one of those reports is about the owner, with the poster as evidence, in the queue under them.
    const rows = (
      await db
        .prepare(
          "SELECT target_id, poster_id, evidence FROM reports WHERE target_kind = 'poster' AND poster_id = ?",
        )
        .bind(poster.id)
        .all<{ target_id: string; poster_id: string; evidence: string }>()
    ).results
    expect(rows).toHaveLength(6)
    for (const r of rows) {
      expect(r.target_id).toBe(ownerId)
      expect(JSON.parse(r.evidence)).toEqual({
        poster: {
          id: poster.id,
          district: 'university',
          wall: 0,
          text: 'Cheap phones, DM me now',
          when: null,
        },
      })
    }
    const queue = (await (await asOwner('/api/admin/reports?state=open')).json()) as {
      reports: { kind: string; target: { id: string }; evidence: unknown }[]
    }
    const mine = queue.reports.filter((r) => r.kind === 'poster')
    expect(mine).toHaveLength(6)
    expect(mine.every((r) => r.target.id === ownerId)).toBe(true)
    expect(mine.find((r) => r.target.id === ownerId)!.evidence).toEqual({
      kind: 'poster',
      posterId: poster.id,
      district: 'university',
      wall: 0,
      text: 'Cheap phones, DM me now',
      when: null,
    })

    // A poster that is gone, or your own, cannot be reported.
    expect((await report(counted[0]!, 'no-such-poster')).status).toBe(404)
    const own = (await (await pin(counted[0]!, { text: 'My own little plan here' })).json()) as PosterView
    expect((await report(counted[0]!, own.id)).status).toBe(400)
  })

  it('an admin takes a poster down, closing its reports; a ban takes all of theirs', async () => {
    const owner = await resident('Admin Poster Arun')
    const ownerId = devId('Admin Poster Arun')
    const first = (await (await pin(owner, { text: 'Rooftop jam session Friday' })).json()) as PosterView
    const second = (await (await pin(owner, { text: 'Another rooftop jam session' })).json()) as PosterView
    const reporter = await resident('Admin Poster Reporter')
    expect((await report(reporter, first.id)).status).toBe(201)
    const watcher = await live('university')
    watcher.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await watcher.sync()

    const res = await asOwner(`/api/admin/posters/${first.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: first.id, removed: true, closed: 1 })
    await watcher.next('poster', (m) => m.op === 'remove' && m.id === first.id)
    expect(
      await count("SELECT COUNT(*) AS n FROM reports WHERE poster_id = ? AND state = 'actioned'", first.id),
    ).toBe(1)
    expect((await asOwner(`/api/admin/posters/${first.id}`, { method: 'DELETE' })).status).toBe(404)
    // Not an admin: the same 404 as anything else.
    expect((await api(`/api/admin/posters/${second.id}`, owner, { method: 'DELETE' })).status).toBe(404)

    // A ban takes down everything they have up, and every open report about them (posters too) closes.
    expect((await report(reporter, second.id)).status).toBe(201)
    expect(
      (await asOwner(`/api/admin/users/${encodeURIComponent(ownerId)}/ban`, { method: 'POST' })).status,
    ).toBe(200)
    expect(await count('SELECT COUNT(*) AS n FROM posters WHERE owner = ?', ownerId)).toBe(0)
    await watcher.next('poster', (m) => m.op === 'remove' && m.id === second.id)
    expect(
      await count("SELECT COUNT(*) AS n FROM reports WHERE target_id = ? AND state = 'open'", ownerId),
    ).toBe(0)
  })

  it("a hidden owner's posters come down live everywhere, and go back up when unhidden", async () => {
    const owner = await resident('Hidden Owner Hari')
    const ownerId = devId('Hidden Owner Hari')
    const poster = (await (await pin(owner, { text: 'Kite flying on the roof' })).json()) as PosterView
    // Someone neutral in the district, and nobody of the owner's: the walls still hear it.
    const watcher = await live('university', { token: await resident('Hidden Owner Watcher') })
    watcher.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await watcher.sync()

    let from = watcher.mark()
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', ownerId)
    await refreshUser(testEnv, ownerId, 'hide')
    await watcher.next('poster', (m) => m.op === 'remove' && m.id === poster.id, from)
    expect((await listed('university')).map((p) => p.id)).not.toContain(poster.id)

    from = watcher.mark()
    expect(
      (await asOwner(`/api/admin/users/${encodeURIComponent(ownerId)}/unhide`, { method: 'POST' })).status,
    ).toBe(200)
    const back = await watcher.next('poster', (m) => m.op === 'add' && m.poster.id === poster.id, from)
    expect(back).toEqual({ t: 'poster', op: 'add', poster: { ...poster, mine: undefined } })
    expect((await listed('university')).map((p) => p.id)).toContain(poster.id)
  })

  it('only a pin that goes up is charged against the day', async () => {
    await resident('Charge Chitra')
    const id = devId('Charge Chitra')
    const now = Date.now()
    const used = async () =>
      (
        await db
          .prepare('SELECT n FROM counters WHERE user_id = ? AND bucket = ? AND window_start = ?')
          .bind(id, POSTER_BUCKET, windowStart(now, DAY_MS))
          .first<{ n: number }>()
      )?.n ?? 0
    // Three at once with room for two: two go up, the third is refused, and only two are counted.
    const answers = await Promise.all([0, 1, 2].map((i) => pinAt(id, now, { text: `${PLAN} ${i}` })))
    expect(answers.map((r) => r.status).sort()).toEqual([201, 201, 409])
    expect(await used()).toBe(2)
    // And a plain refusal (two up already) is never counted either.
    expect((await pinAt(id, now)).status).toBe(409)
    expect(await used()).toBe(2)
  })

  it('deleting your account takes your posters down', async () => {
    const token = await resident('Delete Poster Dimple')
    const id = devId('Delete Poster Dimple')
    const poster = (await (await pin(token, { text: 'Last plan before I go' })).json()) as PosterView
    const watcher = await live('university')
    watcher.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await watcher.sync()
    expect((await api('/api/me', token, { method: 'DELETE' })).status).toBe(204)
    expect(await count('SELECT COUNT(*) AS n FROM posters WHERE owner = ?', id)).toBe(0)
    await watcher.next('poster', (m) => m.op === 'remove' && m.id === poster.id)
  })
})
