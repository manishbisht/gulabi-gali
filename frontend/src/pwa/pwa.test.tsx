// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isInAppBrowser, socialApp } from '../auth/inApp'
import { t } from '../i18n/strings'
import { storage } from '../storage'
import { HINTED_KEY } from '../ui/FirstHint'
import { isIOS, isIOSSafari, isStandalone } from './device'
import {
  dropPwaSource,
  hintDue,
  INSTALL_HINT_DELAY_MS,
  INSTALL_HINT_KEY,
  INSTALL_HINT_REST_MS,
  INSTALL_HINT_SEEN_MS,
  installWay,
  resetCityTime,
  watchInstall,
  type InstallDevice,
} from './install'
import { InstallHint } from './InstallHint'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const UA = {
  instagramAndroid:
    'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 320.0.0.0.0 Android (33/13)',
  instagramIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21C62 Instagram 320.0.0 (iPhone14,5; iOS 17_2)',
  facebookAndroid:
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]',
  facebookIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21C62 [FBAN/FBIOS;FBAV/450.0]',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Mobile/21C62 Line/14.0.0',
  webview:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 Version/4.0 Chrome/120 Mobile Safari/537.36',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  /** An iPad asking for the desktop site: a Mac, but with a touch screen. */
  safariIpad:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  googleAppIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/343.0.695551749 Mobile/15E148 Safari/604.1',
  firefoxDesktop: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
} as const

describe('which browser this is', () => {
  it('names Instagram and Facebook by their own browsers, and nothing else', () => {
    expect(socialApp(UA.instagramAndroid)).toBe('Instagram')
    expect(socialApp(UA.instagramIos)).toBe('Instagram')
    expect(socialApp(UA.facebookAndroid)).toBe('Facebook')
    expect(socialApp(UA.facebookIos)).toBe('Facebook')
    for (const ua of [
      UA.line,
      UA.webview,
      UA.chromeAndroid,
      UA.safariIphone,
      UA.chromeIphone,
      UA.firefoxDesktop,
    ])
      expect(socialApp(ua), ua).toBeNull()
  })

  it('every app it names is one the in-app detection (sign-in, push) already knows', () => {
    for (const ua of [UA.instagramAndroid, UA.instagramIos, UA.facebookAndroid, UA.facebookIos])
      expect(isInAppBrowser(ua)).toBe(true)
  })

  it('knows an iPhone and an iPad (even one asking for desktop sites), and Safari among their browsers', () => {
    expect(isIOS(UA.safariIphone, 5)).toBe(true)
    expect(isIOS(UA.safariIpad, 5)).toBe(true)
    expect(isIOS(UA.safariIpad, 0)).toBe(false) // a Mac
    expect(isIOS(UA.chromeAndroid, 5)).toBe(false)
    expect(isIOSSafari(UA.safariIphone, 5)).toBe(true)
    expect(isIOSSafari(UA.safariIpad, 5)).toBe(true)
    for (const ua of [UA.chromeIphone, UA.googleAppIphone, UA.instagramIos, UA.facebookIos, UA.line])
      expect(isIOSSafari(ua, 5), ua).toBe(false)
  })

  it('knows a launch from the home screen: display-mode standalone, or iOS navigator.standalone', () => {
    const media = vi.spyOn(window, 'matchMedia')
    media.mockImplementation(
      (q: string) => ({ matches: q === '(display-mode: standalone)' }) as MediaQueryList,
    )
    expect(isStandalone()).toBe(true)
    media.mockImplementation(() => ({ matches: false }) as MediaQueryList)
    expect(isStandalone()).toBe(false)
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    expect(isStandalone()).toBe(true)
    Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true })
    media.mockRestore()
  })
})

