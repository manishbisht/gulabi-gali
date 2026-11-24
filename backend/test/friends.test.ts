import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BENCH_POSITIONS } from '../src/district'
import type { Env } from '../src/env'
import {
  CHAI_LIMIT,
  FRIEND_ASK_TTL_MS,
  FRIEND_READ_LIMIT,
  listFriends,
  purgeFriends,
  sendChai,
} from '../src/friends'
import type { Later } from '../src/inbox'
import {
  CHAI_TTL_MS,
  type ChaiInviteView,
  type DistrictId,
  type FriendLists,
  type FriendView,
} from '../src/protocol'
import {
  api,
  closeAll,
  devId,
  inbox,
  live,
  login,
  pair,
  resident,
  settle,
  WAIT,
  type LiveClient,
} from './helpers'
import { decryptPayload, publicOf, userAgent } from './pushKit'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const db = testEnv.DB
const SERVER = publicOf(testEnv.VAPID_PRIVATE_JWK!)

beforeAll(async () => {
  await applyD1Migrations(db, testEnv.TEST_MIGRATIONS)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await settle()
})

const sql = (q: string, ...args: unknown[]) =>
  db
    .prepare(q)
    .bind(...args)
    .run()
const count = async (q: string, ...args: unknown[]) =>
  (
    await db
      .prepare(q)
      .bind(...args)
      .first<{ n: number }>()
  )?.n ?? 0

const ask = (token: string, to: string) =>
  api('/api/friends', token, { method: 'POST', body: JSON.stringify({ to }) })
const answer = (token: string, from: string, how: 'accept' | 'decline') =>
  api(`/api/friends/${encodeURIComponent(from)}/${how}`, token, { method: 'POST' })
const unfriend = (token: string, id: string) =>
  api(`/api/friends/${encodeURIComponent(id)}`, token, { method: 'DELETE' })
const settings = (token: string, body: unknown) =>
  api('/api/me/friend-settings', token, { method: 'PUT', body: JSON.stringify(body) })
async function lists(token: string): Promise<FriendLists> {
  const res = await api('/api/friends', token)
  expect(res.status).toBe(200)
  return (await res.json()) as FriendLists
}
async function invites(token: string): Promise<ChaiInviteView[]> {
  const res = await api('/api/chai', token)
  expect(res.status).toBe(200)
  return (await res.json()) as ChaiInviteView[]
}
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort()

/** Two matched residents who are friends now (x asked, y accepted). */
async function friends(x: string, y: string) {
  const p = await pair(x, y)
  expect((await ask(p.a, p.bId)).status).toBe(201)
  const res = await answer(p.b, p.aId, 'accept')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ state: 'friends' })
  return p
}

/** A `later` that keeps the work, so a test can wait for every notice (and push) to be decided. */
function collected() {
  const work: Promise<unknown>[] = []
  const later: Later = (p) => void work.push(p)
  return { later, settled: () => Promise.all(work) }
}

/** `token` sits at bench `n` of `district`, as a resident others can see. */
async function seated(token: string, district: DistrictId, n: number): Promise<LiveClient> {
  const at = BENCH_POSITIONS[district][n]!
  const c = await live(district, { token })
  c.send({ t: 'move', x: at.x + 1, z: at.z, ry: 0 })
  c.send({ t: 'sit', bench: `${district}:${n}` })
  await c.next('seated', (s) => s.bench === `${district}:${n}`)
  return c
}

/** A fake FCM: every push to it lands in `got`. */
function fakePushService() {
  const got: { endpoint: string; body: Uint8Array }[] = []
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.startsWith('https://fcm.googleapis.com/')) return real(input, init)
    got.push({ endpoint: url, body: new Uint8Array(await new Response(init?.body).arrayBuffer()) })
    return new Response(null, { status: 201 })
  })
  return got
}
async function subscribed(token: string, lang: 'hi' | 'en') {
  const ua = await userAgent()
  const endpoint = `https://fcm.googleapis.com/fcm/send/friends-${crypto.randomUUID()}`
  const res = await api('/api/me/push', token, {
    method: 'PUT',
    body: JSON.stringify({ endpoint, keys: ua.keys, lang, server: SERVER }),
  })
  expect(res.status).toBe(204)
  return ua
}

