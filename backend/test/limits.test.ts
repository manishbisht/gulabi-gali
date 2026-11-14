import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { postMessage } from '../src/chat'
import type { Env } from '../src/env'
import worker from '../src/index'
import { ACCOUNT_LIMIT, clientKey, windowStart } from '../src/limits'
import { api, devId, login, resident } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

/*
 * The edge assumption these tests model: in production Cloudflare sets `CF-Connecting-IP` on every request,
 * replacing whatever the client sent, and nothing reaches the Worker except through the edge. So a test
 * "client" can only choose headers other than that one; where a test sets `CF-Connecting-IP` it is playing
 * the edge. A request with no such header never came through the edge (`wrangler dev`, tests, CI).
 */
const EDGE_IP = '203.0.113.9'

/** A stand-in for a Workers Rate Limiting binding: `limit` calls per key, and a log of the keys it saw. */
function fakeLimiter(limit: number) {
  const seen: string[] = []
  const counts = new Map<string, number>()
  const binding = {
    async limit({ key }: { key: string }) {
      seen.push(key)
      const n = (counts.get(key) ?? 0) + 1
      counts.set(key, n)
      return { success: n <= limit }
    },
  } as RateLimit
  return { binding, seen }
}
const NO_LIMIT = Number.MAX_SAFE_INTEGER

/**
 * The test env with some bindings replaced. Defined as own properties (not assigned): assigning through a
 * derived object would reach the shared env's setter and change it for every later test.
 */
const withEnv = (over: Record<string, unknown>) =>
  Object.create(
    testEnv,
    Object.fromEntries(Object.entries(over).map(([k, value]) => [k, { value, enumerable: true }])),
  ) as Env

/** The Worker with its limiters replaced, called directly (as its other tests do) so the bindings can differ. */
function call(
  path: string,
  init: RequestInit & { ip?: string | null } = {},
  limiters: Partial<Pick<Env, 'SOCKETS_LIMITER' | 'SIGNIN_LIMITER' | 'WRITES_LIMITER'>> = {},
) {
  const { ip = EDGE_IP, headers, ...rest } = init
  const h = new Headers(headers)
  if (ip) h.set('CF-Connecting-IP', ip)
  // Limiters a test does not name never refuse (the real bindings would count every test together).
  const open = () => fakeLimiter(NO_LIMIT).binding
  const withLimiters = withEnv({
    ...{ SOCKETS_LIMITER: open(), SIGNIN_LIMITER: open(), WRITES_LIMITER: open() },
    ...limiters,
  })
  return worker.fetch(new Request(`https://api.test${path}`, { ...rest, headers: h }), withLimiters)
}
const authed = (token: string, extra: HeadersInit = {}) => ({
  headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra },
})

async function ask(from: string, to: string) {
  return api('/api/requests', from, {
    method: 'POST',
    body: JSON.stringify({ to: devId(to), reason: 'Mujhe bhi pencil sketching pasand hai' }),
  })
}

describe('account limits', () => {
  it('new accounts get 5 requests a day, older get 20', async () => {
    const newbie = await resident('Lim Newbie')
    const oldie = await resident('Lim Oldie')
    await testEnv.DB.prepare('UPDATE users SET created_at = ? WHERE id = ?')
      .bind(Date.now() - ACCOUNT_LIMIT.newAccountAge - 1000, devId('Lim Oldie'))
      .run()
    const targets = Array.from({ length: 21 }, (_, i) => `Lim Target ${i}`)
    for (const name of targets) await resident(name)

    for (const name of targets.slice(0, 5)) expect((await ask(newbie, name)).status).toBe(201)
    const sixth = await ask(newbie, targets[5]!)
    expect(sixth.status).toBe(429)
    expect(await sixth.json()).toEqual({ error: 'rate' })
    expect(Number(sixth.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)

    for (const name of targets.slice(0, 20)) expect((await ask(oldie, name)).status).toBe(201)
    expect((await ask(oldie, targets[20]!)).status).toBe(429)
  })

  it('a refused request (already asked) does not use up the allowance', async () => {
    const sender = await resident('Lim Careful')
    await resident('Lim Careful Target')
    expect((await ask(sender, 'Lim Careful Target')).status).toBe(201)
    for (let i = 0; i < 8; i++) expect((await ask(sender, 'Lim Careful Target')).status).toBe(409)
    await resident('Lim Careful Two')
    expect((await ask(sender, 'Lim Careful Two')).status).toBe(201)
  })

  it('30 messages a minute, across two matches', async () => {
    const mia = await resident('Lim Mia')
    const ann = await resident('Lim Ann')
    const bea = await resident('Lim Bea')
    const matches: string[] = []
    for (const [other, name] of [
      [ann, 'Lim Ann'],
      [bea, 'Lim Bea'],
    ] as const) {
      const sent = await ask(mia, name)
      const { id } = (await sent.json()) as { id: string }
      const res = await api(`/api/requests/${id}/accept`, other, { method: 'POST' })
      matches.push(((await res.json()) as { matchId: string }).matchId)
    }
    // Alternating matches, one a second: neither match's own 1/s gap is ever the thing that refuses.
    const start = windowStart(Date.now(), 60_000)
    const say = (i: number) =>
      postMessage(testEnv, devId('Lim Mia'), matches[i % 2]!, { body: `hi ${i}` }, start + i * 1000)
    for (let i = 0; i < 30; i++) expect((await say(i)).status).toBe(201)
    const over = await say(30)
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'rate' })
    expect(over.headers.get('Retry-After')).not.toBeNull()
  })
})

