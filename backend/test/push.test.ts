import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/env'
import { PUSH_DEVICES, PUSH_LIMIT, pushTo, putPush } from '../src/push'
import { b64url } from '../src/webpush'
import { api, closeAll, devId, inbox, login, pair, resident, WAIT } from './helpers'
import { decryptPayload, publicOf, userAgent, type UserAgent } from './pushKit'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const db = testEnv.DB
const SERVER = publicOf(testEnv.VAPID_PRIVATE_JWK!)
const REASON = 'Mujhe bhi pencil sketching pasand hai'

beforeAll(async () => {
  await applyD1Migrations(db, testEnv.TEST_MIGRATIONS)
})

/** One push the fake push service took: where it went, its headers, and its encrypted body. */
interface Delivery {
  endpoint: string
  headers: Headers
  body: Uint8Array
}

/**
 * A fake push service standing in for FCM: every POST to fcm.googleapis.com lands in `got` and is answered
 * with `status(endpoint)` (201 unless told otherwise). Any other fetch goes through untouched.
 */
function fakePushService(status: (endpoint: string) => number = () => 201) {
  const got: Delivery[] = []
  const real = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.startsWith('https://fcm.googleapis.com/')) return real(input, init)
    got.push({
      endpoint: url,
      headers: new Headers(init?.headers),
      body: new Uint8Array(await new Response(init?.body).arrayBuffer()),
    })
    return new Response(null, { status: status(url) })
  })
  return { got, spy }
}

afterEach(() => {
  closeAll()
  vi.restoreAllMocks()
})

let n = 0
/** A browser on this test's fake FCM: its subscription body and its keys. */
async function device(lang: 'hi' | 'en' = 'en') {
  const ua = await userAgent()
  const endpoint = `https://fcm.googleapis.com/fcm/send/test-${++n}-${crypto.randomUUID()}`
  return { ua, endpoint, body: { endpoint, keys: ua.keys, lang, server: SERVER } }
}

const subscribe = (token: string, body: unknown) =>
  api('/api/me/push', token, { method: 'PUT', body: JSON.stringify(body) })
const unsubscribe = (token: string, endpoint: string) =>
  api('/api/me/push', token, { method: 'DELETE', body: JSON.stringify({ endpoint }) })
const ask = (token: string, to: string) =>
  api('/api/requests', token, { method: 'POST', body: JSON.stringify({ to, reason: REASON }) })
const rows = async (userId: string) =>
  (
    await db
      .prepare('SELECT endpoint, lang FROM push_subs WHERE user_id = ? ORDER BY created_at')
      .bind(userId)
      .all<{ endpoint: string; lang: string }>()
  ).results

const opened = async (d: Delivery, ua: UserAgent) =>
  JSON.parse(new TextDecoder().decode(await decryptPayload(d.body, ua))) as unknown

