import { applyD1Migrations, env, evictDurableObject, runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/env'
import {
  JOG_BURST_M,
  JOG_MAX_SPEED,
  JOG_SPEED,
  LIVE_CLOSE,
  type DistrictId,
  type ServerMsg,
} from '../src/protocol'
import { BENCH_POSITIONS, BENCHES, DISTRICT_IDS, LANES, readWho, whoHeader, type Who } from '../src/district'
import { closeAll, devId, live, login, openLive, resident, WAIT } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const stub = (id: DistrictId) => testEnv.DISTRICT.get(testEnv.DISTRICT.idFromName(id))

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

afterEach(() => closeAll())

describe('the live route', () => {
  it('unknown district id is 404', async () => {
    const res = await openLive('atlantis')
    expect(res.status).toBe(404)
    expect((await openLive('%E0%A4')).status).toBe(404)
  })

  it('a plain request (no upgrade) is refused', async () => {
    expect((await SELF.fetch('https://api.test/api/districts/mi-road/live')).status).toBe(426)
  })

  it('refuses an upgrade from a foreign page, allows ours and no Origin at all', async () => {
    expect((await openLive('mi-road', { headers: { Origin: 'https://evil.example' } })).status).toBe(403)
    const ours = await openLive('mi-road', { headers: { Origin: 'https://gulabi-gali.manishbisht.me' } })
    expect(ours.status).toBe(101)
    ours.webSocket!.accept()
    ours.webSocket!.close(1000)
    const bare = await openLive('mi-road')
    expect(bare.status).toBe(101)
    bare.webSocket!.accept()
    bare.webSocket!.close(1000)
  })

  it('ignores a client-sent X-GG-Who', async () => {
    const forged = JSON.stringify({
      userId: 'dev:mallory',
      person: {
        id: 'dev:mallory',
        name: 'Mallory',
        look: { skin: 0, outfit: 'pink', head: 'none' },
        status: '',
      },
    })
    const watcher = await live('mi-road', { token: await resident('Forge Watcher') })
    const res = await openLive('mi-road', { headers: { 'X-GG-Who': forged } })
    expect(res.status).toBe(101)
    const ws = res.webSocket!
    const got: { t: string; you?: unknown }[] = []
    ws.accept()
    ws.addEventListener('message', (e) => {
      got.push(JSON.parse(e.data as string))
    })
    await vi.waitFor(() => expect(got.some((m) => m.t === 'welcome')).toBe(true), WAIT)
    expect(got.find((m) => m.t === 'welcome')!.you).toEqual({ id: null, visible: false })
    ws.send(JSON.stringify({ t: 'move', x: 1, z: 1, ry: 0 }))
    await watcher.sync()
    expect(watcher.all('join').map((m) => m.p.id)).not.toContain('dev:mallory')
    ws.close(1000)
  })

  it('X-GG-Who is plain ASCII, and any name survives the trip', () => {
    for (const name of ['अनन्या', '🌸Phool']) {
      const who: Who = {
        userId: 'dev:x',
        person: { id: 'dev:x', name, look: { skin: 1, outfit: 'pink', head: 'none' }, status: 'चाय ☕' },
        ip: '2001:db8::7',
      }
      const header = whoHeader(who)
      expect(header).toMatch(/^[\x21-\x7e]+$/)
      expect(readWho(header)).toEqual(who)
    }
    expect(readWho('{"userId":"dev:x"')).toEqual({ userId: null, person: null, ip: null })
    expect(readWho('%E0%A4')).toEqual({ userId: null, person: null, ip: null })
  })

  it('a Devanagari or emoji name reaches the street intact', async () => {
    const watcher = await live('university')
    const hindi = await live('university', { token: await resident('Hindi Naam', { name: 'अनन्या' }) })
    const emoji = await live('university', { token: await resident('Emoji Naam', { name: '🌸Phool' }) })
    hindi.send({ t: 'move', x: 1, z: 1, ry: 0 })
    emoji.send({ t: 'move', x: 2, z: 1, ry: 0 })
    expect((await watcher.next('join', (m) => m.p.id === 'dev:hindi-naam')).p.name).toBe('अनन्या')
    expect((await watcher.next('join', (m) => m.p.id === 'dev:emoji-naam')).p.name).toBe('🌸Phool')
  })
})

describe('DistrictDO', () => {
  it('a ghost gets welcome but is never listed', async () => {
    const r = await live('walled-city', { token: await resident('Listed Rani') })
    r.send({ t: 'move', x: 2, z: 3, ry: 0.5 })
    await r.sync()

    const ghost = await live('walled-city')
    const welcome = await ghost.next('welcome')
    expect(welcome.you).toEqual({ id: null, visible: false })
    expect(welcome.people).toContainEqual({
      id: 'dev:listed-rani',
      name: 'Listed',
      look: { skin: 1, outfit: 'pink', head: 'none' },
      status: 'chai pe',
      x: 2,
      z: 3,
      ry: 0.5,
    })
    // Nothing private ever goes down a ghost's socket.
    expect(JSON.stringify(ghost.messages)).not.toContain('Raja Park')
    expect(JSON.stringify(ghost.messages)).not.toContain('Private')

    // Signed in without a complete profile is a ghost too, though it knows who it is.
    const halfway = await live('walled-city', { token: await login('Halfway Hari') })
    expect((await halfway.next('welcome')).you).toEqual({ id: 'dev:halfway-hari', visible: false })

    ghost.send({ t: 'move', x: 2.5, z: 3, ry: 0 })
    halfway.send({ t: 'move', x: 3, z: 3, ry: 0 })
    await ghost.sync()
    await halfway.sync()
    // R sees moves near it, but never a ghost.
    r.send({ t: 'move', x: 2.2, z: 3, ry: 0.5 })
    await ghost.next('moves', (m) => m.m.some(([id]) => id === 'dev:listed-rani'))
    await r.sync()
    expect(r.all('join')).toEqual([])
    expect(r.all('moves').flatMap((m) => m.m.map(([id]) => id))).not.toContain('dev:halfway-hari')

    const later = await live('walled-city', { token: await resident('Later Lalit') })
    const ids = (await later.next('welcome')).people.map((p) => p.id)
    expect(ids).toContain('dev:listed-rani')
    expect(ids).not.toContain('dev:halfway-hari')
    expect(ids).toHaveLength(new Set(ids).size)
  })

  it('a resident appears to others after the first move and leaves on close', async () => {
    const watcher = await live('university')
    await watcher.next('welcome')
    const a = await live('university', { token: await resident('Arrive Anu') })
    expect((await a.next('welcome')).you).toEqual({ id: 'dev:arrive-anu', visible: true })
    await a.sync()
    await watcher.sync()
    expect(watcher.all('join')).toEqual([])

    a.send({ t: 'move', x: 10, z: -4, ry: 1 })
    const join = await watcher.next('join', (m) => m.p.id === 'dev:arrive-anu')
    expect(join.p).toEqual({
      id: 'dev:arrive-anu',
      name: 'Arrive',
      look: { skin: 1, outfit: 'pink', head: 'none' },
      status: 'chai pe',
      x: 10,
      z: -4,
      ry: 1,
    })

    a.close()
    await watcher.next('leave', (m) => m.id === 'dev:arrive-anu')
  })

  it('moves are only relayed within 60 m', async () => {
    const a = await live('malviya-nagar', { token: await resident('Near Neha') })
    const b = await live('malviya-nagar', { token: await resident('Near Bina') })
    const c = await live('malviya-nagar', { token: await resident('Far Farid') })
    const d = await live('malviya-nagar', { token: await resident('Far Dev') })
    a.send({ t: 'move', x: 0, z: 0, ry: 0 })
    b.send({ t: 'move', x: 40, z: 0, ry: 0 })
    c.send({ t: 'move', x: 100, z: 0, ry: 0 })
    d.send({ t: 'move', x: 105, z: 0, ry: 0 })
    for (const s of [a, b, c, d]) await s.sync()
    const [fromB, fromC] = [b.mark(), c.mark()]

    // A and D move in the same batch: C, 100 m from A, hears only D.
    a.send({ t: 'move', x: 1, z: 0, ry: 0.25 })
    d.send({ t: 'move', x: 106, z: 0, ry: 0 })
    const atB = await b.next('moves', undefined, fromB)
    expect(atB.m).toEqual([['dev:near-neha', 1, 0, 0.25]])
    const atC = await c.next('moves', undefined, fromC)
    expect(atC.m).toEqual([['dev:far-dev', 106, 0, 0]])
    // A does not hear about itself.
    await a.sync()
    expect(a.all('moves').flatMap((m) => m.m.map(([id]) => id))).not.toContain('dev:near-neha')
  })

  it('coalesces a burst of moves into one frame with the latest point', async () => {
    const a = await live('mi-road', { token: await resident('Burst Bela') })
    const b = await live('mi-road', { token: await resident('Burst Watcher') })
    a.send({ t: 'move', x: 0, z: 0, ry: 0 })
    b.send({ t: 'move', x: 5, z: 0, ry: 0 })
    await a.sync()
    await b.sync()
    const from = b.mark()
    for (let i = 1; i <= 5; i++) a.send({ t: 'move', x: i * 0.1, z: 0, ry: 0 })
    const first = await b.next('moves', undefined, from)
    expect(first.m).toEqual([['dev:burst-bela', 0.5, 0, 0]])
    expect(b.all('moves', from)).toHaveLength(1)
  })

  it('a too-fast move is refused with the last good point', async () => {
    const a = await live('mi-road', { token: await resident('Speedy Sona') })
    const b = await live('mi-road', { token: await resident('Speed Watcher') })
    a.send({ t: 'move', x: 3, z: 4, ry: 0.5 })
    b.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await a.sync()
    await b.sync()
    const from = b.mark()
    a.send({ t: 'move', x: 53, z: 4, ry: 0 })
    expect(await a.next('error')).toEqual({ t: 'error', code: 'too-fast', x: 3, z: 4, ry: 0.5 })
    // The refused point was never relayed; a walk on from the good one is.
    a.send({ t: 'move', x: 3.5, z: 4, ry: 0 })
    const moves = await b.next('moves', undefined, from)
    expect(moves.m).toEqual([['dev:speedy-sona', 3.5, 4, 0]])
  })

  it('an auto moves at 12 m/s with a 24 m burst; walking stays at 8, and v is validated strictly', async () => {
    const a = await live('mi-road', { token: await resident('Auto Anil') })
    const b = await live('mi-road', { token: await resident('Auto Watcher') })
    const walker = await live('mi-road', { token: await resident('Walk Wasim') })
    // the first point of a socket gets a full burst of its own pace
    a.send({ t: 'move', x: 0, z: 0, ry: 0, v: 'auto' })
    b.send({ t: 'move', x: 5, z: 0, ry: 0 })
    walker.send({ t: 'move', x: 10, z: 0, ry: 0 })
    for (const c of [a, b, walker]) await c.sync()
    const from = b.mark()

    // 10 m at once: past a walker's 8 m burst, inside an auto's 12 m
    walker.send({ t: 'move', x: 20, z: 0, ry: 0 })
    expect((await walker.next('error')).code).toBe('too-fast')
    a.send({ t: 'move', x: 10, z: 0, ry: 0, v: 'auto' })
    const moved = await b.next('moves', (m) => m.m.some(([id]) => id === 'dev:auto-anil'), from)
    // the flag rides along, so the others can draw an auto under the driver
    expect(moved.m.find(([id]) => id === 'dev:auto-anil')).toEqual(['dev:auto-anil', 10, 0, 0, 'auto'])

    // and the auto's allowance still ends: 14 m of burst are left, not 20
    a.send({ t: 'move', x: 30, z: 0, ry: 0, v: 'auto' })
    expect(await a.next('error')).toEqual({ t: 'error', code: 'too-fast', x: 10, z: 0, ry: 0 })

    // anything but absent or 'auto' is a bad frame
    for (const v of ['bike', null, true, 12]) a.raw(JSON.stringify({ t: 'move', x: 10, z: 0, ry: 0, v }))
    await a.sync()
    expect(a.all('error').filter((e) => e.code === 'invalid')).toHaveLength(4)

    // stepping out drops the flag from the next relay
    const out = b.mark()
    a.send({ t: 'move', x: 10.5, z: 0, ry: 0 })
    const after = await b.next('moves', (m) => m.m.some(([id]) => id === 'dev:auto-anil'), out)
    expect(after.m.find(([id]) => id === 'dev:auto-anil')).toEqual(['dev:auto-anil', 10.5, 0, 0])
  })

  it('a driver who stalled for 2 s and catches up at 12 m/s is not refused, and the burst still ends', async () => {
    const a = await live('mi-road', { token: await resident('Stall Sunil') })
    a.send({ t: 'move', x: 0, z: 0, ry: 0, v: 'auto' })
    await a.sync()
    // two seconds of frames arriving at once: 24 m in 12 m hops, which a 12 m burst would have refused
    a.send({ t: 'move', x: 12, z: 0, ry: 0, v: 'auto' })
    a.send({ t: 'move', x: 24, z: 0, ry: 0, v: 'auto' })
    await a.sync()
    expect(a.all('error')).toEqual([])
    // that was all the burst there is
    a.send({ t: 'move', x: 40, z: 0, ry: 0, v: 'auto' })
    expect((await a.next('error')).code).toBe('too-fast')
  })

  /** Plays move frames into a new resident's socket at clock offsets (ms) from now; gives back the errors heard. */
  async function playMoves(name: string, frames: [ms: number, x: number, extra?: object][]) {
    const a = await live('mi-road', { token: await resident(name) })
    await a.next('welcome')
    await runInDurableObject(stub('mi-road'), async (instance, state) => {
      const ws = state
        .getWebSockets()
        .find((s) => (s.deserializeAttachment() as { userId?: string } | null)?.userId === devId(name))!
      const t = Date.now()
      try {
        for (const [ms, x, extra] of frames) {
          instance.clock = () => t + ms
          await instance.webSocketMessage(ws, JSON.stringify({ t: 'move', x, z: 0, ry: 0, ...extra }))
        }
      } finally {
        instance.clock = Date.now
      }
    })
    await a.sync()
    return a.all('error')
  }
  const JOG = { pace: 'jog' }
  /**
   * Ten seconds of jogging (a move every 100 ms, as the client throttles them), then `stall` seconds with nothing
   * heard whose distance lands in four hops at once, then a second more of jogging. Ends at `end` (ms, x).
   */
  function jogged(stall: number, extra?: object) {
    const frames: [number, number, object?][] = []
    for (let i = 0; i <= 100; i++) frames.push([i * 100, (i * JOG_SPEED) / 10, extra])
    let ms = 10_000 + stall * 1000
    let x = JOG_SPEED * 10
    for (let k = 1; k <= 4; k++) frames.push([ms, x + (k * JOG_SPEED * stall) / 4, extra])
    x += JOG_SPEED * stall
    for (let i = 1; i <= 10; i++) frames.push([ms + i * 100, x + (i * JOG_SPEED) / 10, extra])
    ms += 1000
    x += JOG_SPEED
    return { frames, end: { ms, x } }
  }

  it('the jog claim: 8 m/s with a 16 m burst, two seconds of a 7.2 m/s jog (1.8x the 4 m/s walk)', () => {
    expect(JOG_SPEED).toBeCloseTo(7.2)
    expect(JOG_MAX_SPEED).toBeGreaterThan(JOG_SPEED)
    expect(JOG_BURST_M).toBeGreaterThanOrEqual(2 * JOG_SPEED)
    expect(JOG_BURST_M).toBeLessThan(20)
  })

  it('claiming a jog, a jogger whose frames stall for 2 s is not refused; a 20 m hop still is, a 15.9 m one not', async () => {
    const { frames, end } = jogged(2, JOG)
    // stood still five seconds: a full burst, and no more
    frames.push([end.ms + 5000, end.x + 20, JOG], [end.ms + 5000, end.x + 15.9, JOG])
    const errors = await playMoves('Jog Jaya', frames)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ code: 'too-fast', z: 0 })
    expect((errors[0] as { x: number }).x).toBeCloseTo(end.x)
  })

  it('a 1.5 s stall at a jog is refused without the claim, and not with it', async () => {
    const plain = await playMoves('Plain Pooja', jogged(1.5).frames)
    expect(plain.length).toBeGreaterThan(0)
    expect(plain.every((e) => e.code === 'too-fast')).toBe(true)
    expect(await playMoves('Claim Chetan', jogged(1.5, JOG).frames)).toEqual([])
  })

  it('an unflagged 10 m hop is still refused; a claim other than "jog" is ignored, not a bad frame', async () => {
    const errors = await playMoves('Hop Harsh', [
      [0, 0],
      [5000, 10],
      [5000, 10, { pace: 'run' }],
      [5000, 10, { pace: 1 }],
      [5000, 10, { pace: null }],
      [5000, 10, JOG], // the claim's own burst covers it
    ])
    expect(errors.map((e) => e.code)).toEqual(['too-fast', 'too-fast', 'too-fast', 'too-fast'])
  })

  it('outrunning a jog for long is still refused, claim or not: 10 m/s runs out of burst', async () => {
    for (const [name, extra] of [
      ['Dash Dinesh', undefined],
      ['Dash Divya', JOG],
    ] as const) {
      const frames: [number, number, object?][] = []
      for (let i = 0; i <= 120; i++) frames.push([i * 100, i, extra])
      const errors = await playMoves(name, frames)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.every((e) => e.code === 'too-fast')).toBe(true)
    }
  })

  it('a ghost cannot status/sit/say', async () => {
    const ghost = await live('university')
    await ghost.next('welcome')
    ghost.send({ t: 'status', text: 'hello' })
    ghost.send({ t: 'sit', bench: 'university:0' })
    ghost.send({ t: 'say', text: 'hi' })
    await ghost.sync()
    expect(ghost.all('error')).toEqual([
      { t: 'error', code: 'ghost' },
      { t: 'error', code: 'ghost' },
      { t: 'error', code: 'ghost' },
    ])
  })

  it('status is broadcast and written through to the profile', async () => {
    const a = await live('walled-city', { token: await resident('Status Sita') })
    const watcher = await live('walled-city')
    a.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await watcher.next('join', (m) => m.p.id === 'dev:status-sita')
    a.send({ t: 'status', text: '  kitaab dhoondh rahi  ' })
    expect(await watcher.next('status', (m) => m.id === 'dev:status-sita')).toEqual({
      t: 'status',
      id: 'dev:status-sita',
      text: 'kitaab dhoondh rahi',
    })
    await vi.waitFor(async () => {
      const row = await testEnv.DB.prepare('SELECT status FROM profiles WHERE user_id = ?')
        .bind('dev:status-sita')
        .first<{ status: string }>()
      expect(row?.status).toBe('kitaab dhoondh rahi')
    }, WAIT)
    // A newcomer sees the new line in its welcome.
    const later = await live('walled-city')
    const people = (await later.next('welcome')).people
    expect(people.find((p) => p.id === 'dev:status-sita')?.status).toBe('kitaab dhoondh rahi')

    a.send({ t: 'status', text: 'x'.repeat(81) })
    expect(await a.next('error')).toEqual({ t: 'error', code: 'invalid' })
  })

  it('invalid frames are refused and the socket closes after five', async () => {
    const a = await live('university', { token: await resident('Garbage Gopal') })
    const watcher = await live('university')
    a.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await watcher.next('join', (m) => m.p.id === 'dev:garbage-gopal')
    const from = watcher.mark()
    a.raw('not json')
    a.raw(JSON.stringify({ t: 'status', text: 'y'.repeat(2100) }))
    a.raw('{"t":"dance"}')
    a.raw('{"t":"move","x":1e999,"z":0,"ry":0}')
    // Not a ping to sync on: a good frame would forgive the strikes.
    await vi.waitFor(() => expect(a.all('error')).toHaveLength(4), WAIT)
    expect(a.closes).toEqual([])
    a.raw('[]')
    await vi.waitFor(() => expect(a.closes).toEqual([LIVE_CLOSE.invalid]), WAIT)
    expect(a.all('error')).toEqual(Array(5).fill({ t: 'error', code: 'invalid' }))
    // Nothing of it was echoed to anyone else, and the bad socket's person is gone.
    await watcher.next('leave', (m) => m.id === 'dev:garbage-gopal', from)
    await watcher.sync()
    expect(watcher.messages.slice(from)).toEqual([{ t: 'leave', id: 'dev:garbage-gopal' }, { t: 'pong' }])
  })

  it('strikes are for consecutive bad frames: a good one forgives them', async () => {
    const a = await live('mi-road', { token: await resident('Fumble Farah') })
    const bad = () => {
      a.raw('nope')
      a.send({ t: 'status', text: 'z'.repeat(81) }) // an honest typo past 80 is refused, not held against them
      a.raw('{"t":"dance"}')
      a.raw('{"t":"move","x":1e999,"z":0,"ry":0}')
    }
    bad()
    a.send({ t: 'move', x: 1, z: 1, ry: 0 })
    bad()
    await a.sync()
    expect(a.all('error')).toEqual(Array(8).fill({ t: 'error', code: 'invalid' }))
    expect(a.closes).toEqual([])
  })

  it('a status flood gets rate, and at most one status goes out per window', async () => {
    const a = await live('university', { token: await resident('Chatty Chetan') })
    const watcher = await live('university')
    a.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await watcher.next('join', (m) => m.p.id === 'dev:chatty-chetan')
    const from = watcher.mark()
    for (let i = 0; i < 6; i++) a.send({ t: 'status', text: `line ${i}` })
    await a.sync()
    expect(a.all('error')).toEqual([{ t: 'error', code: 'rate' }])
    await watcher.sync()
    expect(watcher.all('status', from)).toEqual([{ t: 'status', id: 'dev:chatty-chetan', text: 'line 0' }])
    await vi.waitFor(async () => {
      const now = await testEnv.DB.prepare('SELECT status FROM profiles WHERE user_id = ?')
        .bind('dev:chatty-chetan')
        .first<{ status: string }>()
      expect(now?.status).toBe('line 0')
    }, WAIT)
  })

  it('a move flood gets rate', async () => {
    const a = await live('walled-city', { token: await resident('Flood Firoz') })
    for (let i = 0; i < 80; i++) a.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await a.sync()
    expect(a.all('error')).toEqual([{ t: 'error', code: 'rate' }])
    expect(a.closes).toEqual([])
  })

  /** The server end of `userId`'s open socket in `state`. */
  const socketOf = (state: DurableObjectState, userId: string) =>
    state
      .getWebSockets()
      .find(
        (s) =>
          (s.deserializeAttachment() as { userId?: string; closed?: boolean } | null)?.userId === userId &&
          !(s.deserializeAttachment() as { closed?: boolean }).closed,
      )!
  const moveTo = (x: number) => JSON.stringify({ t: 'move', x, z: 0, ry: 0 })

  it('the move lane takes 15 at once, then 12 a second', async () => {
    expect(LANES.move).toEqual({ perSecond: 12, burst: 15 })
    const district = stub('university')
    const a = await live('university', { token: await resident('Lane Lata') })
    await a.next('welcome')
    await runInDurableObject(district, async (instance, state) => {
      const ws = socketOf(state, 'dev:lane-lata')
      const t = Date.now()
      try {
        instance.clock = () => t
        // The 16th of a burst is one too many.
        for (let i = 0; i < 16; i++) await instance.webSocketMessage(ws, moveTo(0))
        // A second later (and a new flood), twelve more fit and the 13th does not.
        instance.clock = () => t + 1001
        for (let i = 0; i < 13; i++) await instance.webSocketMessage(ws, moveTo(0))
      } finally {
        instance.clock = Date.now
      }
    })
    await a.sync()
    expect(a.all('error')).toEqual([
      { t: 'error', code: 'rate' },
      { t: 'error', code: 'rate' },
    ])
  })

  it('a position is written through at most once a second, and the last one still lands', async () => {
    const district = stub('mi-road')
    const a = await live('mi-road', { token: await resident('Saver Seema') })
    await a.next('welcome')
    const stored = () =>
      runInDurableObject(
        district,
        (_instance, state) =>
          (socketOf(state, 'dev:saver-seema').deserializeAttachment() as { pos: { x: number } | null }).pos
            ?.x,
      )
    const t = Date.now()
    await runInDurableObject(district, async (instance, state) => {
      const ws = socketOf(state, 'dev:saver-seema')
      try {
        instance.clock = () => t
        await instance.webSocketMessage(ws, moveTo(1)) // the first point: written at once
        instance.clock = () => t + 100
        await instance.webSocketMessage(ws, moveTo(1.5)) // too soon: memory only, for now
      } finally {
        instance.clock = Date.now
      }
    })
    expect(await stored()).toBe(1)
    // With nothing more said, the held point is written within the second.
    await vi.waitFor(async () => expect(await stored()).toBe(1.5), WAIT)
  })

  it('a failed attachment write is logged, unless the socket is closing', async () => {
    const district = stub('walled-city')
    const a = await live('walled-city', { token: await resident('Heavy Hema') })
    await a.next('welcome')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await runInDurableObject(district, (instance, state) => {
        const ws = socketOf(state, 'dev:heavy-hema')
        const write = (instance as unknown as { write(ws: WebSocket, seat: unknown): void }).write.bind(
          instance,
        )
        // A function cannot be serialised: the write throws on an open socket.
        write(ws, { ...(ws.deserializeAttachment() as object), junk: () => 1 })
        expect(logged).toHaveBeenCalledWith('district: attachment write failed', expect.anything())
        logged.mockClear()
        ws.close(1000, 'bye')
        write(ws, { ...(ws.deserializeAttachment() as object), junk: () => 1 })
        expect(logged).not.toHaveBeenCalled()
      })
    } finally {
      logged.mockRestore()
    }
  })

  it('a failed status write is logged', async () => {
    const district = stub('mi-road')
    const a = await live('mi-road', { token: await resident('Offline Omar') })
    await a.next('welcome')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = {
      prepare: () => ({ bind: () => ({ run: () => Promise.reject(new Error('d1 down')) }) }),
    }
    let real: unknown
    await runInDurableObject(district, (instance) => {
      const held = instance as unknown as { env: Env }
      real = held.env
      held.env = { ...held.env, DB: failing as unknown as D1Database }
    })
    try {
      a.send({ t: 'status', text: 'net gaya' })
      await vi.waitFor(
        () => expect(logged).toHaveBeenCalledWith('district: status write failed', expect.any(Error)),
        WAIT,
      )
    } finally {
      logged.mockRestore()
      await runInDurableObject(district, (instance) => {
        ;(instance as unknown as { env: unknown }).env = real
      })
    }
  })

  it('a spent status allowance survives a wake', async () => {
    const district = stub('walled-city')
    const a = await live('walled-city', { token: await resident('Thrifty Tanvi') })
    await a.next('welcome')
    a.send({ t: 'status', text: 'pehli line' })
    await a.sync()
    expect(a.all('error')).toEqual([])
    // Forget everything held in memory, as a wake from hibernation does.
    await runInDurableObject(district, (instance) => {
      ;(instance as unknown as { seats: WeakMap<object, unknown> }).seats = new WeakMap()
    })
    a.send({ t: 'status', text: 'doosri line' })
    await a.sync()
    expect(a.all('error')).toEqual([{ t: 'error', code: 'rate' }])
  })

  it('an unchanged status is neither broadcast nor written', async () => {
    const a = await live('malviya-nagar', { token: await resident('Same Sameer') })
    const watcher = await live('malviya-nagar')
    a.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await watcher.next('join', (m) => m.p.id === 'dev:same-sameer')
    const read = () =>
      testEnv.DB.prepare('SELECT status, updated_at FROM profiles WHERE user_id = ?')
        .bind('dev:same-sameer')
        .first<{ status: string; updated_at: number }>()
    const before = await read()
    const from = watcher.mark()
    a.send({ t: 'status', text: ' chai pe ' })
    await a.sync()
    await watcher.sync()
    expect(watcher.all('status', from)).toEqual([])
    expect(a.all('status')).toEqual([])
    expect(await read()).toEqual(before)
  })

  it('flooding for 3 s on end closes the socket', async () => {
    const district = stub('malviya-nagar')
    const a = await live('malviya-nagar', { token: await resident('Pushy Pinto') })
    await a.next('welcome')
    const start = Date.now() + 60_000
    try {
      for (let step = 0; step <= 6 && !a.closes.length; step++) {
        const at = start + step * 500
        await runInDurableObject(district, (instance) => {
          instance.clock = () => at
        })
        a.send({ t: 'status', text: `push ${step}a` })
        a.send({ t: 'status', text: `push ${step}b` })
        if (step < 6) await a.sync()
      }
    } finally {
      await runInDurableObject(district, (instance) => {
        instance.clock = Date.now
      })
    }
    // the close lands after the flood; give it room when the whole suite runs at once
    await vi.waitFor(() => expect(a.closes).toEqual([LIVE_CLOSE.invalid]), { ...WAIT, timeout: 10_000 })
    // One `rate` for the whole stretch, not one per frame.
    expect(a.all('error')).toEqual([{ t: 'error', code: 'rate' }])
  }, 20_000) // the flood itself takes 3 s; the default 5 s left no room under a loaded machine

  it('a replaced socket stays gone after the object wakes', async () => {
    const district = stub('walled-city')
    const token = await resident('Waking Wasim')
    const watcher = await live('walled-city')
    const first = await live('walled-city', { token })
    first.send({ t: 'move', x: 4, z: 4, ry: 0 })
    await watcher.next('join', (m) => m.p.id === 'dev:waking-wasim')
    const from = watcher.mark()
    const who: Who = {
      userId: 'dev:waking-wasim',
      person: {
        id: 'dev:waking-wasim',
        name: 'Waking',
        look: { skin: 1, outfit: 'pink', head: 'none' },
        status: '',
      },
      ip: null,
    }
    // All in one turn, while the replaced socket is still closing: a second socket takes over, the object
    // forgets everything it held in memory (as a wake from hibernation does), and both sockets send a move.
    const heard = await runInDurableObject(district, async (instance, state) => {
      const res = await instance.fetch(
        new Request('https://district.internal/walled-city', {
          headers: { Upgrade: 'websocket', 'X-GG-Who': whoHeader(who) },
        }),
      )
      res.webSocket!.accept()
      const memory = instance as unknown as { seats: WeakMap<object, unknown>; gone?: WeakSet<object> }
      memory.seats = new WeakMap()
      if (memory.gone) memory.gone = new WeakSet()
      const mine = state
        .getWebSockets()
        .filter((ws) => (ws.deserializeAttachment() as { userId?: string } | null)?.userId === who.userId)
      for (const ws of mine)
        await instance.webSocketMessage(ws, JSON.stringify({ t: 'move', x: 4.5, z: 4, ry: 0 }))
      return mine.length
    })
    expect(heard).toBe(2)
    await vi.waitFor(() => expect(first.closes).toEqual([LIVE_CLOSE.replaced]), WAIT)
    await watcher.sync()
    expect(watcher.all('join', from).map((m) => m.p.id)).toEqual(['dev:waking-wasim'])
    const newcomer = await live('walled-city')
    const ids = (await newcomer.next('welcome')).people.map((p) => p.id)
    expect(ids.filter((id) => id === 'dev:waking-wasim')).toHaveLength(1)
  })

  it('a socket the server closed stays gone after the object wakes', async () => {
    const district = stub('university')
    const watcher = await live('university')
    const a = await live('university', { token: await resident('Closed Kiran') })
    a.send({ t: 'move', x: 2, z: 2, ry: 0 })
    await watcher.next('join', (m) => m.p.id === 'dev:closed-kiran')
    const from = watcher.mark()
    // In one turn, while the socket is still closing: five strikes close it, memory is lost, it moves, and a
    // newcomer arrives.
    const listed = await runInDurableObject(district, async (instance, state) => {
      const [ws] = state
        .getWebSockets()
        .filter(
          (s) => (s.deserializeAttachment() as { userId?: string } | null)?.userId === 'dev:closed-kiran',
        )
      if (!ws) return null
      for (let i = 0; i < 5; i++) await instance.webSocketMessage(ws, 'nope')
      ;(instance as unknown as { seats: WeakMap<object, unknown> }).seats = new WeakMap()
      await instance.webSocketMessage(ws, JSON.stringify({ t: 'move', x: 2.5, z: 2, ry: 0 }))
      const res = await instance.fetch(
        new Request('https://district.internal/university', {
          headers: { Upgrade: 'websocket', 'X-GG-Who': whoHeader({ userId: null, person: null, ip: null }) },
        }),
      )
      const client = res.webSocket!
      const first = new Promise<string>((resolve) => {
        client.addEventListener('message', (e) => resolve(e.data as string), { once: true })
      })
      client.accept()
      const welcome = JSON.parse(await first) as Extract<ServerMsg, { t: 'welcome' }>
      client.close(1000)
      return welcome.people.map((p) => p.id)
    })
    expect(listed).not.toBeNull()
    expect(listed).not.toContain('dev:closed-kiran')
    await watcher.next('leave', (m) => m.id === 'dev:closed-kiran', from)
    await watcher.sync()
    expect(watcher.all('join', from)).toEqual([])
  })

  it('a second socket for the same user replaces the first', async () => {
    const token = await resident('Twice Tara')
    const watcher = await live('malviya-nagar')
    const first = await live('malviya-nagar', { token })
    first.send({ t: 'move', x: 7, z: 7, ry: 0 })
    await watcher.next('join', (m) => m.p.id === 'dev:twice-tara')

    const second = await live('malviya-nagar', { token })
    const welcome = await second.next('welcome')
    expect(welcome.you).toEqual({ id: 'dev:twice-tara', visible: true })
    expect(welcome.people.map((p) => p.id)).not.toContain('dev:twice-tara')
    await vi.waitFor(() => expect(first.closes).toEqual([LIVE_CLOSE.replaced]), WAIT)

    // The new socket picks up where the old one stood: no leave, still one avatar.
    second.send({ t: 'move', x: 7.5, z: 7, ry: 0 })
    watcher.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await watcher.next('moves', (m) => m.m.some(([id, x]) => id === 'dev:twice-tara' && x === 7.5))
    await watcher.sync()
    expect(watcher.all('leave').map((m) => m.id)).not.toContain('dev:twice-tara')
    const newcomer = await live('malviya-nagar')
    const ids = (await newcomer.next('welcome')).people.map((p) => p.id)
    expect(ids.filter((id) => id === 'dev:twice-tara')).toHaveLength(1)
  })

  it('drops a silent socket and broadcasts leave', async () => {
    const district = stub('mi-road')
    const silent = await live('mi-road', { token: await resident('Silent Suman') })
    const watcher = await live('mi-road', { token: await resident('Awake Asif') })
    silent.send({ t: 'move', x: 1, z: 1, ry: 0 })
    await watcher.next('join', (m) => m.p.id === 'dev:silent-suman')

    const later = Date.now() + 31_000
    await runInDurableObject(district, (instance) => {
      instance.clock = () => later
    })
    try {
      // The watcher is still moving at the later time; the silent one has said nothing for 31 s.
      watcher.send({ t: 'move', x: 2, z: 2, ry: 0 })
      await watcher.sync()
      await runInDurableObject(district, (instance) => instance.sweep(later))
    } finally {
      await runInDurableObject(district, (instance) => {
        instance.clock = Date.now
      })
    }
    await watcher.next('leave', (m) => m.id === 'dev:silent-suman')
    await vi.waitFor(() => expect(silent.closes).toEqual([LIVE_CLOSE.idle]), WAIT)
    expect(watcher.closes).toEqual([])
  })

  it('positions survive the object hibernating', async () => {
    const a = await live('university', { token: await resident('Sleepy Sana') })
    a.send({ t: 'move', x: 12, z: -3, ry: 2 })
    await a.sync()
    await evictDurableObject(stub('university'))
    const later = await live('university')
    const me = (await later.next('welcome')).people.find((p) => p.id === 'dev:sleepy-sana')
    expect(me).toMatchObject({ x: 12, z: -3, ry: 2 })
    a.send({ t: 'move', x: 12.5, z: -3, ry: 2 })
    later.send({ t: 'move', x: 10, z: -3, ry: 0 })
    await later.next('moves', (m) => m.m.some(([id]) => id === 'dev:sleepy-sana'))
  })

  it('answers ping with pong', async () => {
    const a = await live('walled-city')
    a.send({ t: 'ping' })
    expect(await a.next('pong')).toEqual({ t: 'pong' })
  })
})