describe('per-address limits', () => {
  it('per-IP sign-in limit: dev login and the first /api/me', async () => {
    const signin = fakeLimiter(2)
    const login = () =>
      call(
        '/api/dev/login',
        { method: 'POST', body: JSON.stringify({ name: 'Lim Signin' }) },
        { SIGNIN_LIMITER: signin.binding, WRITES_LIMITER: fakeLimiter(NO_LIMIT).binding },
      )
    expect((await login()).status).toBe(200)
    expect((await login()).status).toBe(200)
    const third = await login()
    expect(third.status).toBe(429)
    expect(await third.json()).toEqual({ error: 'rate', scope: 'ip' })
    expect(third.headers.get('Retry-After')).toBe('60')

    // A fresh account's first /api/me counts, and is refused without making the account.
    const blocked = { SIGNIN_LIMITER: fakeLimiter(0).binding }
    const fresh = await login0('Lim Fresh')
    const me = await call('/api/me', authed(fresh), blocked)
    expect(me.status).toBe(429)
    expect(
      await testEnv.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(devId('Lim Fresh')).first(),
    ).toBeNull()
    // Someone already signed up is not a sign-in at all.
    const known = await resident('Lim Known')
    expect((await call('/api/me', authed(known), blocked)).status).toBe(200)
  })

  it('per-IP socket limit, on the live and inbox upgrades', async () => {
    const sockets = fakeLimiter(0)
    const limiters = { SOCKETS_LIMITER: sockets.binding }
    const live = await call(
      '/api/districts/pink-square/live',
      { headers: { Upgrade: 'websocket' } },
      limiters,
    )
    expect(live.status).toBe(429)
    expect(live.headers.get('Retry-After')).toBe('60')
    const inbox = await call('/api/inbox', { headers: { Upgrade: 'websocket' } }, limiters)
    expect(inbox.status).toBe(429)
    expect(sockets.seen).toEqual([EDGE_IP, EDGE_IP])
  })

  it('per-IP write limit: POST, PUT and DELETE count, GET does not', async () => {
    const token = await login0('Lim Writer')
    const writes = fakeLimiter(2)
    const limiters = { WRITES_LIMITER: writes.binding }
    const post = () => call('/api/blocks', { method: 'POST', body: '{}', ...authed(token) }, limiters)
    expect((await post()).status).not.toBe(429)
    expect((await call('/api/blocks/x', { method: 'DELETE', ...authed(token) }, limiters)).status).not.toBe(
      429,
    )
    const third = await call('/api/me/profile', { method: 'PUT', body: '{}', ...authed(token) }, limiters)
    expect(third.status).toBe(429)
    expect(third.headers.get('Retry-After')).toBe('60')
    for (let i = 0; i < 5; i++) {
      expect((await call('/api/blocks', authed(token), limiters)).status).toBe(200)
    }
    expect(writes.seen).toHaveLength(3)
  })

  it('10 invite redemptions an hour per IP, across accounts, on top of the per-person limit', async () => {
    const x = await resident('Lim Redeem X')
    const y = await resident('Lim Redeem Y')
    const redeem = (token: string, ip: string) =>
      call('/api/invites/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: 'NOPE' }),
        ip,
        ...authed(token),
      })
    // Five each (the per-person limit is 10): the address is what runs out.
    for (let i = 0; i < 5; i++) {
      expect((await redeem(x, '198.51.100.7')).status).toBe(404)
      expect((await redeem(y, '198.51.100.7')).status).toBe(404)
    }
    const over = await redeem(x, '198.51.100.7')
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'rate' })
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    // Another address is not held to it; neither is loopback.
    expect((await redeem(x, '198.51.100.8')).status).toBe(404)
    expect(
      (await call('/api/invites/redeem', { method: 'POST', body: '{"code":"NOPE"}', ip: null, ...authed(y) }))
        .status,
    ).toBe(404)
  })
})

