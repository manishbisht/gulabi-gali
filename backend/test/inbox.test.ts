import { applyD1Migrations, env, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/env'
import { INBOX_SOCKETS, notify } from '../src/inbox'
import { LIVE_CLOSE } from '../src/protocol'
import { sendRequest } from '../src/requests'
import { closeAll, inbox, login, openInbox, resident, WAIT, type InboxClient } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

afterEach(() => closeAll())

const REASON = 'Mujhe bhi pencil sketching pasand hai'
const id = (name: string) => `dev:${name.toLowerCase()}`
const api = (path: string, token: string, init: RequestInit = {}) =>
  SELF.fetch(`https://api.test${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
const ask = (token: string, to: string) =>
  api('/api/requests', token, { method: 'POST', body: JSON.stringify({ to, reason: REASON }) })

describe('the inbox route', () => {
  it('a plain request (no upgrade) is refused', async () => {
    const token = await resident('inbplain')
    const res = await SELF.fetch(`https://api.test/api/inbox?token=${token}`)
    expect(res.status).toBe(426)
  })

  it('needs a resident: no token, a bad token, an incomplete or a banned user is 403', async () => {
    expect((await openInbox()).status).toBe(403)
    expect((await openInbox({ token: 'dev.nobody.forged' })).status).toBe(403)
    expect((await openInbox({ token: await login('inbghost') })).status).toBe(403)
    expect((await openInbox({ token: await resident('inbhalf', { pledge: false }) })).status).toBe(403)
    const banned = await resident('inbbanned')
    await testEnv.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(id('inbbanned')).run()
    const res = await openInbox({ token: banned })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'ghost' })
  })

  it('refuses an upgrade from a foreign page, allows ours', async () => {
    const token = await resident('inborigin')
    expect((await openInbox({ token, headers: { Origin: 'https://evil.example' } })).status).toBe(403)
    const ours = await openInbox({ token, headers: { Origin: 'https://gulabi-gali.manishbisht.me' } })
    expect(ours.status).toBe(101)
    ours.webSocket!.accept()
    ours.webSocket!.close(1000)
  })

  it('a forged X-GG-Who does not open someone else’s inbox', async () => {
    const res = await openInbox({ headers: { 'X-GG-Who': JSON.stringify({ userId: id('inbvictim') }) } })
    expect(res.status).toBe(403)
  })

  it('answers a ping', async () => {
    const box = await inbox(await resident('inbping'))
    box.ws.send('{"t":"ping"}')
    await box.next('pong')
    box.ws.send('{ "t": "ping" }')
    await vi.waitFor(() => expect(box.messages.filter((m) => m.t === 'pong')).toHaveLength(2), WAIT)
  })

  it('closes a socket that keeps sending garbage', async () => {
    const box = await inbox(await resident('inbgarbage'))
    for (let i = 0; i < 5; i++) box.ws.send('nonsense')
    await vi.waitFor(() => expect(box.closes).toEqual([LIVE_CLOSE.invalid]), WAIT)
  })

  it(`keeps at most ${INBOX_SOCKETS} sockets per person: the oldest goes with 4001`, async () => {
    const token = await resident('inbtabs')
    const tabs: InboxClient[] = []
    for (let i = 0; i < INBOX_SOCKETS; i++) tabs.push(await inbox(token))
    const newest = await inbox(token)
    await vi.waitFor(() => expect(tabs[0].closes).toEqual([LIVE_CLOSE.replaced]), WAIT)
    // Everyone else still hears notices.
    await notify(testEnv, id('inbtabs'), { t: 'request', id: 'r-1' })
    for (const box of [...tabs.slice(1), newest]) await box.next('request', (m) => m.id === 'r-1')
    expect(tabs[0].messages).toEqual([])
  })
})

describe('notices', () => {
  it('a new request notifies the recipient', async () => {
    const a = await resident('inbreqa')
    const b = await resident('inbreqb')
    const box = await inbox(b)
    const res = await ask(a, id('inbreqb'))
    expect(res.status).toBe(201)
    const { id: rid } = (await res.json()) as { id: string }
    expect(await box.next('request')).toEqual({ t: 'request', id: rid })
  })

  it('accept notifies the sender', async () => {
    const a = await resident('inbacca', { name: 'Asha Meena' })
    const b = await resident('inbaccb', { name: 'Bela Rathore' })
    const box = await inbox(a)
    const { id: rid } = (await (await ask(a, id('inbaccb'))).json()) as { id: string }
    const res = await api(`/api/requests/${rid}/accept`, b, { method: 'POST' })
    expect(res.status).toBe(200)
    const { matchId } = (await res.json()) as { matchId: string }
    const notice = await box.next('accepted')
    expect(notice).toEqual({
      t: 'accepted',
      matchId,
      person: {
        id: id('inbaccb'),
        name: 'Bela',
        look: { skin: 1, outfit: 'pink', head: 'none' },
        status: 'chai pe',
      },
    })
    // The sender asked, so they hear no `request` of their own.
    expect(box.messages.filter((m) => m.t === 'request')).toEqual([])
  })

  it('crossed requests notify both sides of the match', async () => {
    const a = await resident('inbcrossa')
    const b = await resident('inbcrossb')
    const [boxA, boxB] = [await inbox(a), await inbox(b)]
    expect((await ask(b, id('inbcrossa'))).status).toBe(201)
    const res = await ask(a, id('inbcrossb'))
    expect(res.status).toBe(200)
    const { matched } = (await res.json()) as { matched: string }
    expect((await boxA.next('accepted')).person.id).toBe(id('inbcrossb'))
    expect((await boxB.next('accepted')).person.id).toBe(id('inbcrossa'))
    expect((await boxA.next('accepted')).matchId).toBe(matched)
    expect((await boxB.next('accepted')).matchId).toBe(matched)
  })

  it('a failing inbox never fails the request', async () => {
    await resident('inbfaila')
    await resident('inbfailb')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = {
      ...testEnv,
      INBOX: {
        idFromName: () => {
          throw new Error('inbox down')
        },
      },
    } as unknown as Env
    let work: Promise<unknown> | null = null
    const res = await sendRequest(
      broken,
      id('inbfaila'),
      { to: id('inbfailb'), reason: REASON },
      Date.now(),
      (p) => {
        work = p
      },
    )
    expect(res.status).toBe(201)
    expect(work).not.toBeNull()
    await expect(work).resolves.toBeUndefined()
    expect(logged).toHaveBeenCalledWith('inbox: notify failed', expect.any(Error))
    logged.mockRestore()
  })
})