describe('Dost banao: both have to agree', () => {
  it('only someone you are matched with: a stranger, yourself or a ghost cannot be asked', async () => {
    const { a, aId } = await pair('Ask Anu', 'Ask Bina')
    await resident('Ask Stranger')
    const stranger = await ask(a, devId('Ask Stranger'))
    expect(stranger.status).toBe(404)
    expect(await stranger.json()).toEqual({ error: 'not-found' })
    expect((await ask(a, 'dev:nobody-at-all')).status).toBe(404)
    expect((await ask(a, aId)).status).toBe(400)
    expect((await ask(a, '')).status).toBe(400)
    // a signed-in ghost (no profile) has no friends to ask
    const ghost = await login('Ask Ghost')
    const res = await ask(ghost, aId)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'ghost' })
    expect((await api('/api/friends', ghost)).status).toBe(403)
    expect(await count('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id = ?', aId)).toBe(0)
  })

  it('an ask is only an ask: the other side sees it and is told; friends only once they accept', async () => {
    const { a, b, aId, bId } = await pair('Ask Chetan', 'Ask Devi')
    const boxB = await inbox(b)
    const boxA = await inbox(a)
    const res = await ask(a, bId)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ state: 'asked' })
    await boxB.next('friend')
    // asking again changes nothing and tells nobody twice
    expect(await (await ask(a, bId)).json()).toEqual({ state: 'asked' })
    const before = await lists(a)
    expect(before.friends).toEqual([])
    expect(before.sent).toEqual([{ id: bId, name: 'Ask' }])
    const theirs = await lists(b)
    expect(theirs.friends).toEqual([])
    expect(theirs.incoming).toEqual([{ id: aId, name: 'Ask' }])
    // only the one asked can accept
    expect((await answer(a, bId, 'accept')).status).toBe(404)
    expect(await (await answer(b, aId, 'accept')).json()).toEqual({ state: 'friends' })
    await boxA.next('friend')
    expect(ids((await lists(a)).friends)).toEqual([bId])
    expect(ids((await lists(b)).friends)).toEqual([aId])
    expect((await lists(a)).sent).toEqual([])
    expect((await lists(b)).incoming).toEqual([])
  })

  it('a decline is silent: the asker still sees it pending and cannot ask again', async () => {
    const { a, b, aId, bId } = await pair('Decline Esha', 'Decline Farid')
    expect((await ask(a, bId)).status).toBe(201)
    expect((await answer(b, aId, 'decline')).status).toBe(204)
    expect((await lists(b)).incoming).toEqual([])
    expect((await lists(a)).sent).toEqual([{ id: bId, name: 'Decline' }])
    expect(await (await ask(a, bId)).json()).toEqual({ state: 'asked' })
    expect((await lists(b)).incoming).toEqual([])
    // and accepting a declined one does nothing
    expect((await answer(b, aId, 'accept')).status).toBe(404)
    expect((await lists(a)).friends).toEqual([])
  })

  it('a decline runs out: 14 days on, the cron forgets it and they may ask again', async () => {
    const { a, b, aId, bId } = await pair('Expire Gita', 'Expire Hari')
    expect((await ask(a, bId)).status).toBe(201)
    expect((await answer(b, aId, 'decline')).status).toBe(204)
    await purgeFriends(testEnv, Date.now() + FRIEND_ASK_TTL_MS + 1000)
    expect((await lists(a)).sent).toEqual([])
    expect((await ask(a, bId)).status).toBe(201)
    expect((await lists(b)).incoming).toEqual([{ id: aId, name: 'Expire' }])
  })

  it('two asks that cross are a yes from both', async () => {
    const { a, b, aId, bId } = await pair('Cross Isha', 'Cross Jai')
    expect((await ask(a, bId)).status).toBe(201)
    const res = await ask(b, aId)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: 'friends' })
    expect(ids((await lists(a)).friends)).toEqual([bId])
    expect(await count('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id IN (?, ?)', aId, bId)).toBe(0)
  })

  it('either side removes, silently, and the other just no longer has them', async () => {
    const { a, b, aId, bId } = await friends('Remove Kabir', 'Remove Lata')
    expect((await unfriend(b, aId)).status).toBe(204)
    expect((await lists(a)).friends).toEqual([])
    expect((await lists(b)).friends).toEqual([])
    // and again, from the other side, after a new yes
    expect((await ask(a, bId)).status).toBe(201)
    expect((await answer(b, aId, 'accept')).status).toBe(200)
    expect((await unfriend(a, bId)).status).toBe(204)
    expect((await lists(b)).friends).toEqual([])
    // removing someone who is not a friend tells nothing either
    expect((await unfriend(a, 'dev:nobody-at-all')).status).toBe(204)
  })

  it('an unmatch ends the friendship (friends are matched people)', async () => {
    const { a, b, aId, matchId } = await friends('Unmatch Mira', 'Unmatch Nikhil')
    expect((await api(`/api/matches/${matchId}`, b, { method: 'DELETE' })).status).toBe(204)
    expect((await lists(a)).friends).toEqual([])
    expect((await lists(b)).friends).toEqual([])
    expect((await ask(b, aId)).status).toBe(404)
  })

  it('the switches: both on by default, each off on its own; residents only', async () => {
    const { a } = await pair('Switch Om', 'Switch Pia')
    expect((await lists(a)).settings).toEqual({ showPresence: true, chaiInvites: true })
    const res = await settings(a, { showPresence: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ showPresence: false, chaiInvites: true })
    expect(await (await settings(a, { chaiInvites: false })).json()).toEqual({
      showPresence: false,
      chaiInvites: false,
    })
    expect(await (await settings(a, { showPresence: true })).json()).toEqual({
      showPresence: true,
      chaiInvites: false,
    })
    for (const bad of [{ showPresence: 'yes' }, { chaiInvites: 1 }, null, {}])
      expect((await settings(a, bad)).status, JSON.stringify(bad)).toBe(400)
    expect((await settings(await login('Switch Ghost'), { showPresence: false })).status).toBe(403)
  })
})