describe('the home-screen hint: where and when', () => {
  const device = (d: Partial<InstallDevice>): InstallDevice => ({
    ua: UA.chromeAndroid,
    touchPoints: 5,
    coarse: true,
    standalone: false,
    prompt: false,
    ...d,
  })

  it("asks with Chrome's offer, or Safari's Share sheet on an iPhone; elsewhere not at all", () => {
    expect(installWay(device({ prompt: true }))).toBe('prompt')
    expect(installWay(device({ prompt: false }))).toBeNull()
    expect(installWay(device({ ua: UA.safariIphone }))).toBe('ios')
    expect(installWay(device({ ua: UA.chromeIphone }))).toBeNull()
    expect(installWay(device({ ua: UA.firefoxDesktop, touchPoints: 0 }))).toBeNull()
  })

  it('not on a laptop, where Chrome offers an install too but there is no home screen', () => {
    const laptop = { ua: UA.firefoxDesktop.replace('Firefox', 'Chrome'), touchPoints: 0, coarse: false }
    expect(installWay(device({ ...laptop, prompt: true }))).toBeNull()
    // a touch laptop or a tablet: a finger is there
    expect(installWay(device({ ...laptop, touchPoints: 10, prompt: true }))).toBe('prompt')
    expect(installWay(device({ ...laptop, coarse: true, prompt: true }))).toBe('prompt')
  })

  it('never inside Instagram or Facebook (or another app), whatever they offer', () => {
    for (const ua of [UA.instagramAndroid, UA.instagramIos, UA.facebookAndroid, UA.facebookIos, UA.webview])
      expect(installWay(device({ ua, prompt: true })), ua).toBeNull()
  })

  it('never once opened from the home screen', () => {
    expect(installWay(device({ standalone: true, prompt: true }))).toBeNull()
    expect(installWay(device({ ua: UA.safariIphone, standalone: true }))).toBeNull()
  })

  it('shows the first time, then rests 30 days; never after an install', () => {
    const now = Date.UTC(2026, 10, 25)
    const day = 24 * 3600_000
    expect(INSTALL_HINT_REST_MS).toBe(30 * day)
    expect(hintDue(null, now)).toBe(true)
    expect(hintDue('installed', now)).toBe(false)
    expect(hintDue(String(now - 29 * day), now)).toBe(false)
    expect(hintDue(String(now - 30 * day), now)).toBe(true)
    // a clock put forward and back again cannot make it nag, nor hold it forever
    expect(hintDue(String(now + day), now)).toBe(false)
    expect(hintDue(String(now + 31 * day), now)).toBe(true)
    // something unreadable is as good as nothing
    expect(hintDue('', now)).toBe(true)
    expect(hintDue('soon', now)).toBe(true)
  })
})

describe('a launch from the home screen', () => {
  afterEach(() => history.replaceState(null, '', '/'))

  it('takes ?source=pwa out of the address and leaves the rest', () => {
    history.replaceState(null, '', '/?source=pwa&at=walled-city:bench-1')
    expect(dropPwaSource()).toBe(true)
    expect(location.search).toBe('?at=walled-city%3Abench-1')
    expect(dropPwaSource()).toBe(false)
  })

  it('leaves an address without it alone', () => {
    history.replaceState(null, '', '/?inbox=1')
    expect(dropPwaSource()).toBe(false)
    expect(location.search).toBe('?inbox=1')
  })
})

