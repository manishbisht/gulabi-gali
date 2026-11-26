import { applyD1Migrations, env, evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EMOTE_WINDOW_MS, INTEREST_M, MAX_BAD_FRAMES, parseClientMsg } from '../src/district'
import type { Env } from '../src/env'
import { EMOTE_KINDS, EMOTE_PER_MINUTE, type DistrictId } from '../src/protocol'
import { api, closeAll, devId, live, login, resident, type LiveClient } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const stub = (id: DistrictId) => testEnv.DISTRICT.get(testEnv.DISTRICT.idFromName(id))
const sql = (q: string, ...args: unknown[]) =>
  testEnv.DB.prepare(q)
    .bind(...args)
    .run()

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})
afterEach(() => closeAll())

/** A resident on the street at (x, z). */
async function walker(name: string, district: DistrictId, x: number, z = 0): Promise<LiveClient> {
  const c = await live(district, { token: await resident(name) })
  c.send({ t: 'move', x, z, ry: 0 })
  await c.sync()
  return c
}

const block = (token: string, id: string) =>
  api('/api/blocks', token, { method: 'POST', body: JSON.stringify({ id }) })

/** Runs `fn` with the district's clock `ms` ahead, then puts it back. */
async function later(district: DistrictId, ms: number, fn: () => Promise<void>) {
  await runInDurableObject(stub(district), (instance) => {
    instance.clock = () => Date.now() + ms
  })
  try {
    await fn()
  } finally {
    await runInDurableObject(stub(district), (instance) => {
      instance.clock = Date.now
    })
  }
}

/** Everything `c` was sent about an emote since `from`, once all it was sent has arrived. */
async function emotesSeen(c: LiveClient, from = 0) {
  await c.sync()
  return c.all('emote', from)
}

describe('emote frames', () => {
  it('parses each kind we know, reading nothing but the kind', () => {
    expect(EMOTE_KINDS).toEqual(['dance', 'clap', 'sit', 'selfie', 'wave'])
    for (const kind of EMOTE_KINDS)
      expect(parseClientMsg(JSON.stringify({ t: 'emote', kind, from: 'dev:someone-else', to: 'x' }))).toEqual({
        t: 'emote',
        kind,
      })
  })

  it('a kind it does not know is still a good frame (a newer page may send one): any short word parses', () => {
    for (const kind of ['kiss', 'namaste', 'Dance', '__proto__', '', 'x'.repeat(16)])
      expect(parseClientMsg(JSON.stringify({ t: 'emote', kind })), kind).toEqual({ t: 'emote', kind })
  })

  it('only a kind that is no short word is a bad frame', () => {
    for (const bad of [
      '{"t":"emote"}',
      '{"t":"emote","kind":5}',
      '{"t":"emote","kind":null}',
      '{"t":"emote","kind":true}',
      '{"t":"emote","kind":["dance"]}',
      '{"t":"emote","kind":{"toString":"dance"}}',
      `{"t":"emote","kind":"${'x'.repeat(17)}"}`,
    ])
      expect(parseClientMsg(bad), bad).toBeNull()
  })
})