describe('a block, a hide, a ban or a deletion ends it', () => {
  it('a block either way ends the friendship, the asks and the invites; an unblock brings nothing back', async () => {
    for (const [x, y, by] of [
      ['Block Asha', 'Block Bhanu', 'a'],
      ['Block Chitra', 'Block Dev', 'b'],
    ] as const) {
      const p = await friends(x, y)
      const [blocker, blocked] = by === 'a' ? [p.a, p.bId] : [p.b, p.aId]
      const res = await api('/api/blocks', blocker, { method: 'POST', body: JSON.stringify({ id: blocked }) })
      expect(res.status).toBe(204)
      expect((await lists(p.a)).friends).toEqual([])
      expect((await lists(p.b)).friends).toEqual([])
      const { results } = await db
        .prepare('SELECT handle FROM blocks WHERE b = ?')
        .bind(blocked)
        .all<{ handle: string }>()
      expect((await api(`/api/blocks/${results[0]!.handle}`, blocker, { method: 'DELETE' })).status).toBe(204)
      expect((await lists(p.a)).friends).toEqual([])
      // the match went with the block: there is nobody to ask
      expect((await ask(p.a, p.bId)).status).toBe(404)
    }
  })

  it('a pending ask goes with a block, and cannot be accepted after', async () => {
    const { a, b, aId, bId } = await pair('Block Esha', 'Block Firoz')
    expect((await ask(a, bId)).status).toBe(201)
    await sql(
      'INSERT INTO blocks (a, b, created_at, name, handle) VALUES (?, ?, ?, ?, ?)',
      bId,
      aId,
      1,
      'x',
      'h1',
    )
    expect((await lists(b)).incoming).toEqual([])
    expect((await lists(a)).sent).toEqual([])
    expect((await answer(b, aId, 'accept')).status).toBe(404)
  })

  it('hiding either one ends it for good; so does a ban', async () => {
    for (const col of ['hidden', 'banned'] as const) {
      const p = await friends(`Out ${col} Gopal`, `Out ${col} Hema`)
      await sql(`UPDATE users SET ${col} = 1 WHERE id = ?`, p.bId)
      expect((await lists(p.a)).friends).toEqual([])
      await sql(`UPDATE users SET ${col} = 0 WHERE id = ?`, p.bId)
      expect((await lists(p.a)).friends).toEqual([])
      expect(await count('SELECT COUNT(*) AS n FROM friends WHERE a = ?1 OR b = ?1', p.bId)).toBe(0)
    }
  })

  it('accepting an ask from someone hidden since is refused', async () => {
    const { a, b, aId, bId } = await pair('Hid Ira', 'Hid Jas')
    expect((await ask(a, bId)).status).toBe(201)
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', aId)
    expect((await lists(b)).incoming).toEqual([])
    expect((await answer(b, aId, 'accept')).status).toBe(404)
    expect((await ask(b, aId)).status).toBe(404)
  })

  it('deleting the account takes every friendship, ask, switch and invite with it', async () => {
    const { a, b, aId, bId } = await friends('Leave Kiran', 'Leave Lal')
    const c = await pair('Leave Kiran', 'Leave Mohan')
    expect((await ask(c.a, c.bId)).status).toBe(201)
    expect((await settings(a, { showPresence: false })).status).toBe(200)
    const sat = await seated(b, 'university', 0)
    expect(
      (
        await api('/api/chai', b, {
          method: 'POST',
          body: JSON.stringify({ to: aId, bench: 'university:0', kind: 'tapri' }),
        })
      ).status,
    ).toBe(202)
    sat.close()
    expect(await count('SELECT COUNT(*) AS n FROM chai_invites WHERE to_id = ?', aId)).toBe(1)
    expect((await api('/api/me', a, { method: 'DELETE' })).status).toBe(204)
    for (const [q, n] of [
      ['SELECT COUNT(*) AS n FROM friends WHERE a = ?1 OR b = ?1', aId],
      ['SELECT COUNT(*) AS n FROM friend_requests WHERE from_id = ?1 OR to_id = ?1', aId],
      ['SELECT COUNT(*) AS n FROM friend_settings WHERE user_id = ?1', aId],
      ['SELECT COUNT(*) AS n FROM chai_invites WHERE from_id = ?1 OR to_id = ?1', aId],
    ] as const)
      expect(await count(q, n), q).toBe(0)
    expect((await lists(b)).friends).toEqual([])
    expect(bId).toBe(devId('Leave Lal'))
  })
})

