import { applyD1Migrations, env, evictDurableObject, runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/env'
import { LIVE_CLOSE, type DistrictId, type ServerMsg } from '../src/protocol'
import { closeAll, live, login, openLive, resident, WAIT } from './helpers'

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
    // Benches arrive later; for now a resident is told they are not a thing yet.
    const r = await live('university', { token: await resident('Bench Early') })
    r.send({ t: 'sit', bench: 'university:0' })
    r.send({ t: 'say', text: 'hi' })
    await r.sync()
    expect(r.all('error').map((e) => e.code)).toEqual(['invalid', 'invalid'])
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
    await vi.waitFor(() => expect(a.closes).toEqual([LIVE_CLOSE.invalid]), WAIT)
    // One `rate` for the whole stretch, not one per frame.
    expect(a.all('error')).toEqual([{ t: 'error', code: 'rate' }])
  })

  it('a replaced socket stays gone after the object wakes', async () => {
    const district = stub('walled-city')
    const token = await resident('Waking Wasim')
    const watcher = await live('walled-city')
    const first = await live('walled-city', { token })
    first.send({ t: 'move', x: 4, z: 4, ry: 0 })
    await watcher.next('join', (m) => m.p.id === 'dev:waking-wasim')
    const from = watcher.mark()
    const who = {
      userId: 'dev:waking-wasim',
      person: {
        id: 'dev:waking-wasim',
        name: 'Waking',
        look: { skin: 1, outfit: 'pink', head: 'none' },
        status: '',
      },
    }
    // All in one turn, while the replaced socket is still closing: a second socket takes over, the object
    // forgets everything it held in memory (as a wake from hibernation does), and both sockets send a move.
    const heard = await runInDurableObject(district, async (instance, state) => {
      const res = await instance.fetch(
        new Request('https://district.internal/walled-city', {
          headers: { Upgrade: 'websocket', 'X-GG-Who': JSON.stringify(who) },
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
          headers: { Upgrade: 'websocket', 'X-GG-Who': JSON.stringify({ userId: null, person: null }) },
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