describe('no usable address', () => {
  const bare = new Request('https://api.test/')
  const loop = new Request('https://api.test/', { headers: { 'CF-Connecting-IP': '127.0.0.1' } })

  it('is counted under one shared key when DEV_AUTH is not on', () => {
    for (const dev of [undefined, '0', '']) {
      expect(clientKey(bare, { DEV_AUTH: dev })).toBe('noip')
      expect(clientKey(loop, { DEV_AUTH: dev })).toBe('noip')
    }
  })

  it('is exempt when DEV_AUTH=1', () => {
    expect(clientKey(bare, { DEV_AUTH: '1' })).toBeNull()
    expect(clientKey(loop, { DEV_AUTH: '1' })).toBeNull()
  })

  it('reaches the limiter end to end when DEV_AUTH is off', async () => {
    const writes = fakeLimiter(1)
    const prod = withEnv({
      DEV_AUTH: undefined,
      WRITES_LIMITER: writes.binding,
    })
    const post = () =>
      worker.fetch(new Request('https://api.test/api/blocks', { method: 'POST', body: '{}' }), prod)
    expect((await post()).status).toBe(401)
    const over = await post()
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'rate', scope: 'ip' })
    expect(writes.seen).toEqual(['noip', 'noip'])
  })
})

describe('loopback and spoofing', () => {
  it('loopback exempt in dev: no address, 127.x, ::1 and mapped loopback never reach a limiter', async () => {
    const all = {
      SIGNIN_LIMITER: fakeLimiter(0),
      WRITES_LIMITER: fakeLimiter(0),
      SOCKETS_LIMITER: fakeLimiter(0),
    }
    const bindings = {
      SIGNIN_LIMITER: all.SIGNIN_LIMITER.binding,
      WRITES_LIMITER: all.WRITES_LIMITER.binding,
      SOCKETS_LIMITER: all.SOCKETS_LIMITER.binding,
    }
    for (const ip of [null, '127.0.0.1', '127.9.9.9', '::1', '::ffff:127.0.0.1']) {
      const res = await call(
        '/api/dev/login',
        { method: 'POST', body: JSON.stringify({ name: 'Lim Loop' }), ip },
        bindings,
      )
      expect(res.status, String(ip)).toBe(200)
      const ws = await call('/api/inbox', { headers: { Upgrade: 'websocket' }, ip }, bindings)
      expect(ws.status, String(ip)).not.toBe(429)
    }
    expect(all.SIGNIN_LIMITER.seen).toEqual([])
    expect(all.WRITES_LIMITER.seen).toEqual([])
    expect(all.SOCKETS_LIMITER.seen).toEqual([])
  })

  it('a client-supplied forwarding header cannot buy an exemption or a fresh count', async () => {
    const writes = fakeLimiter(1)
    const limiters = { WRITES_LIMITER: writes.binding }
    const spoof = {
      'X-Forwarded-For': '127.0.0.1',
      'X-Real-IP': '::1',
      'True-Client-IP': '127.0.0.1',
      Forwarded: 'for=127.0.0.1',
    }
    const post = (headers: Record<string, string>) =>
      call('/api/blocks', { method: 'POST', body: '{}', headers, ip: EDGE_IP }, limiters)
    expect((await post(spoof)).status).not.toBe(429)
    // The same edge address with a different claimed one is still the same caller.
    expect((await post({ 'X-Forwarded-For': '192.0.2.55' })).status).toBe(429)
    expect(writes.seen).toEqual([EDGE_IP, EDGE_IP])
  })

  it('keys by the connecting address only, one key per IPv6 /64', () => {
    const key = (headers: Record<string, string>) =>
      clientKey(new Request('https://api.test/', { headers }), { DEV_AUTH: '1' })
    expect(key({ 'X-Forwarded-For': '203.0.113.1' })).toBeNull()
    expect(key({ 'CF-Connecting-IP': '203.0.113.1', 'X-Forwarded-For': '127.0.0.1' })).toBe('203.0.113.1')
    expect(key({ 'CF-Connecting-IP': '2001:db8:1:2:aaaa::1' })).toBe(
      key({ 'CF-Connecting-IP': '2001:db8:1:2::9' }),
    )
    expect(key({ 'CF-Connecting-IP': '2001:db8:1:2::9' })).not.toBe(
      key({ 'CF-Connecting-IP': '2001:db8:1:3::9' }),
    )
    expect(key({ 'CF-Connecting-IP': '::ffff:203.0.113.1' })).toBe('203.0.113.1')
  })
})

/** A dev token for a name, without making the account. */
const login0 = (name: string) => login(name)
