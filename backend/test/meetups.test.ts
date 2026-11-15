import { applyD1Migrations, env, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/env'
import { DISTRICT_IDS } from '../src/district'
import {
  LATE_MS,
  putGoing,
  remindMeetups,
  REMIND_BEFORE_MS,
  REMIND_PER_PERSON,
  RSVP_LIMIT,
} from '../src/meetups'
import { pushTo } from '../src/push'
import { forgetWalls, pinPoster, purgePosters } from '../src/posters'
import type { GoingView, PosterView } from '../src/protocol'
import { api, devId, login, resident, settle } from './helpers'
import { decryptPayload, publicOf, userAgent } from './pushKit'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const db = testEnv.DB
const API = 'https://api.test'
const HOUR = 3600_000
const PLAN = 'Chai at Tapri, then a walk round the lake'

beforeAll(async () => {
  await applyD1Migrations(db, testEnv.TEST_MIGRATIONS)
})
beforeEach(async () => {
  await db.prepare('DELETE FROM posters').run()
  await forgetWalls(testEnv, DISTRICT_IDS)
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
const rsvps = async (posterId: string) =>
  (
    await db
      .prepare('SELECT user_id FROM rsvps WHERE poster_id = ? ORDER BY created_at')
      .bind(posterId)
      .all<{ user_id: string }>()
  ).results.map((r) => r.user_id)

/** A poster pinned by `token` on the university wall (where `when` is given, at that time). */
async function pinned(token: string, when: number | null = null): Promise<PosterView> {
  const res = await api('/api/posters', token, {
    method: 'POST',
    body: JSON.stringify({ district: 'university', wall: 0, text: PLAN, when }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as PosterView
}
const going = (token: string, id: string, method: 'PUT' | 'DELETE' | 'GET' = 'PUT') =>
  api(`/api/posters/${encodeURIComponent(id)}/going`, token, { method })
const view = async (token: string, id: string, method: 'PUT' | 'DELETE' | 'GET' = 'GET') => {
  const res = await going(token, id, method)
  expect(res.status).toBe(200)
  return (await res.json()) as GoingView
}
const listed = async (token?: string) =>
  (await (
    await SELF.fetch(`${API}/api/districts/university/posters`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  ).json()) as PosterView[]
const asAdmin = async (path: string, init: RequestInit = {}) => api(path, await login('Owner'), init)

describe('Main aaunga', () => {
  it('only a verified resident others can see may say it, never on their own poster', async () => {
    const owner = await resident('Gate Owner')
    const poster = await pinned(owner)
    const plain = await resident('Gate Plain', {}, { verified: false })
    const ghost = await login('Gate Ghost')
    const muted = await resident('Gate Muted')
    await sql('UPDATE users SET muted_until = ? WHERE id = ?', Date.now() + HOUR, devId('Gate Muted'))
    const hidden = await resident('Gate Hidden')
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', devId('Gate Hidden'))

    for (const [token, error] of [
      [plain, 'not-verified'],
      [ghost, 'ghost'],
      [hidden, 'ghost'],
      [muted, 'muted'],
    ] as const) {
      const res = await going(token, poster.id)
      expect(res.status, error).toBe(403)
      expect(await res.json()).toMatchObject({ error })
    }
    const own = await going(owner, poster.id)
    expect(own.status).toBe(400)
    expect(await own.json()).toEqual({ error: 'mine' })
    const nothing = await going(await resident('Gate Lost'), 'no-such-poster')
    expect(nothing.status).toBe(404)
    expect((await SELF.fetch(`${API}/api/posters/${poster.id}/going`, { method: 'PUT' })).status).toBe(401)
    expect(await rsvps(poster.id)).toEqual([])
  })

  it('everyone sees the count; only the owner sees first names; saying it twice counts once', async () => {
    const owner = await resident('Count Owner')
    const poster = await pinned(owner)
    const asha = await resident('Asha Count')
    const ravi = await resident('Ravi Count')
    const other = await resident('Other Count')

    expect(await view(asha, poster.id, 'PUT')).toEqual({ going: 1, coming: true })
    expect(await view(asha, poster.id, 'PUT')).toEqual({ going: 1, coming: true })
    expect(await view(ravi, poster.id, 'PUT')).toEqual({ going: 2, coming: true })

    // The owner alone gets the names, first come first.
    expect(await view(owner, poster.id)).toEqual({ going: 2, coming: false, names: ['Asha', 'Ravi'] })
    expect(await view(other, poster.id)).toEqual({ going: 2, coming: false })
    expect(await view(asha, poster.id)).toEqual({ going: 2, coming: true })
    expect((await SELF.fetch(`${API}/api/posters/${poster.id}/going`)).status).toBe(401)

    // The walls carry the count for everyone, signed out too; `coming` only on the list of someone coming.
    const mine = (await listed(asha)).find((p) => p.id === poster.id)!
    expect(mine).toMatchObject({ going: 2, coming: true })
    const theirs = (await listed(other)).find((p) => p.id === poster.id)!
    expect(theirs.going).toBe(2)
    expect(theirs.coming).toBeUndefined()
    const out = (await listed()).find((p) => p.id === poster.id)!
    expect(out.going).toBe(2)
    expect(JSON.stringify(await listed())).not.toMatch(/Asha|Ravi/)

    // Taking it back.
    expect(await view(asha, poster.id, 'DELETE')).toEqual({ going: 1, coming: false })
    expect(await rsvps(poster.id)).toEqual([devId('Ravi Count')])
  })

  it('someone hidden or banned has their word taken back: neither counted nor named, to anyone', async () => {
    const owner = await resident('Seen Owner')
    const poster = await pinned(owner)
    const hema = await resident('Hema Seen')
    const bina = await resident('Bina Seen')
    await view(hema, poster.id, 'PUT')
    await view(bina, poster.id, 'PUT')
    // Hidden: their word goes (and no reminder can reach them through it).
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', devId('Hema Seen'))
    expect(await rsvps(poster.id)).toEqual([devId('Bina Seen')])
    expect(await view(owner, poster.id)).toEqual({ going: 1, coming: false, names: ['Bina'] })
    expect((await listed()).find((p) => p.id === poster.id)!.going).toBe(1)
    // A ban too.
    expect((await asAdmin(`/api/admin/users/${devId('Bina Seen')}/ban`, { method: 'POST' })).status).toBe(200)
    expect(await rsvps(poster.id)).toEqual([])
    const none = (await listed()).find((p) => p.id === poster.id)!
    expect(none.going).toBeUndefined()
    expect(await view(owner, poster.id)).toEqual({ going: 0, coming: false, names: [] })
  })

  it('a block either way takes the word back, and no one may say it across one', async () => {
    const owner = await resident('Block Owner')
    const poster = await pinned(owner)
    const mina = await resident('Mina Block')
    const tara = await resident('Tara Block')
    const theirs = await pinned(mina)
    await view(mina, poster.id, 'PUT')
    await view(tara, poster.id, 'PUT')
    await view(owner, theirs.id, 'PUT')

    // The owner blocks Mina: her word on his poster goes, and his on hers.
    expect(
      (await api('/api/blocks', owner, { method: 'POST', body: JSON.stringify({ id: devId('Mina Block') }) }))
        .status,
    ).toBe(204)
    expect(await rsvps(poster.id)).toEqual([devId('Tara Block')])
    expect(await rsvps(theirs.id)).toEqual([])
    expect((await going(mina, poster.id)).status).toBe(404)
    expect((await going(owner, theirs.id)).status).toBe(404)

    // Tara blocks the owner from his poster: hers goes too.
    expect(
      (await api('/api/blocks', tara, { method: 'POST', body: JSON.stringify({ poster: poster.id }) }))
        .status,
    ).toBe(204)
    expect(await rsvps(poster.id)).toEqual([])
    expect((await going(tara, poster.id)).status).toBe(404)
  })

  it('the word goes with the poster: taken down, by an admin, hidden, expired, its owner hidden or gone', async () => {
    const owner = await resident('Life Owner')
    const fan = await resident('Fan Life')
    const second = await resident('Life Second')
    const say = async (p: PosterView) => expect((await going(fan, p.id)).status).toBe(200)

    const a = await pinned(owner)
    await say(a)
    expect((await api(`/api/posters/${a.id}`, owner, { method: 'DELETE' })).status).toBe(204)
    expect(await rsvps(a.id)).toEqual([])

    const b = await pinned(owner)
    await say(b)
    expect((await asAdmin(`/api/admin/posters/${b.id}`, { method: 'DELETE' })).status).toBe(200)
    expect(await rsvps(b.id)).toEqual([])

    // Hidden by reports: off every wall, and nobody is held to it (nor may say it while hidden).
    const c = await pinned(owner)
    await say(c)
    await sql('UPDATE posters SET hidden = 1 WHERE id = ?', c.id)
    expect(await rsvps(c.id)).toEqual([])
    expect((await going(fan, c.id)).status).toBe(404)
    await sql('DELETE FROM posters WHERE id = ?', c.id)

    // Its owner hidden: the same.
    const d = await pinned(second)
    await say(d)
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', devId('Life Second'))
    expect(await rsvps(d.id)).toEqual([])
    expect((await going(fan, d.id)).status).toBe(404)

    // Expired: the cron sweeps the poster, and the word with it.
    const e = await pinned(owner, Date.now() + 2 * HOUR)
    await say(e)
    await purgePosters(testEnv, Date.now() + 9 * HOUR)
    expect(await rsvps(e.id)).toEqual([])

    // The owner deletes their account: posters and every word on them go.
    const f = await pinned(owner)
    await say(f)
    expect((await api('/api/me', owner, { method: 'DELETE' })).status).toBe(204)
    expect(await rsvps(f.id)).toEqual([])
  })

  it('deleting your account takes back every word you gave', async () => {
    const owner = await resident('Del Owner')
    const poster = await pinned(owner)
    const leaver = await resident('Leaver Del')
    await view(leaver, poster.id, 'PUT')
    expect((await api('/api/me', leaver, { method: 'DELETE' })).status).toBe(204)
    expect(await rsvps(poster.id)).toEqual([])
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM rsvps WHERE user_id = ?')
        .bind(devId('Leaver Del'))
        .first('n'),
    ).toBe(0)
  })

  it(`is refused once the plan's time is more than ${LATE_MS / 60_000} minutes gone`, async () => {
    const now = Date.now()
    await resident('Late Owner')
    const when = now + 2 * HOUR
    const poster = (await pinPoster(
      testEnv,
      devId('Late Owner'),
      { district: 'university', wall: 0, text: PLAN, when },
      undefined,
      now,
    ).then((r) => r.json())) as PosterView
    await resident('Late Comer')
    await resident('Later Comer')
    expect((await putGoing(testEnv, devId('Late Comer'), poster.id, when + LATE_MS)).status).toBe(200)
    const late = await putGoing(testEnv, devId('Later Comer'), poster.id, when + LATE_MS + 1)
    expect(late.status).toBe(409)
    expect(await late.json()).toEqual({ error: 'past' })
  })

  it(`is rate-limited: ${RSVP_LIMIT.perWindow} an hour, saying and taking back together`, async () => {
    const owner = await resident('Rate Owner')
    const poster = await pinned(owner)
    const flip = await resident('Flip Rate')
    for (let i = 0; i < RSVP_LIMIT.perWindow; i++)
      expect((await going(flip, poster.id, i % 2 ? 'DELETE' : 'PUT')).status).toBe(200)
    const res = await going(flip, poster.id, 'PUT')
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate' })
  })
})

describe('the reminder an hour before', () => {
  const SERVER = publicOf(testEnv.VAPID_PRIVATE_JWK!)
  let n = 0
  async function device(token: string, lang: 'hi' | 'en') {
    const ua = await userAgent()
    const endpoint = `https://fcm.googleapis.com/fcm/send/meetup-${++n}-${crypto.randomUUID()}`
    const res = await api('/api/me/push', token, {
      method: 'PUT',
      body: JSON.stringify({ endpoint, keys: ua.keys, lang, server: SERVER }),
    })
    expect(res.status).toBe(204)
    return { ua, endpoint }
  }
  /** A fake push service: every push it took, by endpoint, and its headers. */
  function service() {
    const got = new Map<string, Uint8Array>()
    const headers = new Map<string, Headers>()
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      got.set(url, new Uint8Array(await new Response(init?.body).arrayBuffer()))
      headers.set(url, new Headers(init?.headers))
      return new Response(null, { status: 201 })
    }) as typeof fetch
    return { got, headers, fetcher }
  }
  /** A poster of `owner`'s (a dev name), its plan at `when`, pinned at `now`. */
  const pinAt = async (owner: string, when: number, now: number) =>
    (await pinPoster(
      testEnv,
      devId(owner),
      { district: 'university', wall: 0, text: PLAN, when },
      undefined,
      now,
    ).then((r) => r.json())) as PosterView

  it('lasts at the push service only until the plan, and a message push the same minute does not stop it', async () => {
    const now = Date.now()
    await resident('Ttl Owner')
    const when = now + 3 * HOUR
    const poster = await pinAt('Ttl Owner', when, now)
    const ira = await resident('Ira Ttl')
    const phone = await device(ira, 'en')
    await view(ira, poster.id, 'PUT')
    const at = when - 40 * 60_000
    // A message push just went: the inbox's one-a-minute is used up.
    const inbox = service()
    expect(await pushTo(testEnv, devId('Ira Ttl'), 'message', inbox.fetcher, at - 1_000)).toBe(1)
    const svc = service()
    expect(await remindMeetups(testEnv, at, svc.fetcher)).toBe(1)
    expect(svc.headers.get(phone.endpoint)!.get('TTL')).toBe(String(40 * 60))
    expect(svc.headers.get(phone.endpoint)!.get('Topic')).toBe('meetup')
  })

  it('checks each person when it sends: someone no longer verified gets nothing', async () => {
    const now = Date.now()
    await resident('Check Owner')
    const when = now + 3 * HOUR
    const poster = await pinAt('Check Owner', when, now)
    const uma = await resident('Uma Check')
    await device(uma, 'en')
    await view(uma, poster.id, 'PUT')
    await sql('UPDATE users SET verified = 0 WHERE id = ?', devId('Uma Check'))
    const svc = service()
    expect(await remindMeetups(testEnv, when - 30 * 60_000, svc.fetcher)).toBe(0)
    expect(svc.got.size).toBe(0)
  })

  it('a run sends only as many as its budget of subrequests holds, counted by device; the rest go next run', async () => {
    const now = Date.now()
    await resident('Batch Owner')
    const when = now + 3 * HOUR
    const poster = await pinAt('Batch Owner', when, now)
    const phones: string[] = []
    for (const name of ['Asha Batch', 'Bela Batch']) {
      const t = await resident(name)
      phones.push((await device(t, 'en')).endpoint, (await device(t, 'en')).endpoint)
      await view(t, poster.id, 'PUT')
    }
    const at = when - 30 * 60_000
    // Room for one person with two devices, not two.
    const first = service()
    expect(await remindMeetups(testEnv, at, first.fetcher, { budget: 2 + REMIND_PER_PERSON })).toBe(1)
    expect(first.got.size).toBe(2)
    const second = service()
    expect(await remindMeetups(testEnv, at + 60_000, second.fetcher, { budget: 2 + REMIND_PER_PERSON })).toBe(
      1,
    )
    expect(second.got.size).toBe(2)
    expect(new Set([...first.got.keys(), ...second.got.keys()])).toEqual(new Set(phones))
  })

  it('pushes once to those coming who have push on, naming nobody; not the owner, not inside the hour', async () => {
    const now = Date.now()
    const owner = await resident('Remind Owner')
    const when = now + 3 * HOUR
    const poster = (await pinPoster(
      testEnv,
      devId('Remind Owner'),
      { district: 'university', wall: 0, text: PLAN, when },
      undefined,
      now,
    ).then((r) => r.json())) as PosterView
    await device(owner, 'en')
    const kavya = await resident('Kavya Remind')
    const phone = await device(kavya, 'hi')
    const quiet = await resident('Quiet Remind') // coming, but no push
    await view(kavya, poster.id, 'PUT')
    await view(quiet, poster.id, 'PUT')

    // Too early: nothing.
    const early = service()
    expect(await remindMeetups(testEnv, now + HOUR, early.fetcher)).toBe(0)
    expect(early.got.size).toBe(0)

    // Within the hour before: Kavya's phone, and only hers.
    const at = when - REMIND_BEFORE_MS + 60_000
    const first = service()
    expect(await remindMeetups(testEnv, at, first.fetcher)).toBe(1)
    expect([...first.got.keys()]).toEqual([phone.endpoint])
    const payload = JSON.parse(
      new TextDecoder().decode(await decryptPayload(first.got.get(phone.endpoint)!, phone.ua)),
    )
    expect(payload).toEqual({ t: 'meetup', lang: 'hi' })

    // Once only.
    const again = service()
    expect(await remindMeetups(testEnv, at + 15 * 60_000, again.fetcher)).toBe(0)
    expect(again.got.size).toBe(0)

    // Someone who says it inside the hour already knows: no reminder for them.
    const soon = await pinned(await resident('Soon Remind'), Date.now() + 50 * 60_000)
    const late = await resident('Late Remind')
    const latePhone = await device(late, 'en')
    await view(late, soon.id, 'PUT')
    const lateRun = service()
    expect(await remindMeetups(testEnv, Date.now(), lateRun.fetcher)).toBe(0)
    expect(lateRun.got.has(latePhone.endpoint)).toBe(false)
  })

  it('a poster without a time, a hidden one, or one whose owner is hidden sends nothing', async () => {
    const now = Date.now()
    await resident('Mute Owner')
    const when = now + 3 * HOUR
    const at = when - REMIND_BEFORE_MS + 60_000
    const pin = async (w: number | null) =>
      (await pinPoster(
        testEnv,
        devId('Mute Owner'),
        { district: 'university', wall: 0, text: PLAN, when: w },
        undefined,
        now,
      ).then((r) => r.json())) as PosterView
    const timeless = await pin(null)
    const fan = await resident('Fan Mute')
    await device(fan, 'en')
    await view(fan, timeless.id, 'PUT')
    const svc = service()
    expect(await remindMeetups(testEnv, at, svc.fetcher)).toBe(0)

    const timed = await pin(when)
    await view(fan, timed.id, 'PUT')
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', devId('Mute Owner'))
    expect(await remindMeetups(testEnv, at, svc.fetcher)).toBe(0)
    expect(svc.got.size).toBe(0)
  })
})