describe('InstallHint', () => {
  let root: Root
  let host: HTMLElement
  let ua: string = UA.chromeAndroid
  const prompt = vi.fn(async () => undefined)

  /** Chrome offering an install, as it does: an event the page may hold on to. */
  function offer(outcome: 'accepted' | 'dismissed' = 'dismissed'): Event {
    const e = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(e, { prompt, userChoice: Promise.resolve({ outcome }) })
    act(() => void window.dispatchEvent(e))
    return e
  }

  // as main.tsx does, once for the page
  watchInstall()

  beforeEach(() => {
    vi.useFakeTimers()
    storage.clear()
    storage.set(HINTED_KEY, '1')
    resetCityTime()
    ua = UA.chromeAndroid
    vi.spyOn(navigator, 'userAgent', 'get').mockImplementation(() => ua)
    // a phone: a touch screen
    vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(5)
    prompt.mockClear()
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    // Chrome takes back any offer still held (as after an install), and the next test starts clean
    act(() => void window.dispatchEvent(new Event('appinstalled')))
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const mount = (busy = false) => act(() => root.render(<InstallHint lang="hi" busy={busy} />))
  /** A new page view of the same hint (photo mode, the taxi: the HUD goes and comes back). */
  const remount = (busy = false) => {
    act(() => root.unmount())
    root = createRoot(host)
    mount(busy)
  }
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))
  const hint = () => host.querySelector('.install-hint')
  const saved = () => storage.get(INSTALL_HINT_KEY)

  it("holds Chrome's own banner back", () => {
    expect(offer().defaultPrevented).toBe(true)
  })

  it('waits two minutes in the city, then asks; seen a moment, it rests; Rakho opens Chrome’s dialog', async () => {
    offer('accepted')
    mount()
    wait(INSTALL_HINT_DELAY_MS - 2000)
    expect(hint()).toBeNull()
    wait(2000)
    expect(hint()!.textContent).toContain(t('installHint', 'hi'))
    // up, but not yet seen
    expect(saved()).toBeNull()
    wait(INSTALL_HINT_SEEN_MS)
    expect(Number(saved())).toBeGreaterThan(0)
    const go = [...host.querySelectorAll('button')].find((b) => b.textContent === t('installHintGo', 'hi'))!
    await act(async () => go.click())
    expect(prompt).toHaveBeenCalledOnce()
    expect(hint()).toBeNull()
    expect(saved()).toBe('installed')
  })

  it('counts only time the city is on screen', () => {
    offer()
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    mount()
    wait(INSTALL_HINT_DELAY_MS * 2)
    expect(hint()).toBeNull()
    hidden.mockReturnValue(false)
    wait(INSTALL_HINT_DELAY_MS)
    expect(hint()).not.toBeNull()
  })

  it('with something over the street it neither counts nor shows, and spends nothing; clear again, it asks', () => {
    offer()
    mount(true)
    wait(INSTALL_HINT_DELAY_MS * 2)
    expect(hint()).toBeNull()
    expect(saved()).toBeNull()
    // the street clears: the two minutes start only now
    mount(false)
    wait(INSTALL_HINT_DELAY_MS - 2000)
    expect(hint()).toBeNull()
    // busy again right at the two-minute mark: still nothing, nothing written
    mount(true)
    wait(10_000)
    expect(hint()).toBeNull()
    expect(saved()).toBeNull()
    mount(false)
    wait(2000)
    expect(hint()).not.toBeNull()
  })

  it('one covered or unmounted before it was seen may ask again; one seen does not', () => {
    offer()
    mount()
    wait(INSTALL_HINT_DELAY_MS)
    expect(hint()).not.toBeNull()
    // a sheet comes up over it within a second: it steps aside, and is not spent
    wait(1000)
    mount(true)
    expect(hint()).toBeNull()
    wait(60_000)
    expect(saved()).toBeNull()
    mount(false)
    expect(hint()).not.toBeNull()
    // photo mode takes the HUD away a second later: still not spent, and back once the HUD is
    wait(1000)
    act(() => root.unmount())
    expect(saved()).toBeNull()
    root = createRoot(host)
    mount()
    wait(1000)
    expect(hint()).not.toBeNull()
    // this time it stays up long enough to be seen
    wait(INSTALL_HINT_SEEN_MS)
    expect(saved()).not.toBeNull()
    remount()
    wait(INSTALL_HINT_DELAY_MS * 2)
    expect(hint()).toBeNull()
  })

  it('closes with ×, or by itself, and does not ask again for 30 days', () => {
    offer()
    mount()
    wait(INSTALL_HINT_DELAY_MS)
    const close = host.querySelector<HTMLButtonElement>(
      `button[aria-label="${t('installHintDismiss', 'hi')}"]`,
    )!
    act(() => close.click())
    expect(hint()).toBeNull()
    // answered, so spent at once
    expect(saved()).not.toBeNull()
    // the next visit, still with an offer
    resetCityTime()
    remount()
    offer()
    wait(INSTALL_HINT_DELAY_MS * 3)
    expect(hint()).toBeNull()
    // a month on: one left alone goes away by itself
    storage.set(INSTALL_HINT_KEY, String(Date.now() - INSTALL_HINT_REST_MS))
    resetCityTime()
    remount()
    wait(INSTALL_HINT_DELAY_MS)
    expect(hint()).not.toBeNull()
    wait(30_000)
    expect(hint()).toBeNull()
  })

  it('waits for the first visit’s steps to be closed', () => {
    storage.set(HINTED_KEY, '0')
    offer()
    mount()
    wait(INSTALL_HINT_DELAY_MS * 2)
    expect(hint()).toBeNull()
    storage.set(HINTED_KEY, '1')
    wait(1000)
    expect(hint()).not.toBeNull()
  })

  it('on an iPhone in Safari says where Share is, with nothing to press but ×', () => {
    ua = UA.safariIphone
    mount()
    wait(INSTALL_HINT_DELAY_MS)
    expect(hint()!.textContent).toContain(t('installHintIos', 'hi'))
    expect(host.querySelectorAll('button')).toHaveLength(1)
  })

  it('not on a laptop, even with an offer', () => {
    vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(0)
    ua = UA.firefoxDesktop.replace('Firefox', 'Chrome')
    offer()
    mount()
    wait(INSTALL_HINT_DELAY_MS * 2)
    expect(hint()).toBeNull()
  })

  it('inside Instagram, or opened from the home screen, it does not even count', () => {
    const every = vi.spyOn(window, 'setInterval')
    ua = UA.instagramAndroid
    offer()
    mount()
    wait(INSTALL_HINT_DELAY_MS * 2)
    expect(hint()).toBeNull()
    expect(every).not.toHaveBeenCalled()
    ua = UA.chromeAndroid
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    remount()
    wait(INSTALL_HINT_DELAY_MS * 2)
    expect(hint()).toBeNull()
    expect(every).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true })
  })

  it('never where nothing can install, nor once installed', () => {
    ua = UA.firefoxDesktop
    mount()
    wait(INSTALL_HINT_DELAY_MS * 2)
    expect(hint()).toBeNull()
    ua = UA.chromeAndroid
    storage.set(INSTALL_HINT_KEY, 'installed')
    remount()
    offer()
    wait(INSTALL_HINT_DELAY_MS * 2)
    expect(hint()).toBeNull()
  })
})
