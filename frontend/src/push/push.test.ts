// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storage } from '../storage'
import { disablePush, enablePush, pushIsOn, pushSupport, syncPush, type Device } from './push'

// A made-up public key (65 bytes, 04 || x || y): only its bytes matter here, nothing is signed with it.
const KEY = 'BOtiOn-z9JWm-_9mpAIbr0kDl0p7PUP2tbI2XNm5ofP5rXxGdrfwyJZ8x0mGaJ3fpxOSNZ5n3ynVnaV2NDkKsAA'
const OTHER = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const bytes = (b64: string) =>
  Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

const device = (over: Partial<Device> = {}): Device => ({
  key: KEY,
  ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  standalone: false,
  touchPoints: 5,
  apis: true,
  ...over,
})

describe('where push is offered', () => {
  it('off entirely without a VAPID key in the build', () =>
    expect(pushSupport(device({ key: '' }))).toBe('off'))
  it('Android Chrome: yes', () => expect(pushSupport(device())).toBe('ok'))
  it('Instagram’s in-app browser: no, and it says so', () =>
    expect(
      pushSupport(
        device({
          ua: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/130.0 Instagram 350.0.0',
        }),
      ),
    ).toBe('in-app'))
  it('iPhone Safari outside the home screen: no, and it says how', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile Safari/604.1'
    expect(pushSupport(device({ ua, apis: false }))).toBe('ios-browser')
    // an iPad asking for the desktop site is still an iPad
    const ipad =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15'
    expect(pushSupport(device({ ua: ipad, apis: false }))).toBe('ios-browser')
    // installed to the home screen, it can
    expect(pushSupport(device({ ua, standalone: true }))).toBe('ok')
  })
  it('a Mac’s Safari (no touch) can', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15'
    expect(pushSupport(device({ ua, touchPoints: 0 }))).toBe('ok')
  })
  it('a browser with no Push API: no', () => expect(pushSupport(device({ apis: false }))).toBe('unsupported'))
})