describe('presence: "gali mein hai" only for a friend who is on the street and shares it', () => {
  /** What `token` sees of friend `id`. */
  const seen = async (token: string, id: string): Promise<FriendView | undefined> =>
    (await lists(token)).friends.find((f) => f.id === id)

  it('a friend on the street shows their district, and nothing else; gone from it, just the name', async () => {
    const { a, b, bId } = await friends('Here Neel', 'Here Oorja')
    expect(await seen(a, bId)).toEqual({ id: bId, name: 'Here' })
    const walker = await live('mi-road', { token: b })
    walker.send({ t: 'move', x: 1, z: 1, ry: 0 })
    await walker.sync()
    const shown = await seen(a, bId)
    expect(shown).toEqual({ id: bId, name: 'Here', here: 'mi-road' })
    // never a position, a look or a status
    expect(Object.keys(shown!).sort()).toEqual(['here', 'id', 'name'])
    walker.close()
    // polled gently: every look counts against the list's read allowance
    await vi.waitFor(async () => expect(await seen(a, bId)).toEqual({ id: bId, name: 'Here' }), {
      timeout: 5000,
      interval: 300,
    })
  })

  it('with "dosto ko dikhao" off, the row is exactly what it is when they are away', async () => {
    const { a, b, bId } = await friends('Off Prem', 'Off Qadir')
    expect((await settings(b, { showPresence: false })).status).toBe(200)
    const walker = await live('university', { token: b })
    walker.send({ t: 'move', x: 2, z: 2, ry: 0 })
    await walker.sync()
    const res = await api('/api/friends', a)
    const text = await res.clone().text()
    expect(((await res.json()) as FriendLists).friends).toEqual([{ id: bId, name: 'Off' }])
    expect(text).not.toContain('university')
    // and on again, at once
    expect((await settings(b, { showPresence: true })).status).toBe(200)
    expect(await seen(a, bId)).toEqual({ id: bId, name: 'Off', here: 'university' })
  })

  it('hidden: no row at all; a ghost walking about: no status; a stranger on the street: never listed', async () => {
    const { a, b, bId } = await friends('Priv Rani', 'Priv Sohan')
    // b walks about signed out: a ghost is nobody's friend
    const ghost = await live('walled-city')
    ghost.send({ t: 'move', x: 3, z: 3, ry: 0 })
    await ghost.sync()
    expect(await seen(a, bId)).toEqual({ id: bId, name: 'Priv' })
    // a stranger on the street is not in the list
    const stranger = await live('walled-city', { token: await resident('Priv Stranger') })
    stranger.send({ t: 'move', x: 4, z: 4, ry: 0 })
    await stranger.sync()
    expect(ids((await lists(a)).friends)).toEqual([bId])
    // b on the street, then hidden: gone from the list altogether
    const walker = await live('walled-city', { token: b })
    walker.send({ t: 'move', x: 5, z: 5, ry: 0 })
    await walker.sync()
    expect((await seen(a, bId))?.here).toBe('walled-city')
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', bId)
    expect((await lists(a)).friends).toEqual([])
  })

  it('the list is read on demand and rate-limited per account', async () => {
    const { a, aId } = await pair('Read Tara', 'Read Uday')
    const now = 7_000_000 * FRIEND_READ_LIMIT.windowMs
    for (let i = 0; i < FRIEND_READ_LIMIT.perWindow; i++)
      expect((await listFriends(testEnv, aId, now + i)).status).toBe(200)
    expect((await listFriends(testEnv, aId, now + 100)).status).toBe(429)
    expect(a).toBeTruthy()
  })
})

