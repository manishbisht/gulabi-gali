import type { BrowserContextOptions, Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'

/*
 * Push notifications without a real push service. A browser under test cannot receive a real push, so:
 *
 * - `fakeBrowserPush` stands in for the browser's push service on a page: `PushManager.subscribe` hands back a
 *   subscription whose endpoint is the fake service below and whose keys the test holds. Everything else (the
 *   service worker registered from /sw.js, the permission, the Worker's storage of it) is real.
 * - `FakePushService` is that endpoint: a tiny HTTP server on this machine that records every push the Worker
 *   sends (the Worker takes a loopback endpoint only under DEV_AUTH), and decrypts them as the browser would.
 */

const subtle = globalThis.crypto.subtle
const b64u = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')

/** One push the fake service took. */
export interface Delivery {
  path: string
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

export interface FakePushService {
  /** Where a subscription points: this service, under a name of the test's choosing. */
  endpoint: (name: string) => string
  /** The pushes that have arrived for `name` so far. */
  got: (name: string) => Delivery[]
  close: () => Promise<void>
}

export async function fakePushService(): Promise<FakePushService> {
  const all: Delivery[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      all.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) })
      res.writeHead(201).end()
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as { port: number }
  return {
    endpoint: (name) => `http://127.0.0.1:${port}/push/${name}`,
    got: (name) => all.filter((d) => d.path === `/push/${name}`),
    close: () => new Promise((done) => server.close(() => done())),
  }
}

/** A browser's push keys: what its subscription hands out, and the private half that reads a push. */
export interface PushKeys {
  p256dh: string
  auth: string
  privateKey: CryptoKey
}

export async function pushKeys(): Promise<PushKeys> {
  const pair = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  return {
    p256dh: b64u(new Uint8Array(await subtle.exportKey('raw', pair.publicKey))),
    auth: b64u(globalThis.crypto.getRandomValues(new Uint8Array(16))),
    privateKey: pair.privateKey,
  }
}

/** Bytes in a fresh ArrayBuffer, as WebCrypto's types want them. */
const u8 = (b: ArrayLike<number>) => Uint8Array.from(b)
const text = (s: string) => new TextEncoder().encode(s)

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(
    await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8),
  )
}

/** What the browser does with a push (RFC 8291, aes128gcm): the plaintext, as text. */
export async function openPush(body: Buffer, keys: PushKeys): Promise<string> {
  const all = u8(body)
  const salt = all.slice(0, 16)
  const idlen = all[20]!
  const asPublic = all.slice(21, 21 + idlen)
  const theirs = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: theirs }, keys.privateKey, 256))
  const uaPublic = u8(Buffer.from(keys.p256dh, 'base64url'))
  const ikm = await hkdf(
    u8(Buffer.from(keys.auth, 'base64url')),
    ecdh,
    u8([...text('WebPush: info\0'), ...uaPublic, ...asPublic]),
    32,
  )
  const cek = await hkdf(salt, ikm, text('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, text('Content-Encoding: nonce\0'), 12)
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(
    await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, all.slice(21 + idlen)),
  )
  let end = padded.length - 1
  while (end >= 0 && padded[end] === 0) end--
  return new TextDecoder().decode(padded.subarray(0, end))
}

/** Context options for a page that may show notifications (the permission prompt, answered yes). */
export const NOTIFY: BrowserContextOptions = { permissions: ['notifications'] }

/** Installs the stand-in PushManager on the page it runs in (see `fakeBrowserPush`). */
function standIn({ endpoint, p256dh, auth }: { endpoint: string; p256dh: string; auth: string }) {
  const STORE = 'fake-push-sub'
  const state = { unsubscribed: false }
  ;(window as unknown as { __fakePush: typeof state }).__fakePush = state
  const make = (server: string) => ({
    endpoint,
    options: {
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from(atob(server), (c) => c.charCodeAt(0)).buffer,
    },
    toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
    unsubscribe: async () => {
      localStorage.removeItem(STORE)
      state.unsubscribed = true
      return true
    },
  })
  PushManager.prototype.getSubscription = async function () {
    const server = localStorage.getItem(STORE)
    return (server ? make(server) : null) as unknown as PushSubscription
  }
  PushManager.prototype.subscribe = async function (opts?: PushSubscriptionOptionsInit) {
    const bytes = new Uint8Array(opts!.applicationServerKey as ArrayBuffer)
    const server = btoa(String.fromCharCode(...bytes))
    localStorage.setItem(STORE, server)
    return make(server) as unknown as PushSubscription
  }
}

/**
 * Makes `page`'s PushManager hand out a subscription to `endpoint` with `keys`, now and after any reload (it is
 * kept in the page's storage). `window.__fakePush.unsubscribed` turns true when the app unsubscribes.
 */
export async function fakeBrowserPush(page: Page, endpoint: string, keys: PushKeys) {
  const args = { endpoint, p256dh: keys.p256dh, auth: keys.auth }
  await page.addInitScript(standIn, args)
  await page.evaluate(standIn, args)
}

const BACKEND = fileURLToPath(new URL('../../../backend', import.meta.url))

/**
 * The push subscriptions the local Worker holds for `userId` (its D1, read with `wrangler d1 execute --local`,
 * the same database `wrangler dev` uses). For checking what is stored and what is gone.
 */
export function pushRows(userId: string): { endpoint: string; lang: string }[] {
  if (!/^dev:[a-z0-9-]+$/.test(userId)) throw new Error(`not a dev id: ${userId}`)
  const out = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'gulabi-gali',
      '--local',
      '--json',
      '--command',
      `SELECT endpoint, lang FROM push_subs WHERE user_id = '${userId}' ORDER BY created_at`,
    ],
    { cwd: BACKEND, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
  )
  return (JSON.parse(out) as { results: { endpoint: string; lang: string }[] }[])[0]!.results
}