/** A browser's push machinery, faked: one registration whose subscription the test can see. */
function fakeBrowser(
  permission: NotificationPermission = 'granted',
  answer: NotificationPermission = 'granted',
) {
  let sub: (PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> }) | null = null
  let n = 0
  const make = (key: string) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/fake-${++n}`
    const s = {
      endpoint,
      options: { applicationServerKey: bytes(key).buffer, userVisibleOnly: true },
      toJSON: () => ({ endpoint, keys: { p256dh: 'p256', auth: 'auth' } }),
      unsubscribe: vi.fn(async () => {
        sub = null
        return true
      }),
    }
    return s as unknown as PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> }
  }
  const pushManager = {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async (opts: PushSubscriptionOptionsInit) => {
      const key = btoa(String.fromCharCode(...new Uint8Array(opts.applicationServerKey as Uint8Array)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      sub = make(key)
      return sub
    }),
  }
  const reg = { pushManager }
  const register = vi.fn(async () => reg)
  vi.stubGlobal('PushManager', function PushManager() {})
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { register, ready: Promise.resolve(reg), getRegistration: vi.fn(async () => reg) },
  })
  const requestPermission = vi.fn(async () => {
    permission = answer
    return answer
  })
  vi.stubGlobal('Notification', {
    get permission() {
      return permission
    },
    requestPermission,
  })
  return {
    pushManager,
    register,
    requestPermission,
    get sub() {
      return sub
    },
    preset: (key: string) => (sub = make(key)),
  }
}

/** The API, faked: every call to /api/me/push recorded, answered with `status`. */
function fakeApi(status = 204) {
  const calls: { method: string; body: unknown; auth: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toMatch(/\/api\/me\/push$/)
      calls.push({
        method: init.method!,
        body: JSON.parse(init.body as string),
        auth: new Headers(init.headers).get('Authorization'),
      })
      return new Response(null, { status })
    }),
  )
  return calls
}

beforeEach(() => {
  storage.clear()
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', KEY)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('turning push on and off', () => {
  it('on: asks permission, registers /sw.js, subscribes with our key and stores it with the language', async () => {
    const b = fakeBrowser('default')
    const calls = fakeApi()
    expect(await enablePush('tok', 'hi')).toBe('on')
    expect(b.requestPermission).toHaveBeenCalled()
    expect(b.register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
    const opts = b.pushManager.subscribe.mock.calls[0]![0] as PushSubscriptionOptionsInit
    expect(opts.userVisibleOnly).toBe(true)
    expect([...(opts.applicationServerKey as Uint8Array)]).toEqual([...bytes(KEY)])
    expect(calls).toEqual([
      {
        method: 'PUT',
        auth: 'Bearer tok',
        body: { endpoint: b.sub!.endpoint, keys: { p256dh: 'p256', auth: 'auth' }, lang: 'hi', server: KEY },
      },
    ])
    expect(await pushIsOn()).toBe(true)
  })

  it('permission refused: nothing subscribed, nothing sent', async () => {
    const b = fakeBrowser('default', 'denied')
    const calls = fakeApi()
    expect(await enablePush('tok', 'en')).toBe('denied')
    expect(b.pushManager.subscribe).not.toHaveBeenCalled()
    expect(calls).toEqual([])
    expect(await pushIsOn()).toBe(false)
  })

  it('the server says no (push off there, or another key): the browser is unsubscribed again', async () => {
    const b = fakeBrowser()
    fakeApi(404)
    expect(await enablePush('tok', 'en')).toBe('failed')
    expect(b.sub).toBeNull()
    expect(await pushIsOn()).toBe(false)
  })

  it('a subscription made with an old key is replaced, not reused', async () => {
    const b = fakeBrowser()
    const calls = fakeApi()
    const old = b.preset(OTHER)
    expect(await enablePush('tok', 'en')).toBe('on')
    expect(old.unsubscribe).toHaveBeenCalled()
    expect(b.sub).not.toBe(old)
    expect((calls[0]!.body as { endpoint: string }).endpoint).toBe(b.sub!.endpoint)
  })

  it('off: the server forgets this device, then the browser unsubscribes', async () => {
    const b = fakeBrowser()
    const calls = fakeApi()
    await enablePush('tok', 'en')
    const endpoint = b.sub!.endpoint
    await disablePush('tok')
    expect(calls[1]).toEqual({ method: 'DELETE', auth: 'Bearer tok', body: { endpoint } })
    expect(b.sub).toBeNull()
    expect(await pushIsOn()).toBe(false)
  })

  it('off with no token (signed out already): the browser still unsubscribes', async () => {
    const b = fakeBrowser()
    const calls = fakeApi()
    await enablePush('tok', 'en')
    await disablePush(null)
    expect(calls).toHaveLength(1)
    expect(b.sub).toBeNull()
  })
})

describe('keeping it fresh on each visit', () => {
  it('does nothing for someone who never turned it on', async () => {
    const b = fakeBrowser()
    const calls = fakeApi()
    await syncPush('tok', 'en')
    expect(b.register).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('re-sends the subscription with the language now chosen', async () => {
    const b = fakeBrowser()
    const calls = fakeApi()
    await enablePush('tok', 'hi')
    await syncPush('tok', 'en')
    expect(calls).toHaveLength(2)
    expect(calls[1]!.body).toMatchObject({ endpoint: b.sub!.endpoint, lang: 'en' })
  })

  it('a browser that dropped its subscription gets a new one, without asking again', async () => {
    const b = fakeBrowser()
    const calls = fakeApi()
    await enablePush('tok', 'hi')
    await b.sub!.unsubscribe()
    await syncPush('tok', 'hi')
    expect(b.requestPermission).toHaveBeenCalledTimes(1)
    expect(b.sub).not.toBeNull()
    expect(calls).toHaveLength(2)
  })

  it('permission taken back in the browser’s settings: it switches itself off', async () => {
    const b = fakeBrowser()
    const calls = fakeApi()
    await enablePush('tok', 'hi')
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() })
    await syncPush('tok', 'hi')
    expect(calls[1]!.method).toBe('DELETE')
    expect(b.sub).toBeNull()
  })
})