describe('benches', () => {
  /** A point `off` metres east of bench `i` in `district`: within reach of it unless `off` says otherwise. */
  const by = (district: DistrictId, i: number, off = 1.5) => {
    const at = BENCH_POSITIONS[district][i]!
    return { x: at.x + off, z: at.z }
  }

  /** A resident standing by bench `i`, seated there. */
  async function sitter(name: string, district: DistrictId, i: number) {
    const c = await live(district, { token: await resident(name) })
    c.send({ t: 'move', ...by(district, i), ry: 0 })
    c.send({ t: 'sit', bench: `${district}:${i}` })
    await c.next('seated', (m) => m.bench === `${district}:${i}`)
    return c
  }

  it('bench ids cover every district', () => {
    for (const id of DISTRICT_IDS) expect(BENCH_POSITIONS[id]).toHaveLength(BENCHES[id])
  })

  it('only sitters receive bench lines', async () => {
    const a = await sitter('Bench Asha', 'walled-city', 2)
    const b = await sitter('Bench Bilal', 'walled-city', 2)
    // C stands right there but has not sat; G is a ghost by the bench.
    const c = await live('walled-city', { token: await resident('Bench Chandu') })
    c.send({ t: 'move', ...by('walled-city', 2, -1), ry: 0 })
    const g = await live('walled-city')
    g.send({ t: 'move', ...by('walled-city', 2, 1), ry: 0 })
    await c.sync()
    await g.sync()

    // A hears B arrive; B was told who was already there.
    expect(b.all('seated').at(-1)).toEqual({ t: 'seated', bench: 'walled-city:2', seat: 1, with: ['Bench'] })
    expect(await a.next('seated', (m) => m.with.length === 1)).toEqual({
      t: 'seated',
      bench: 'walled-city:2',
      seat: 0,
      with: ['Bench'],
    })

    a.send({ t: 'say', text: '  chai​ peeoge?\n ' })
    const heard = await b.next('bench')
    expect(heard).toEqual({
      t: 'bench',
      bench: 'walled-city:2',
      from: 'dev:bench-asha',
      name: 'Bench',
      text: 'chai peeoge?',
      at: expect.any(Number),
    })
    expect(await a.next('bench')).toEqual(heard)
    await c.sync()
    await g.sync()
    expect(c.all('bench')).toEqual([])
    expect(g.all('bench')).toEqual([])

    // Someone not seated cannot talk, and a line past 200 characters is refused.
    c.send({ t: 'say', text: 'mujhe bhi' })
    expect(await c.next('error')).toEqual({ t: 'error', code: 'invalid' })
    const from = b.mark()
    a.send({ t: 'say', text: 'x'.repeat(201) })
    expect(await a.next('error')).toEqual({ t: 'error', code: 'invalid' })
    await b.sync()
    expect(b.all('bench', from)).toEqual([])
  })

  it('a ghost cannot sit', async () => {
    const g = await live('university')
    g.send({ t: 'move', ...by('university', 0), ry: 0 })
    g.send({ t: 'sit', bench: 'university:0' })
    g.send({ t: 'say', text: 'koi hai?' })
    await g.sync()
    expect(g.all('error')).toEqual([
      { t: 'error', code: 'ghost' },
      { t: 'error', code: 'ghost' },
    ])
    expect(g.all('seated')).toEqual([])
  })

  it('fifth sitter gets full', async () => {
    const four = []
    for (const name of ['Full Anu', 'Full Babu', 'Full Chini', 'Full Dolly'])
      four.push(await sitter(name, 'mi-road', 0))
    expect(four[3]!.all('seated').at(-1)).toMatchObject({ seat: 3, with: ['Full', 'Full', 'Full'] })
    const fifth = await live('mi-road', { token: await resident('Full Eshan') })
    fifth.send({ t: 'move', ...by('mi-road', 0), ry: 0 })
    fifth.send({ t: 'sit', bench: 'mi-road:0' })
    expect(await fifth.next('error')).toEqual({ t: 'error', code: 'full' })
    expect(fifth.all('seated')).toEqual([])
    // A seat that frees up is taken again, lowest first.
    four[1]!.send({ t: 'sit', bench: null })
    expect(await four[1]!.next('seated', (m) => m.bench === null)).toEqual({
      t: 'seated',
      bench: null,
      seat: null,
      with: [],
    })
    fifth.send({ t: 'sit', bench: 'mi-road:0' })
    expect(await fifth.next('seated')).toMatchObject({ bench: 'mi-road:0', seat: 1 })
    // Asking again for the seat you have is answered to you alone.
    await four[0]!.next('seated', (m) => m.with.length === 3)
    const others = four[0]!.mark()
    fifth.send({ t: 'sit', bench: 'mi-road:0' })
    await vi.waitFor(() => expect(fifth.all('seated')).toHaveLength(2), WAIT)
    await four[0]!.sync()
    expect(four[0]!.all('seated', others)).toEqual([])
  })

  it('sitting needs the bench to be real and within 3 m', async () => {
    const a = await live('malviya-nagar', { token: await resident('Far Farhan') })
    a.send({ t: 'sit', bench: 'malviya-nagar:1' }) // has not said where it stands
    a.send({ t: 'move', ...by('malviya-nagar', 1, 4), ry: 0 })
    a.send({ t: 'sit', bench: 'malviya-nagar:1' })
    a.send({ t: 'sit', bench: 'malviya-nagar:5' })
    a.send({ t: 'sit', bench: 'walled-city:1' })
    a.send({ t: 'sit', bench: 'malviya-nagar:01' })
    await a.sync()
    expect(a.all('error').map((e) => e.code)).toEqual(['far', 'far', 'invalid', 'invalid', 'invalid'])
  })

  it('sitting at another bench leaves the first, and walking off unseats', async () => {
    const a = await sitter('Hop Hema', 'walled-city', 7)
    const b = await sitter('Hop Bobby', 'walled-city', 7)
    // Bench 8 is 19 m west: walked there in hops the speed check allows, a second apart.
    const start = Date.now() + 1000
    try {
      for (const [i, x] of [6, 1, -4, -8].entries()) {
        await runInDurableObject(stub('walled-city'), (instance) => {
          instance.clock = () => start + i * 1000
        })
        a.send({ t: 'move', x, z: -14, ry: 0 })
        await a.sync()
      }
      // On the way, past 3 m from bench 7, A was stood up and B told so.
      expect(await a.next('seated', (m) => m.bench === null)).toMatchObject({ bench: null })
      expect(await b.next('seated', (m) => m.with.length === 0)).toMatchObject({ bench: 'walled-city:7' })
      const from = b.mark()
      a.send({ t: 'sit', bench: 'walled-city:8' })
      expect(await a.next('seated', (m) => m.bench === 'walled-city:8')).toMatchObject({ seat: 0, with: [] })
      await b.sync()
      expect(b.all('seated', from)).toEqual([])
    } finally {
      await runInDurableObject(stub('walled-city'), (instance) => {
        instance.clock = Date.now
      })
    }
  })

  it('a sitter is stood up past 2.5 m from the bench, as the client does', async () => {
    const a = await sitter('Edge Ekta', 'malviya-nagar', 4)
    const from = a.mark()
    a.send({ t: 'move', ...by('malviya-nagar', 4, 2.4), ry: 0 })
    await a.sync()
    expect(a.all('seated', from)).toEqual([])
    a.send({ t: 'move', ...by('malviya-nagar', 4, 2.6), ry: 0 })
    expect(await a.next('seated', undefined, from)).toEqual({
      t: 'seated',
      bench: null,
      seat: null,
      with: [],
    })
  })

  it('switching benches in place tells both benches', async () => {
    // Benches 2 and 8 in MI Road stand 3.5 m apart: one spot is in reach of both.
    const a = await live('mi-road', { token: await resident('Swap Sima') })
    const b = await sitter('Swap Bunty', 'mi-road', 2)
    const c = await sitter('Swap Chotu', 'mi-road', 8)
    a.send({ t: 'move', x: -58.2, z: 43.3, ry: 0 })
    a.send({ t: 'sit', bench: 'mi-road:2' })
    await b.next('seated', (m) => m.with.length === 1)
    a.send({ t: 'sit', bench: 'mi-road:8' })
    expect(await a.next('seated', (m) => m.bench === 'mi-road:8')).toMatchObject({ with: ['Swap'] })
    await b.next('seated', (m) => m.with.length === 0)
    await c.next('seated', (m) => m.with.length === 1)
  })

  it('say is limited to a line a second', async () => {
    const a = await sitter('Fast Fatima', 'university', 1)
    a.send({ t: 'say', text: 'ek' })
    a.send({ t: 'say', text: 'do' })
    await a.sync()
    expect(a.all('bench').map((m) => m.text)).toEqual(['ek'])
    expect(a.all('error')).toEqual([{ t: 'error', code: 'rate' }])
  })

  it('transcript keeps only the last 10 minutes', async () => {
    const district = stub('university')
    const a = await sitter('Note Nandini', 'university', 2)
    const b = await sitter('Note Bhanu', 'university', 2)
    await a.sync()
    await b.sync()
    const start = Date.now() + 60_000
    const at = async (ms: number) =>
      runInDurableObject(district, (instance) => {
        instance.clock = () => start + ms
      })
    try {
      await at(0)
      a.send({ t: 'say', text: 'pehli' })
      await a.next('bench', (m) => m.text === 'pehli')
      await at(6 * 60_000)
      b.send({ t: 'say', text: 'doosri' })
      await a.next('bench', (m) => m.text === 'doosri')
      await at(11 * 60_000)
      a.send({ t: 'say', text: 'teesri' })
      await a.next('bench', (m) => m.text === 'teesri')
      const kept = await runInDurableObject(district, (instance) => instance.benchTranscript('university:2'))
      expect(kept).toEqual([
        { from: 'dev:note-bhanu', name: 'Note', text: 'doosri', at: start + 6 * 60_000 },
        { from: 'dev:note-nandini', name: 'Note', text: 'teesri', at: start + 11 * 60_000 },
      ])
      await at(22 * 60_000)
      expect(await runInDurableObject(district, (i) => i.benchTranscript('university:2'))).toHaveLength(0)
      expect(await runInDurableObject(district, (i) => i.benchTranscript('university:3'))).toEqual([])

      // Never more than 200 lines, however busy the bench.
      const lines = await runInDurableObject(district, async (instance, state) => {
        const [ws] = state
          .getWebSockets()
          .filter(
            (s) => (s.deserializeAttachment() as { userId?: string } | null)?.userId === 'dev:note-nandini',
          )
        for (let i = 0; i < 205; i++) {
          const now = start + 30 * 60_000 + i * 1000
          instance.clock = () => now
          await instance.webSocketMessage(ws!, JSON.stringify({ t: 'say', text: `line ${i}` }))
        }
        return instance.benchTranscript('university:2')
      })
      expect(lines).toHaveLength(200)
      expect(lines[0]!.text).toBe('line 5')
      expect(lines.at(-1)!.text).toBe('line 204')
    } finally {
      await runInDurableObject(district, (instance) => {
        instance.clock = Date.now
      })
    }
  })

  it('closing the socket unseats', async () => {
    const a = await sitter('Bye Bina', 'walled-city', 3)
    const b = await sitter('Bye Bhola', 'walled-city', 3)
    const from = b.mark()
    a.close()
    expect(await b.next('seated', undefined, from)).toEqual({
      t: 'seated',
      bench: 'walled-city:3',
      seat: 1,
      with: [],
    })
    // A socket that takes over for the same person stands them up too.
    const token = await resident('Bye Bhola')
    const again = await live('walled-city', { token })
    await again.next('welcome')
    const c = await sitter('Bye Chetna', 'walled-city', 3)
    expect(c.all('seated').at(-1)).toMatchObject({ seat: 0, with: [] })
  })

  it('bench seats survive the object hibernating', async () => {
    const a = await sitter('Deep Dimple', 'malviya-nagar', 3)
    await evictDurableObject(stub('malviya-nagar'))
    const b = await sitter('Deep Bablu', 'malviya-nagar', 3)
    expect(b.all('seated').at(-1)).toMatchObject({ seat: 1, with: ['Deep'] })
    b.send({ t: 'say', text: 'jaag gaye?' })
    expect(await a.next('bench')).toMatchObject({ text: 'jaag gaye?', name: 'Deep' })
  })
})