describe('subscribing a device', () => {
  it('a resident subscribes and unsubscribes; the row holds the endpoint, keys and language', async () => {
    const t = await resident('Push Asha')
    const d = await device('hi')
    expect((await subscribe(t, d.body)).status).toBe(204)
    expect(await rows(devId('Push Asha'))).toEqual([{ endpoint: d.endpoint, lang: 'hi' }])
    // again, in English: the same row, now in English
    expect((await subscribe(t, { ...d.body, lang: 'en' })).status).toBe(204)
    expect(await rows(devId('Push Asha'))).toEqual([{ endpoint: d.endpoint, lang: 'en' }])
    expect((await unsubscribe(t, d.endpoint)).status).toBe(204)
    expect(await rows(devId('Push Asha'))).toEqual([])
  })

  it('a ghost (no profile) cannot subscribe', async () => {
    const t = await login('Push Ghost')
    const res = await subscribe(t, (await device()).body)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'ghost' })
  })

  it('refuses an endpoint off the push services, and keys that are not keys', async () => {
    const t = await resident('Push Picky')
    const d = await device()
    const bad = [
      { ...d.body, endpoint: 'https://evil.example/push' },
      { ...d.body, endpoint: 'http://fcm.googleapis.com/fcm/send/x' },
      { ...d.body, endpoint: 'https://fcm.googleapis.com.evil.example/x' },
      { ...d.body, endpoint: 'https://user:pw@fcm.googleapis.com/x' },
      { ...d.body, endpoint: 'https://fcm.googleapis.com:8443/x' },
      { ...d.body, endpoint: `https://fcm.googleapis.com/${'x'.repeat(1100)}` },
      { ...d.body, keys: { ...d.ua.keys, p256dh: b64url.encode(new Uint8Array(65)) } },
      { ...d.body, keys: { ...d.ua.keys, auth: b64url.encode(new Uint8Array(8)) } },
      { ...d.body, keys: { ...d.ua.keys, auth: 'not base64!' } },
      { ...d.body, lang: 'fr' },
      { ...d.body, server: undefined },
      null,
    ]
    for (const body of bad) expect((await subscribe(t, body)).status, JSON.stringify(body)).toBe(400)
    expect(await rows(devId('Push Picky'))).toEqual([])
    // The real push services are all taken.
    for (const endpoint of [
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGx',
      'https://wns2-pn1p.notify.windows.com/w/?token=abc',
    ])
      expect((await subscribe(t, { ...d.body, endpoint })).status, endpoint).toBe(204)
  })

  it('a browser subscribed with another server key is told to subscribe again (409 key)', async () => {
    const t = await resident('Push Rekey')
    const d = await device()
    const res = await subscribe(t, {
      ...d.body,
      server: b64url.encode(new Uint8Array([4, ...new Uint8Array(64)])),
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'key' })
  })

  it('the same browser signed in as someone else is theirs now, not the first person’s', async () => {
    const a = await resident('Push First')
    const b = await resident('Push Second')
    const d = await device()
    expect((await subscribe(a, d.body)).status).toBe(204)
    expect((await subscribe(b, d.body)).status).toBe(204)
    expect(await rows(devId('Push First'))).toEqual([])
    expect(await rows(devId('Push Second'))).toHaveLength(1)
    // and the first person cannot take it off the second
    expect((await unsubscribe(a, d.endpoint)).status).toBe(204)
    expect(await rows(devId('Push Second'))).toHaveLength(1)
  })

  it(`keeps at most ${PUSH_DEVICES} devices: the oldest goes`, async () => {
    await resident('Push Many')
    const ds = []
    for (let i = 0; i <= PUSH_DEVICES; i++) {
      const d = await device()
      ds.push(d)
      expect((await putPush(testEnv, devId('Push Many'), d.body, 1_000 + i)).status).toBe(204)
    }
    expect((await rows(devId('Push Many'))).map((r) => r.endpoint)).toEqual(
      ds.slice(1).map((d) => d.endpoint),
    )
  })

  it('with no VAPID key push is off: subscribing is 404 off and nothing is ever sent', async () => {
    await resident('Push Off')
    const off = { ...testEnv, VAPID_PRIVATE_JWK: undefined }
    const res = await putPush(off, devId('Push Off'), (await device()).body)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'off' })
    const t = await resident('Push Off Two')
    expect((await subscribe(t, (await device()).body)).status).toBe(204)
    const fake = fakePushService()
    expect(await pushTo(off, devId('Push Off Two'), 'request')).toBe(0)
    expect(await pushTo({ ...testEnv, VAPID_SUBJECT: undefined }, devId('Push Off Two'), 'request')).toBe(0)
    expect(fake.got).toHaveLength(0)
  })

  it('deleting the account forgets every device', async () => {
    const t = await resident('Push Leaver')
    expect((await subscribe(t, (await device()).body)).status).toBe(204)
    expect((await subscribe(t, (await device()).body)).status).toBe(204)
    expect((await api('/api/me', t, { method: 'DELETE' })).status).toBe(204)
    expect(await rows(devId('Push Leaver'))).toEqual([])
  })
})