describe('emotes', () => {
  it('reach everyone near who can see the sender, ghosts watching included, and never the sender', async () => {
    const d: DistrictId = 'walled-city'
    const a = await walker('Emote Asha', d, 0)
    const b = await walker('Emote Bina', d, 3)
    const ghost = await live(d)
    ghost.send({ t: 'move', x: 5, z: 0, ry: 0 })
    await ghost.sync()
    const marks = [a, b, ghost].map((s) => s.mark())

    a.send({ t: 'emote', kind: 'dance' })
    const want = { t: 'emote', from: devId('Emote Asha'), kind: 'dance' }
    expect(await b.next('emote', undefined, marks[1])).toEqual(want)
    expect(await ghost.next('emote', undefined, marks[2])).toEqual(want)
    // their own page plays it at once: nothing comes back, not even a refusal
    await a.sync()
    expect(a.messages.slice(marks[0]).filter((m) => m.t !== 'pong')).toEqual([])
  })

  it('an unknown kind reaches nobody and is no strike: a newer page can send any number and keep its socket', async () => {
    const d: DistrictId = 'walled-city'
    const a = await walker('Odd Asha', d, 20, 20)
    const b = await walker('Odd Bina', d, 22, 20)
    const [fa, fb] = [a.mark(), b.mark()]
    // more than the bad frames in a row that would close a socket, with nothing good in between
    for (let i = 0; i < MAX_BAD_FRAMES + 2; i++) a.raw('{"t":"emote","kind":"cartwheel"}')
    await a.sync()
    expect(a.messages.slice(fa).filter((m) => m.t !== 'pong')).toEqual([])
    expect(a.closes).toEqual([])
    expect(await emotesSeen(b, fb)).toEqual([])
    // and the socket is as good as ever: one they both know goes through
    a.send({ t: 'emote', kind: 'clap' })
    await b.next('emote', undefined, fb)
    // a kind that is not a word at all is a bad frame, as ever
    a.raw('{"t":"emote","kind":5}')
    expect(await a.next('error', undefined, fa)).toEqual({ t: 'error', code: 'invalid' })
  })

  it(`go only as far as moves do: ${INTEREST_M} m from the sender, and not to a socket that has not said where it is`, async () => {
    const d: DistrictId = 'mi-road'
    const a = await walker('Range Asha', d, 0, 40)
    const edge = await walker('Range Edge', d, INTEREST_M - 1, 40)
    const far = await walker('Range Faraway', d, INTEREST_M + 1, 40)
    const nowhere = await live(d, { token: await resident('Range Nowhere') })
    await nowhere.sync()
    const marks = [edge, far, nowhere].map((s) => s.mark())
    a.send({ t: 'emote', kind: 'wave' })
    await edge.next('emote', undefined, marks[0])
    expect(await emotesSeen(far, marks[1])).toEqual([])
    expect(await emotesSeen(nowhere, marks[2])).toEqual([])
    // exactly whoever is told of the sender's steps: the same people, by the same rule
    const moves = [edge, far, nowhere].map((s) => s.mark())
    a.send({ t: 'move', x: -1, z: 40, ry: 0 })
    await edge.next('moves', undefined, moves[0])
    await far.sync()
    await nowhere.sync()
    expect(far.all('moves', moves[1])).toEqual([])
    expect(nowhere.all('moves', moves[2])).toEqual([])
  })

  it('a ghost cannot send one: a visitor with no account, one with no profile, and a resident who has not stepped out', async () => {
    const d: DistrictId = 'university'
    const b = await walker('Ghostly Bina', d, 2)
    const from = b.mark()
    const anon = await live(d)
    const half = await live(d, { token: await login('Ghostly Halfway') })
    const still = await live(d, { token: await resident('Ghostly Still') })
    for (const g of [anon, half]) {
      g.send({ t: 'move', x: 1, z: 0, ry: 0 })
      await g.sync()
    }
    for (const g of [anon, half, still]) {
      const mark = g.mark()
      g.send({ t: 'emote', kind: 'clap' })
      await g.sync()
      // dropped without a word: their own page plays it for them alone
      expect(g.messages.slice(mark).filter((m) => m.t !== 'pong')).toEqual([])
    }
    expect(await emotesSeen(b, from)).toEqual([])
  })

  it("a hidden person's is never passed on", async () => {
    const d: DistrictId = 'university'
    const b = await walker('Hide Bina', d, 40, 40)
    const token = await resident('Hide Hema')
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', devId('Hide Hema'))
    const hidden = await live(d, { token })
    hidden.send({ t: 'move', x: 41, z: 40, ry: 0 })
    await hidden.sync()
    const from = b.mark()
    hidden.send({ t: 'emote', kind: 'dance' })
    await hidden.sync()
    expect(await emotesSeen(b, from)).toEqual([])
    // and they still see the street's: a ghost watching
    const mark = hidden.mark()
    b.send({ t: 'emote', kind: 'sit' })
    expect((await hidden.next('emote', undefined, mark)).from).toBe(devId('Hide Bina'))
  })

  it("a muted resident's is never passed on, and they are not told", async () => {
    const d: DistrictId = 'malviya-nagar'
    const b = await walker('Mute Bina', d, 2)
    const token = await resident('Mute Mohan')
    await sql('UPDATE users SET muted_until = ? WHERE id = ?', Date.now() + 3600_000, devId('Mute Mohan'))
    const m = await live(d, { token })
    m.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await m.sync()
    const [fm, fb] = [m.mark(), b.mark()]
    m.send({ t: 'emote', kind: 'wave' })
    await m.sync()
    expect(m.messages.slice(fm).filter((x) => x.t !== 'pong')).toEqual([])
    expect(await emotesSeen(b, fb)).toEqual([])
    // the control: the mute lifted (and the district told, as the admin route tells it), the next one arrives
    await sql('UPDATE users SET muted_until = NULL WHERE id = ?', devId('Mute Mohan'))
    await stub(d).refresh(devId('Mute Mohan'), 'mute')
    m.send({ t: 'emote', kind: 'wave' })
    expect(await b.next('emote', undefined, fb)).toEqual({ t: 'emote', from: devId('Mute Mohan'), kind: 'wave' })
  })

  it('blocks keep both ways apart: neither the one who blocked nor the one blocked sees the other emote', async () => {
    const d: DistrictId = 'walled-city'
    const ta = await resident('Apart Asha')
    const tb = await resident('Apart Bina')
    const a = await live(d, { token: ta })
    const b = await live(d, { token: tb })
    a.send({ t: 'move', x: 50, z: 50, ry: 0 })
    b.send({ t: 'move', x: 52, z: 50, ry: 0 })
    await a.sync()
    await b.sync()
    const c = await walker('Apart Chetan', d, 51, 51)
    expect((await block(ta, devId('Apart Bina'))).status).toBe(204)
    await b.next('leave', (m) => m.id === devId('Apart Asha'))

    // the one who blocked emotes: the one blocked sees nothing, a third person does
    let [fa, fb, fc] = [a.mark(), b.mark(), c.mark()]
    a.send({ t: 'emote', kind: 'dance' })
    expect((await c.next('emote', undefined, fc)).from).toBe(devId('Apart Asha'))
    expect(await emotesSeen(b, fb)).toEqual([])
    // the one blocked emotes: the one who blocked sees nothing, the third person does
    ;[fa, fb, fc] = [a.mark(), b.mark(), c.mark()]
    b.send({ t: 'emote', kind: 'clap' })
    expect((await c.next('emote', undefined, fc)).from).toBe(devId('Apart Bina'))
    expect(await emotesSeen(a, fa)).toEqual([])
  })

  it(`${EMOTE_PER_MINUTE} a minute per sender: the rest are dropped without a word, until the minute is up`, async () => {
    expect(EMOTE_PER_MINUTE).toBe(12)
    const d: DistrictId = 'nahargarh'
    const a = await walker('Often Asha', d, 0)
    const b = await walker('Often Bina', d, 2)
    const [fa, fb] = [a.mark(), b.mark()]
    for (let i = 0; i < EMOTE_PER_MINUTE + 5; i++)
      a.send({ t: 'emote', kind: EMOTE_KINDS[i % EMOTE_KINDS.length]! })
    await a.sync()
    expect(await emotesSeen(b, fb)).toHaveLength(EMOTE_PER_MINUTE)
    expect(a.messages.slice(fa).filter((m) => m.t !== 'pong')).toEqual([])
    // someone else's allowance is their own
    const fa2 = a.mark()
    b.send({ t: 'emote', kind: 'wave' })
    await a.next('emote', undefined, fa2)
    // most of the minute on, still nothing; once it is up, they are seen again
    await later(d, EMOTE_WINDOW_MS - 2000, async () => {
      const mark = b.mark()
      a.send({ t: 'emote', kind: 'dance' })
      await a.sync()
      expect(await emotesSeen(b, mark)).toEqual([])
    })
    await later(d, EMOTE_WINDOW_MS + 1000, async () => {
      const mark = b.mark()
      a.send({ t: 'emote', kind: 'dance' })
      await b.next('emote', undefined, mark)
    })
  }, 20_000)

  it('the allowance is the person’s: a new socket does not refill it, and nor does the district sleeping', async () => {
    const d: DistrictId = 'galta'
    const token = await resident('Spent Asha')
    let a = await live(d, { token })
    a.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await a.sync()
    const b = await walker('Spent Bina', d, 2)
    const fb = b.mark()
    for (let i = 0; i < EMOTE_PER_MINUTE; i++) a.send({ t: 'emote', kind: 'clap' })
    await a.sync()
    expect(await emotesSeen(b, fb)).toHaveLength(EMOTE_PER_MINUTE)

    // another tab takes the place over: the same person, the same spent allowance
    a = await live(d, { token })
    a.send({ t: 'move', x: 0.5, z: 0, ry: 0 })
    await a.sync()
    let mark = b.mark()
    a.send({ t: 'emote', kind: 'clap' })
    await a.sync()
    expect(await emotesSeen(b, mark)).toEqual([])

    // gone altogether and back within the minute: the district still remembers them
    a.close()
    await b.next('leave', (m) => m.id === devId('Spent Asha'))
    a = await live(d, { token })
    a.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await a.sync()
    mark = b.mark()
    a.send({ t: 'emote', kind: 'clap' })
    await a.sync()
    expect(await emotesSeen(b, mark)).toEqual([])

    // the object sleeps and wakes with nothing in memory: the socket still carries what was spent
    await evictDurableObject(stub(d))
    mark = b.mark()
    a.send({ t: 'emote', kind: 'clap' })
    await a.sync()
    expect(await emotesSeen(b, mark)).toEqual([])
    // and the minute still ends when it would have
    await later(d, EMOTE_WINDOW_MS + 1000, async () => {
      mark = b.mark()
      a.send({ t: 'emote', kind: 'clap' })
      await b.next('emote', undefined, mark)
    })
  }, 20_000)

  it('are never stored, and never keep the district awake: no table, no storage, no timer, no alarm moved', async () => {
    const d: DistrictId = 'amer'
    const tables = async () =>
      (
        await testEnv.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{
          name: string
        }>()
      ).results.map((r) => r.name)
    const before = await tables()
    const a = await walker('Store Asha', d, 0)
    const b = await walker('Store Bina', d, 2)
    const alarm = await runInDurableObject(stub(d), (_i, state) => state.storage.getAlarm())
    a.send({ t: 'emote', kind: 'sit' })
    await b.next('emote')
    expect(await tables()).toEqual(before)
    expect(before.some((t) => /emote/i.test(t))).toBe(false)
    const after = await runInDurableObject(stub(d), async (instance, state) => ({
      kept: [...(await state.storage.list()).keys()],
      alarm: await state.storage.getAlarm(),
      // the timer reactions and bench lines hold the object awake with: an emote never arms it
      awake: (instance as unknown as { awake: unknown }).awake,
    }))
    expect(after.kept).toEqual([])
    expect(after.alarm).toBe(alarm)
    expect(after.awake).toBeNull()
  })

  it("the allowance fits the socket's attachment: the largest seat there can be, emotes and all, still saves (the limit is 2,048 bytes)", async () => {
    const d: DistrictId = 'amer'
    const a = await walker('Roomy Asha', d, 30, 30)
    a.send({ t: 'emote', kind: 'clap' })
    await a.sync()
    const sizes = await runInDurableObject(stub(d), (_instance, state) => {
      const ws = state
        .getWebSockets()
        .find((s) => (s.deserializeAttachment() as { userId?: string }).userId === devId('Roomy Asha'))!
      const real = ws.deserializeAttachment() as Record<string, unknown>
      // every field at its largest: the longest id, a 24-point name and an 80-point status of four-byte
      // emoji, a look with every option set, an auto, a bench, an IPv6 address, a flood, and a spent allowance
      const face = {
        id: 'u'.repeat(64),
        name: '🪷'.repeat(24),
        look: { skin: 4, outfit: 'sandstone', head: 'dupatta', tone: 7, hat: 99, hatC: 99, dup: 99, dupC: 99, hair: 99 },
        status: '🪷'.repeat(80),
      }
      const worst = {
        ...real,
        userId: face.id,
        person: face,
        shown: true,
        closed: true,
        pos: { x: -999.99, z: -999.99, ry: -6.283, v: 'auto', at: 1_800_000_000_123, budget: 23.999999999999996 },
        seen: 1_800_000_000_123,
        bad: 4,
        lanes: {
          move: { tokens: 14.999999999999998, at: 1_800_000_000_123 },
          status: { tokens: 0.9999999999999999, at: 1_800_000_000_123 },
          say: { tokens: 0.9999999999999999, at: 1_800_000_000_123 },
          other: { tokens: 19.999999999999996, at: 1_800_000_000_123 },
        },
        flood: { since: 1_800_000_000_123, at: 1_800_000_000_123 },
        bench: { id: 'b'.repeat(64), seat: 3 },
        ip: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
        place: 9999,
        emotes: { since: 1_800_000_000_123, n: EMOTE_PER_MINUTE },
      }
      const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
      // the real test is the runtime's own: it throws past its limit
      let saved = true
      try {
        ws.serializeAttachment(worst)
      } catch {
        saved = false
      }
      const back = saved ? bytes(ws.deserializeAttachment()) : 0
      ws.serializeAttachment(real)
      return { saved, worst: bytes(worst), back, emotes: bytes({ emotes: worst.emotes }), real: bytes(real) }
    })
    expect(sizes.saved, `worst case ${sizes.worst} bytes as JSON`).toBe(true)
    expect(sizes.back).toBe(sizes.worst)
    // as JSON (a little more than the runtime's own encoding of the same seat): under the limit, with room
    expect(sizes.worst).toBeLessThan(2048)
    // what emotes add to every resident's seat
    expect(sizes.emotes).toBeLessThan(48)
  })
})