describe('chai pe bulao', () => {
  const chai = (token: string, to: string, bench = 'university:1', kind = 'bench') =>
    api('/api/chai', token, { method: 'POST', body: JSON.stringify({ to, bench, kind }) })

  it('seated, you invite a friend: they see who and which bench, and are told', async () => {
    const { a, b, bId } = await friends('Chai Asha', 'Chai Bilal')
    const boxB = await inbox(b)
    await seated(a, 'university', 1)
    const res = await chai(a, bId)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ sent: true })
    await boxB.next('chai')
    const got = await invites(b)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({
      name: 'Chai',
      bench: 'university:1',
      kind: 'bench',
      district: 'university',
    })
    expect(Object.keys(got[0]!).sort()).toEqual(['at', 'bench', 'district', 'id', 'kind', 'name'])
    // "Abhi nahi": gone, silently
    expect((await api(`/api/chai/${got[0]!.id}`, b, { method: 'DELETE' })).status).toBe(204)
    expect(await invites(b)).toEqual([])
    // the sender has none
    expect(await invites(a)).toEqual([])
  })

  it('only while you sit there: standing, another bench, or no bench at all is refused', async () => {
    const { a, bId } = await friends('Sit Chandu', 'Sit Dia')
    const standing = await chai(a, bId)
    expect(standing.status).toBe(409)
    expect(await standing.json()).toEqual({ error: 'not-seated' })
    await seated(a, 'university', 2)
    expect((await chai(a, bId, 'university:3')).status).toBe(409)
    for (const [bench, kind] of [
      ['nowhere:1', 'bench'],
      ['university:999', 'bench'],
      ['university:2', 'sofa'],
      [42, 'bench'],
    ] as const)
      expect((await chai(a, bId, bench as string, kind)).status, `${bench} ${kind}`).toBe(400)
    expect((await chai(a, 'x'.repeat(300))).status).toBe(400)
    expect((await chai(await login('Sit Ghost'), bId)).status).toBe(403)
  })

  it('muted invites, hidden, blocked, a ghost or not a friend: the same answer, and nothing reaches them', async () => {
    const { a, aId } = await pair('Same Esha', 'Same Fateh')
    const targets: string[] = []
    // invites off
    const off = await pair('Same Esha', 'Same Off')
    expect((await ask(off.b, aId)).status).toBe(201)
    expect((await answer(a, off.bId, 'accept')).status).toBe(200)
    expect((await settings(off.b, { chaiInvites: false })).status).toBe(200)
    targets.push(off.bId)
    // hidden (which also ended the friendship)
    const hid = await pair('Same Esha', 'Same Hidden')
    expect((await ask(a, hid.bId)).status).toBe(201)
    expect((await answer(hid.b, aId, 'accept')).status).toBe(200)
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', hid.bId)
    targets.push(hid.bId)
    // blocked by them, after being friends
    const blk = await pair('Same Esha', 'Same Blocker')
    expect((await ask(a, blk.bId)).status).toBe(201)
    expect((await answer(blk.b, aId, 'accept')).status).toBe(200)
    expect(
      (await api('/api/blocks', blk.b, { method: 'POST', body: JSON.stringify({ id: aId }) })).status,
    ).toBe(204)
    targets.push(blk.bId)
    // a ghost (signed in, no profile), and someone never a friend
    await login('Same Ghost')
    targets.push(devId('Same Ghost'))
    targets.push(devId('Same Fateh'))
    const boxes = await Promise.all([inbox(off.b), inbox(blk.b)])
    await seated(a, 'university', 4)
    let at = 9_000_000 * CHAI_LIMIT.sender.windowMs
    const bodies = []
    for (const to of targets) {
      const work = collected()
      const res = await sendChai(testEnv, aId, { to, bench: 'university:4', kind: 'bench' }, at, work.later)
      at += CHAI_LIMIT.pair.windowMs
      await work.settled()
      bodies.push([res.status, await res.text(), [...res.headers.keys()].sort().join()])
    }
    // every one answered exactly alike
    for (const b of bodies) expect(b).toEqual(bodies[0])
    expect(bodies[0]![0]).toBe(202)
    expect(await count('SELECT COUNT(*) AS n FROM chai_invites WHERE from_id = ?', aId)).toBe(0)
    for (const box of boxes) expect(box.messages.filter((m) => m.t === 'chai')).toEqual([])
    expect(await invites(off.b)).toEqual([])
  })

  it(`limits: ${CHAI_LIMIT.pair.perWindow} per friend each ${CHAI_LIMIT.pair.windowMs / 60_000} minutes, ${CHAI_LIMIT.sender.perWindow} an hour in all, refused ones counted the same`, async () => {
    const people = ['Lim B', 'Lim C', 'Lim D', 'Lim E', 'Lim F', 'Lim G']
    let aId = ''
    let a = ''
    // each of them asks (a new account may only ask a few people a day)
    for (const y of people) {
      const p = await friends(y, 'Lim Asha')
      ;[a, aId] = [p.b, p.bId]
    }
    await seated(a, 'university', 5)
    const hour = 11_000_000 * CHAI_LIMIT.sender.windowMs
    const send = (to: string, at: number) =>
      sendChai(testEnv, aId, { to, bench: 'university:5', kind: 'bench' }, at, collected().later)
    expect((await send(devId('Lim B'), hour)).status).toBe(202)
    // the same friend again, too soon
    expect((await send(devId('Lim B'), hour + 1000)).status).toBe(429)
    // someone who is no friend counts the same way: the second is refused alike
    expect((await send(devId('Lim Nobody'), hour + 2000)).status).toBe(202)
    expect((await send(devId('Lim Nobody'), hour + 3000)).status).toBe(429)
    // every try counts against the hour (a refused one too, as every limit here does): the fifth gets
    // through, then nobody, whoever it is for
    expect((await send(devId('Lim C'), hour + 4000)).status).toBe(202)
    for (const y of ['Lim D', 'Lim E', 'Lim F']) expect((await send(devId(y), hour + 5000)).status).toBe(429)
    // the next hour, again
    expect((await send(devId('Lim G'), hour + CHAI_LIMIT.sender.windowMs)).status).toBe(202)
  })

  it(`an invite stands ${CHAI_TTL_MS / 60_000} minutes, and goes if the sender is blocked or hidden, or the friendship ends`, async () => {
    const { a, b, aId, bId } = await friends('Old Gauri', 'Old Harsh')
    await seated(a, 'mi-road', 1)
    // in 1970: long past
    const base = 1_000 * CHAI_LIMIT.sender.windowMs
    expect(
      (await sendChai(testEnv, aId, { to: bId, bench: 'mi-road:1', kind: 'tapri' }, base, collected().later))
        .status,
    ).toBe(202)
    // past its time, nobody sees it
    expect(await invites(b)).toEqual([])
    await sql(
      'UPDATE chai_invites SET created_at = ? WHERE from_id = ?',
      Date.now() - CHAI_TTL_MS + 60_000,
      aId,
    )
    expect(await invites(b)).toHaveLength(1)
    await purgeFriends(testEnv, Date.now())
    expect(await invites(b)).toHaveLength(1)
    await purgeFriends(testEnv, Date.now() + 120_000)
    expect(await invites(b)).toEqual([])
    // a fresh one, then the friendship ends: gone
    await sql(
      "INSERT INTO chai_invites (id, from_id, to_id, bench, kind, created_at) VALUES ('i1', ?, ?, 'mi-road:1', 'tapri', ?)",
      aId,
      bId,
      Date.now(),
    )
    expect(await invites(b)).toHaveLength(1)
    expect((await unfriend(a, bId)).status).toBe(204)
    expect(await invites(b)).toEqual([])
    // the sender hidden since, with a row left behind: never shown
    await sql(
      "INSERT INTO chai_invites (id, from_id, to_id, bench, kind, created_at) VALUES ('i2', ?, ?, 'mi-road:1', 'tapri', ?)",
      aId,
      bId,
      Date.now(),
    )
    expect(await invites(b)).toEqual([])
  })

  it('push: a friend with no inbox open gets "a friend invited you for chai", naming nobody', async () => {
    const { a, b, aId, bId } = await friends('Push Indu', 'Push Jatin')
    const ua = await subscribed(b, 'en')
    const got = fakePushService()
    await seated(a, 'amer', 0)
    const work = collected()
    const res = await sendChai(
      testEnv,
      aId,
      { to: bId, bench: 'amer:0', kind: 'bench' },
      Date.now(),
      work.later,
    )
    expect(res.status).toBe(202)
    await work.settled()
    await vi.waitFor(() => expect(got).toHaveLength(1), WAIT)
    const plain = new TextDecoder().decode(await decryptPayload(got[0]!.body, ua))
    expect(JSON.parse(plain)).toEqual({ t: 'chai', lang: 'en' })
    for (const leak of ['Indu', 'Push', 'amer', 'dev:']) expect(plain).not.toContain(leak)
  })

  it('no push with the inbox open, and none at all for a refused one', async () => {
    const { a, b, aId, bId } = await friends('Push Kamla', 'Push Lakhan')
    await subscribed(b, 'hi')
    const box = await inbox(b)
    const got = fakePushService()
    await seated(a, 'amer', 1)
    const base = 15_000_000 * CHAI_LIMIT.sender.windowMs
    const work = collected()
    expect(
      (await sendChai(testEnv, aId, { to: bId, bench: 'amer:1', kind: 'bench' }, base, work.later)).status,
    ).toBe(202)
    await work.settled()
    await box.next('chai')
    box.close()
    // invites off now: refused, so no push either, inbox or not
    expect((await settings(b, { chaiInvites: false })).status).toBe(200)
    const again = collected()
    expect(
      (
        await sendChai(
          testEnv,
          aId,
          { to: bId, bench: 'amer:1', kind: 'bench' },
          base + CHAI_LIMIT.pair.windowMs,
          again.later,
        )
      ).status,
    ).toBe(202)
    await again.settled()
    expect(got).toEqual([])
    closeAll()
  })
})
