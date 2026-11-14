import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import worker from '../src/index'
import type { RequestLists } from '../src/protocol'
import { acceptRequest, expireRequests, listRequests } from '../src/requests'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

const DAY = 24 * 3600 * 1000
const REASON = 'Mujhe bhi pencil sketching pasand hai'

const call = (path: string, init: RequestInit = {}, token?: string) =>
  worker.fetch(
    new Request(`https://x.test${path}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    }),
    testEnv,
  )

async function login(name: string): Promise<string> {
  const res = await call('/api/dev/login', { method: 'POST', body: JSON.stringify({ name }) })
  return ((await res.json()) as { token: string }).token
}

async function resident(name: string, over: Record<string, unknown> = {}): Promise<string> {
  const token = await login(name)
  const res = await call(
    '/api/me/profile',
    {
      method: 'PUT',
      body: JSON.stringify({
        name,
        look: { skin: 1, outfit: 'pink', head: 'none' },
        status: 'chai pe',
        homeArea: 'Raja Park',
        hereFor: 'friends',
        about: 'Private about.',
        adult: true,
        pledge: true,
        ...over,
      }),
    },
    token,
  )
  expect(res.status).toBe(200)
  await testEnv.DB.prepare('UPDATE users SET verified = 1 WHERE id = ?')
    .bind(`dev:${name.toLowerCase()}`)
    .run()
  return token
}

const id = (name: string) => `dev:${name.toLowerCase()}`
const send = (token: string, to: string, reason: unknown = REASON) =>
  call('/api/requests', { method: 'POST', body: JSON.stringify({ to, reason }) }, token)
const lists = async (token: string) => (await (await call('/api/requests', {}, token)).json()) as RequestLists
const count = async (sql: string, ...args: unknown[]) =>
  (await testEnv.DB.prepare(sql)
    .bind(...args)
    .first<{ n: number }>())!.n

describe('requests API', () => {
  it('a resident can request another resident', async () => {
    const a = await resident('reqa1')
    const b = await resident('reqb1', { name: 'Bela Rathore' })
    const res = await send(a, id('reqb1'), `  ${REASON}\n‮ `)
    expect(res.status).toBe(201)
    const { id: rid } = (await res.json()) as { id: string }
    expect(rid).toMatch(/^[0-9a-f-]{36}$/)

    const inbox = await lists(b)
    expect(inbox.incoming).toHaveLength(1)
    expect(inbox.incoming[0]).toMatchObject({ id: rid, reason: REASON, state: 'pending' })
    // the other side is a first-name PublicPerson: never the private profile
    expect(inbox.incoming[0].person).toEqual({
      id: id('reqa1'),
      name: 'reqa1',
      look: { skin: 1, outfit: 'pink', head: 'none' },
      status: 'chai pe',
    })
    expect(JSON.stringify(inbox)).not.toContain('Private about')
    const out = await lists(a)
    expect(out.sent).toHaveLength(1)
    expect(out.sent[0].person.name).toBe('Bela')
    expect(out.incoming).toEqual([])
  })

  it('rejects a bad reason', async () => {
    const a = await resident('reqa2')
    await resident('reqb2')
    for (const reason of ['short', 'x'.repeat(141), 42, null, '​​​​​​​​​​​​'])
      expect((await send(a, id('reqb2'), reason)).status).toBe(400)
    expect((await send(a, id('reqb2'), '😀'.repeat(140))).status).toBe(201)
  })

  it('cleans the reason to one line', async () => {
    const a = await resident('reqa14')
    const b = await resident('reqb14')
    expect((await send(a, id('reqb14'), 'Chai pe\n\u202e  baat karein?\t Zaroor')).status).toBe(201)
    expect((await lists(b)).incoming[0].reason).toBe('Chai pe baat karein? Zaroor')
  })

  it('cannot request self', async () => {
    const a = await resident('reqa3')
    expect((await send(a, id('reqa3'))).status).toBe(400)
  })

  it('duplicate is 409 already', async () => {
    const a = await resident('reqa4')
    await resident('reqb4')
    expect((await send(a, id('reqb4'))).status).toBe(201)
    const again = await send(a, id('reqb4'))
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'already' })
  })

  it('paused recipient is 409 paused', async () => {
    const a = await resident('reqa5')
    await resident('reqb5', { pauseRequests: true })
    const res = await send(a, id('reqb5'))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'paused' })
  })

  it('crossed requests become one match', async () => {
    const a = await resident('reqa6')
    const b = await resident('reqb6')
    expect((await send(b, id('reqa6'))).status).toBe(201)
    const res = await send(a, id('reqb6'))
    expect(res.status).toBe(200)
    const { matched } = (await res.json()) as { matched: string }
    expect(matched).toBeTruthy()
    expect(
      await count('SELECT COUNT(*) n FROM matches WHERE a = ? AND b = ?', id('reqa6'), id('reqb6')),
    ).toBe(1)
    expect(
      await count(
        "SELECT COUNT(*) n FROM requests WHERE state = 'pending' AND from_id IN (?, ?)",
        id('reqa6'),
        id('reqb6'),
      ),
    ).toBe(0)
    expect((await lists(b)).sent[0].state).toBe('accepted')
    // matched already, either way round
    expect((await send(a, id('reqb6'))).status).toBe(409)
    expect((await send(b, id('reqa6'))).status).toBe(409)
  })

  it('accept makes a match, only for the recipient', async () => {
    const a = await resident('reqa7')
    const b = await resident('reqb7')
    const { id: rid } = (await (await send(a, id('reqb7'))).json()) as { id: string }
    expect((await call(`/api/requests/${rid}/accept`, { method: 'POST' }, a)).status).toBe(404)
    const res = await call(`/api/requests/${rid}/accept`, { method: 'POST' }, b)
    expect(res.status).toBe(200)
    const { matchId } = (await res.json()) as { matchId: string }
    expect(matchId).toBeTruthy()
    expect(await count('SELECT COUNT(*) n FROM matches WHERE id = ?', matchId)).toBe(1)
    expect((await lists(b)).incoming).toEqual([])
    expect((await lists(a)).sent[0].state).toBe('accepted')
    // a second accept is not a second match
    expect((await call(`/api/requests/${rid}/accept`, { method: 'POST' }, b)).status).toBe(404)
  })

  it('accept after 14 days is 410', async () => {
    const a = await resident('reqa8')
    await resident('reqb8')
    const { id: rid } = (await (await send(a, id('reqb8'))).json()) as { id: string }
    const late = Date.now() + 14 * DAY + 1000
    const res = await acceptRequest(testEnv, id('reqb8'), rid, late)
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual({ error: 'expired' })
    expect(await count('SELECT COUNT(*) n FROM matches WHERE a = ?', id('reqa8'))).toBe(0)
    expect((await listRequests(testEnv, id('reqb8'), late)).incoming).toEqual([])
  })

  it('an expired request is hidden from both lists and can be asked again', async () => {
    const a = await resident('reqa9')
    await resident('reqb9')
    await send(a, id('reqb9'))
    await testEnv.DB.prepare('UPDATE requests SET created_at = ? WHERE from_id = ?')
      .bind(Date.now() - 15 * DAY, id('reqa9'))
      .run()
    expect((await lists(a)).sent).toEqual([])
    expect((await send(a, id('reqb9'))).status).toBe(201)
    expect((await lists(a)).sent).toHaveLength(1)
  })

  it('sender never sees ignored', async () => {
    const a = await resident('reqa10')
    const b = await resident('reqb10')
    const { id: rid } = (await (await send(a, id('reqb10'))).json()) as { id: string }
    expect((await call(`/api/requests/${rid}/ignore`, { method: 'POST' }, a)).status).toBe(404)
    expect((await call(`/api/requests/${rid}/ignore`, { method: 'POST' }, b)).status).toBe(204)
    expect((await lists(b)).incoming).toEqual([])
    const sent = (await lists(a)).sent
    expect(sent).toHaveLength(1)
    expect(sent[0].state).toBe('pending')
    // asking again is "already", the same as for a pending one: nothing reveals the decline
    expect((await send(a, id('reqb10'))).status).toBe(409)
  })

  it('ghost is 403', async () => {
    await resident('reqb11')
    const nobody = await send('', id('reqb11'))
    expect(nobody.status).toBe(401)
    const fresh = await login('reqghost')
    const res = await send(fresh, id('reqb11'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'ghost' })
    const half = await resident('reqhalf', { pledge: false })
    expect((await send(half, id('reqb11'))).status).toBe(403)
    const banned = await resident('reqbanned')
    await testEnv.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(id('reqbanned')).run()
    expect((await send(banned, id('reqb11'))).status).toBe(403)
  })

  it('an unknown, incomplete or banned recipient is 404', async () => {
    const a = await resident('reqa12')
    await resident('reqhalf2', { pledge: false })
    await resident('reqbanned2')
    await testEnv.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(id('reqbanned2')).run()
    for (const to of ['dev:nobody-here', id('reqhalf2'), id('reqbanned2'), 7]) {
      const res = await send(a, to as string)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'no-such-person' })
    }
  })

  it('cron deletes old requests', async () => {
    const a = await resident('reqa13')
    await resident('reqb13')
    await resident('reqc13')
    await send(a, id('reqb13'))
    await send(a, id('reqc13'))
    await testEnv.DB.prepare('UPDATE requests SET created_at = ? WHERE to_id = ?')
      .bind(Date.now() - 15 * DAY, id('reqb13'))
      .run()
    await expireRequests(testEnv, Date.now())
    expect(await count('SELECT COUNT(*) n FROM requests WHERE from_id = ?', id('reqa13'))).toBe(1)
  })

  /** An env whose first batch is preceded by `before`: the cron (or anything) getting in between a read and a write. */
  const racing = (before: string) => {
    let armed = true
    const DB = new Proxy(testEnv.DB, {
      get(target, prop) {
        if (prop === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            if (armed) {
              armed = false
              await target.exec(before)
            }
            return target.batch(statements)
          }
        const v = Reflect.get(target, prop) as unknown
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
      },
    })
    return { ...testEnv, DB } as Env
  }

  it('accepting a request the cron just swept is 410, never a crash', async () => {
    const a = await resident('reqa15')
    await resident('reqb15')
    const { id: rid } = (await (await send(a, id('reqb15'))).json()) as { id: string }
    const res = await acceptRequest(racing(`DELETE FROM requests WHERE id = '${rid}'`), id('reqb15'), rid)
    expect(res.status).toBe(410)
    expect(
      await count('SELECT COUNT(*) n FROM matches WHERE a = ? OR b = ?', id('reqa15'), id('reqa15')),
    ).toBe(0)
  })

  it('accepting a request that aged out mid-flight is 410', async () => {
    const a = await resident('reqa16')
    await resident('reqb16')
    const { id: rid } = (await (await send(a, id('reqb16'))).json()) as { id: string }
    const old = Date.now() - 15 * DAY
    const res = await acceptRequest(
      racing(`UPDATE requests SET created_at = ${old} WHERE id = '${rid}'`),
      id('reqb16'),
      rid,
    )
    expect(res.status).toBe(410)
    expect(await count("SELECT COUNT(*) n FROM requests WHERE id = ? AND state = 'pending'", rid)).toBe(1)
  })

  it('a crossed request swept mid-flight falls back to an ordinary request', async () => {
    await resident('reqa17')
    const b = await resident('reqb17')
    const { id: bid } = (await (await send(b, id('reqa17'))).json()) as { id: string }
    const { sendRequest } = await import('../src/requests')
    const res = await sendRequest(racing(`DELETE FROM requests WHERE id = '${bid}'`), id('reqa17'), {
      to: id('reqb17'),
      reason: REASON,
    })
    expect(res.status).toBe(201)
    expect((await lists(b)).incoming).toHaveLength(1)
  })

  it('both asking at the very same moment ends in one match and no pending rows', async () => {
    const a = await resident('reqa18')
    const b = await resident('reqb18')
    for (let round = 0; round < 5; round++) {
      await testEnv.DB.prepare('DELETE FROM matches WHERE a = ?').bind(id('reqa18')).run()
      await testEnv.DB.prepare('DELETE FROM requests WHERE from_id IN (?, ?)')
        .bind(id('reqa18'), id('reqb18'))
        .run()
      const [r1, r2] = await Promise.all([send(a, id('reqb18')), send(b, id('reqa18'))])
      expect([r1.status, r2.status].every((s) => s === 200 || s === 201 || s === 409)).toBe(true)
      expect(
        await count('SELECT COUNT(*) n FROM matches WHERE a = ? AND b = ?', id('reqa18'), id('reqb18')),
      ).toBe(1)
      expect(
        await count(
          "SELECT COUNT(*) n FROM requests WHERE state = 'pending' AND from_id IN (?, ?)",
          id('reqa18'),
          id('reqb18'),
        ),
      ).toBe(0)
    }
  })
})