describe('the inbox decides to push', () => {
  it('a request to someone with no inbox open buzzes their device, with no name and no words in it', async () => {
    const asker = await resident('Push Kavya')
    const t = await resident('Push Meera')
    const d = await device('hi')
    expect((await subscribe(t, d.body)).status).toBe(204)
    const fake = fakePushService()
    expect((await ask(asker, devId('Push Meera'))).status).toBe(201)
    await vi.waitFor(() => expect(fake.got).toHaveLength(1), WAIT)
    const [push] = fake.got
    expect(push!.endpoint).toBe(d.endpoint)
    expect(push!.headers.get('Content-Encoding')).toBe('aes128gcm')
    expect(push!.headers.get('Authorization')).toMatch(
      new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${SERVER}$`),
    )
    expect(push!.headers.get('TTL')).toBe('86400')
    expect(push!.headers.get('Topic')).toBe('request')
    // The whole payload, decrypted as the browser would: the kind and the language, nothing else.
    expect(await opened(push!, d.ua)).toEqual({ t: 'request', lang: 'hi' })
    const plain = new TextDecoder().decode(await decryptPayload(push!.body, d.ua))
    for (const leak of ['Kavya', 'pencil', 'dev:']) expect(plain).not.toContain(leak)
  })

  it('no push while they have an inbox open: the socket hears it instead', async () => {
    const asker = await resident('Push Open A')
    const t = await resident('Push Open B')
    expect((await subscribe(t, (await device()).body)).status).toBe(204)
    const box = await inbox(t)
    const fake = fakePushService()
    expect((await ask(asker, devId('Push Open B'))).status).toBe(201)
    await box.next('request')
    // Settle: the request's notice has come and gone, and it pushed nothing.
    await new Promise((r) => setTimeout(r, 100))
    expect(fake.got).toHaveLength(0)
  })

  it('a message to someone with no inbox open buzzes as a message; an unmatch never does', async () => {
    const { a, b, matchId } = await pair('Push Chat A', 'Push Chat B')
    const d = await device('en')
    expect((await subscribe(b, d.body)).status).toBe(204)
    const fake = fakePushService()
    const sent = await api(`/api/matches/${matchId}/messages`, a, {
      method: 'POST',
      body: JSON.stringify({ body: 'kal chai pe milte hain' }),
    })
    expect(sent.status).toBe(201)
    await vi.waitFor(() => expect(fake.got).toHaveLength(1), WAIT)
    expect(await opened(fake.got[0]!, d.ua)).toEqual({ t: 'message', lang: 'en' })
    expect(new TextDecoder().decode(await decryptPayload(fake.got[0]!.body, d.ua))).not.toContain('chai')
    expect((await api(`/api/matches/${matchId}`, a, { method: 'DELETE' })).status).toBe(204)
    await new Promise((r) => setTimeout(r, 100))
    expect(fake.got).toHaveLength(1)
  })

  it('a device the push service says is gone (404, 410) is forgotten; a 500 is kept', async () => {
    const t = await resident('Push Gone')
    const gone = await device()
    const lost = await device()
    const busy = await device()
    for (const d of [gone, lost, busy]) expect((await subscribe(t, d.body)).status).toBe(204)
    const fake = fakePushService((url) => (url === gone.endpoint ? 410 : url === lost.endpoint ? 404 : 500))
    expect(await pushTo(testEnv, devId('Push Gone'), 'message')).toBe(0)
    expect(fake.got).toHaveLength(3)
    expect((await rows(devId('Push Gone'))).map((r) => r.endpoint)).toEqual([busy.endpoint])
  })

  it(`rate-limited per person: ${PUSH_LIMIT.minute.perWindow} a minute, ${PUSH_LIMIT.hour.perWindow} an hour`, async () => {
    const t = await resident('Push Busy')
    expect((await subscribe(t, (await device()).body)).status).toBe(204)
    const fake = fakePushService()
    const hour = 3600_000 * 1000 // the start of an hour window, and so of a minute window too
    expect(await pushTo(testEnv, devId('Push Busy'), 'message', fetch, hour)).toBe(1)
    expect(await pushTo(testEnv, devId('Push Busy'), 'message', fetch, hour + 1_000)).toBe(0)
    expect(fake.got).toHaveLength(1)
    let at = hour
    for (let i = 1; i < PUSH_LIMIT.hour.perWindow; i++) {
      at += 60_000
      expect(await pushTo(testEnv, devId('Push Busy'), 'message', fetch, at)).toBe(1)
    }
    expect(await pushTo(testEnv, devId('Push Busy'), 'request', fetch, at + 60_000)).toBe(0)
    expect(fake.got).toHaveLength(PUSH_LIMIT.hour.perWindow)
  })

  it('a banned person’s devices get nothing', async () => {
    const t = await resident('Push Banned')
    expect((await subscribe(t, (await device()).body)).status).toBe(204)
    await db.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(devId('Push Banned')).run()
    const fake = fakePushService()
    expect(await pushTo(testEnv, devId('Push Banned'), 'request')).toBe(0)
    expect(fake.got).toHaveLength(0)
  })
})
