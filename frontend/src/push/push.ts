import { isInAppBrowser } from '../auth/inApp'
import { isIOS, isStandalone } from '../pwa/device'
import type { Lang } from '../i18n/strings'
import { deletePushSubscription, putPushSubscription, type PushSubscriptionInput } from '../net/api'
import { storage } from '../storage'

/*
 * Push notifications for requests and messages, per device, opted into from the profile sheet. The service
 * worker (public/sw.js) shows them; the Worker sends one only while no inbox is open (backend/src/push.ts),
 * and it never carries a name or a message: the lock screen says "a new request" or "a new message".
 */

/** This device said yes (and has not said no, or signed out, since): '1'. Kept so a visit can refresh it. */
const FLAG = 'gg-push'

/** The Worker's VAPID public key, baked in at build time (scripts/vapid-setup.mjs). Empty: push is off. */
const pushKey = (): string => import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

/** What decides whether push can be offered here. */
export interface Device {
  key: string
  ua: string
  /** Opened from the home screen (an installed web app). */
  standalone: boolean
  touchPoints: number
  /** Service workers, the Push API and notifications are all there. */
  apis: boolean
}

export function thisDevice(): Device {
  return {
    key: pushKey(),
    ua: navigator.userAgent,
    standalone: isStandalone(),
    touchPoints: navigator.maxTouchPoints ?? 0,
    apis: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  }
}

/**
 * Whether this device can turn push on: `ok`; `off` when the build has no key (then nothing is shown at all);
 * `in-app` in Instagram's (or another app's) browser, which has no push; `ios-browser` on an iPhone or iPad
 * outside the home screen, where Safari gives push only to an installed web app; `unsupported` elsewhere.
 */
export type PushSupport = 'ok' | 'off' | 'in-app' | 'ios-browser' | 'unsupported'

export function pushSupport(d: Device = thisDevice()): PushSupport {
  if (!d.key) return 'off'
  if (isInAppBrowser(d.ua)) return 'in-app'
  if (isIOS(d.ua, d.touchPoints) && !d.standalone) return 'ios-browser'
  return d.apis ? 'ok' : 'unsupported'
}

const BASE = import.meta.env.BASE_URL

function keyBytes(): Uint8Array<ArrayBuffer> {
  const s = atob(pushKey().replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

/** Whether `sub` was made with today's key: one made with an old key can never be pushed to now. */
function sameKey(sub: PushSubscription): boolean {
  const had = sub.options?.applicationServerKey
  if (!had) return true
  const a = new Uint8Array(had)
  const b = keyBytes()
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** This device's subscription, without registering anything. */
async function current(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration(BASE)
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** A subscription with today's key: the one there is, or a new one (permission must already be granted). */
async function subscribed(): Promise<PushSubscription> {
  await navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE })
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub)) {
    await sub.unsubscribe()
    sub = null
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes() })
}

function wire(sub: PushSubscription, lang: Lang): PushSubscriptionInput {
  const { keys } = sub.toJSON()
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: keys?.p256dh ?? '', auth: keys?.auth ?? '' },
    lang,
    server: pushKey(),
  }
}

/** Whether this device gets pushes now. */
export async function pushIsOn(): Promise<boolean> {
  try {
    return storage.get(FLAG) === '1' && Notification.permission === 'granted' && !!(await current())
  } catch {
    return false
  }
}

/** `on`; `off` when the permission prompt was dismissed; `denied` when it was refused; `failed` for the rest. */
export type PushOutcome = 'on' | 'off' | 'denied' | 'failed'

/** Asks for permission (from a tap), subscribes this device and tells the Worker. Never rejects. */
export async function enablePush(token: string, lang: Lang): Promise<PushOutcome> {
  try {
    const answer = await Notification.requestPermission()
    if (answer === 'denied') return 'denied'
    if (answer !== 'granted') return 'off'
    const sub = await subscribed()
    if ((await putPushSubscription(token, wire(sub, lang))) !== 204) {
      // The Worker would never push to it: do not leave it subscribed.
      await sub.unsubscribe().catch(() => false)
      return 'failed'
    }
    storage.set(FLAG, '1')
    return 'on'
  } catch {
    return 'failed'
  }
}

/**
 * Stops pushes to this device: the Worker forgets it (when there is a token), then the browser unsubscribes,
 * which also ends it at the push service, so a row the Worker missed goes on its next try (410). For the
 * switch, sign-out and a session that ended elsewhere. Never rejects.
 */
export async function disablePush(token: string | null): Promise<void> {
  storage.set(FLAG, '0')
  try {
    const sub = await current()
    if (!sub) return
    if (token) await deletePushSubscription(token, sub.endpoint)
    await sub.unsubscribe()
  } catch {
    // nothing more to do: the push service will answer 410 for it once it is gone
  }
}

/**
 * On each visit while it is on: sends the subscription again, so the Worker has the language chosen now and
 * the browser's current endpoint (browsers replace them now and then, and a new key needs a new one). Turns
 * itself off if the browser's permission was taken back. Never rejects.
 */
export async function syncPush(token: string, lang: Lang): Promise<void> {
  if (storage.get(FLAG) !== '1' || pushSupport() !== 'ok') return
  try {
    if (Notification.permission !== 'granted') return await disablePush(token)
    await putPushSubscription(token, wire(await subscribed(), lang))
  } catch {
    // the next visit tries again
  }
}

/** How long sign-out waits for the Worker to forget this device before it signs out anyway. */
const SIGN_OUT_WAIT_MS = 3000

/**
 * A sign-out that first stops pushes to this device, while the token still works: the next person to sign in
 * here must not get the last one's. It waits at most `SIGN_OUT_WAIT_MS` for that.
 */
export function signOutStoppingPush(
  token: () => Promise<string | null>,
  signOut: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const stop = token()
      .catch(() => null)
      .then((tok) => disablePush(tok))
    await Promise.race([stop, new Promise((done) => setTimeout(done, SIGN_OUT_WAIT_MS))])
    await signOut()
  }
}

/** Signed out without going through sign-out (the session ended elsewhere): stop pushes to this device. */
export async function dropPushIfOn(): Promise<void> {
  if (storage.get(FLAG) === '1') await disablePush(null)
}
