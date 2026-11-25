import { isInAppBrowser } from '../auth/inApp'
import { storage } from '../storage'
import { isIOSSafari, isStandalone } from './device'

/*
 * Putting Gulabi Gali on the home screen. The manifest (public/manifest.webmanifest) makes it installable, and the
 * service worker (public/sw.js) is registered here on every visit, not only for push; Chrome then offers it with
 * `beforeinstallprompt`, which is held back here so that Chrome's own banner never pops up over the street. The city
 * asks once instead, quietly, after a couple of minutes of walking with nothing over the street (InstallHint.tsx): on
 * a phone or tablet with Chrome's own prompt, on an iPhone in Safari with where to find "Add to Home Screen". Never
 * inside Instagram's or another app's browser (nothing can be installed from there), never on a laptop ("home
 * screen" means nothing there), never once installed, and at most once a month.
 */

/** When the hint last showed (ms since the epoch), or `installed`: then never again on this browser. */
export const INSTALL_HINT_KEY = 'gg-install-hint'
/** Time in the city, on screen, before the hint may show. */
export const INSTALL_HINT_DELAY_MS = 2 * 60_000
/** How long a hint that was seen (and closed, or let be) keeps quiet. */
export const INSTALL_HINT_REST_MS = 30 * 24 * 3600_000
/** How long the hint must be on screen, uncovered, to count as seen; one covered or unmounted sooner may ask again. */
export const INSTALL_HINT_SEEN_MS = 5000
/** The address a launch from the home screen opens (the manifest's start_url), taken off before anything reads it. */
export const PWA_SOURCE = 'pwa'

/** Chrome's `beforeinstallprompt` event: not in TypeScript's DOM types. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** How this browser can install the city: Chrome's prompt, Safari's Share sheet, or not at all (null). */
export type InstallWay = 'prompt' | 'ios'

export interface InstallDevice {
  ua: string
  touchPoints: number
  /** The main pointer is a finger (`(pointer: coarse)`). */
  coarse: boolean
  standalone: boolean
  /** Chrome has offered an install (`beforeinstallprompt` came). */
  prompt: boolean
}

export function installWay(d: InstallDevice): InstallWay | null {
  if (d.standalone || isInAppBrowser(d.ua)) return null
  // Chrome offers an install on a laptop too, but a "home screen" line would be wrong there
  if (d.prompt && (d.coarse || d.touchPoints > 0)) return 'prompt'
  return isIOSSafari(d.ua, d.touchPoints) ? 'ios' : null
}

/**
 * Whether the hint may show now, by what `INSTALL_HINT_KEY` holds: yes the first time, never after an install, and
 * otherwise only once `INSTALL_HINT_REST_MS` has passed since it last showed (either way, so a clock put back cannot
 * hold it forever, and one put forward cannot make it nag).
 */
export function hintDue(saved: string | null, now: number): boolean {
  if (saved === null) return true
  if (saved === 'installed') return false
  const at = Number(saved)
  if (!Number.isFinite(at) || saved.trim() === '') return true
  return Math.abs(now - at) >= INSTALL_HINT_REST_MS
}

/** Remembers that the hint was seen now: the next one waits a month. */
export function markHintShown(now: number = Date.now()): void {
  if (storage.get(INSTALL_HINT_KEY) !== 'installed') storage.set(INSTALL_HINT_KEY, String(now))
}

/** Time the city has been on screen with nothing over it, this page: kept here so a remounted hint does not start over. */
let cityMs = 0
export const cityTime = (): number => cityMs
export function countCityTime(ms: number): void {
  cityMs += ms
}
/** Time the hint has been in view, uncovered and on screen, this page: added up across its reappearances. */
let shownMs = 0
export const shownTime = (): number => shownMs
export function addShownTime(ms: number): void {
  shownMs += Math.max(0, ms)
}
/** For tests: a new page. */
export function resetCityTime(): void {
  cityMs = 0
  shownMs = 0
}

let held: InstallPromptEvent | null = null
const changed = new Set<() => void>()
let watching = false

/**
 * From the start of the page (`beforeinstallprompt` can come before the city opens): holds Chrome's install offer
 * for the hint, and remembers an install, however it was made, so the hint never asks again.
 */
export function watchInstall(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    held = e as InstallPromptEvent
    for (const cb of changed) cb()
  })
  window.addEventListener('appinstalled', () => {
    held = null
    storage.set(INSTALL_HINT_KEY, 'installed')
    for (const cb of changed) cb()
  })
}

/** Whether Chrome's install offer is in hand. */
export const canPrompt = (): boolean => held !== null

/** Calls `cb` when the offer comes or goes. */
export function onInstallChange(cb: () => void): () => void {
  changed.add(cb)
  return () => void changed.delete(cb)
}

/** Shows Chrome's own install dialog (from a tap). An offer can be used once, so it is let go either way. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const offer = held
  if (!offer) return 'unavailable'
  held = null
  try {
    await offer.prompt()
    const { outcome } = await offer.userChoice
    if (outcome === 'accepted') storage.set(INSTALL_HINT_KEY, 'installed')
    return outcome
  } catch {
    return 'unavailable'
  } finally {
    for (const cb of changed) cb()
  }
}

/** This browser, for `installWay`. */
export function thisInstallDevice(): InstallDevice {
  return {
    ua: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints ?? 0,
    coarse: (() => {
      try {
        return !!window.matchMedia?.('(pointer: coarse)').matches
      } catch {
        return false
      }
    })(),
    standalone: isStandalone(),
    prompt: canPrompt(),
  }
}

/**
 * Takes `?source=pwa` (the manifest's start_url) out of the address before anything reads it: the analytics page
 * view, a place link, a shared "Bulao" link. Runs first thing in main.tsx. True when it was there.
 */
export function dropPwaSource(): boolean {
  const url = new URL(location.href)
  if (url.searchParams.get('source') !== PWA_SOURCE) return false
  url.searchParams.delete('source')
  history.replaceState(history.state, '', url)
  return true
}

/**
 * Registers the service worker once the page has loaded and the main thread is idle, so it never competes with the
 * city opening. Not in an app's own browser (nothing to install there, and no push). The e2e build registers it only
 * when a spec asks (`?gg-sw=1`): a worker controlling a page would sit between the other specs and the requests
 * they stand in for. A production build folds that check away.
 */
export function registerAppWorker(): void {
  if (!('serviceWorker' in navigator) || isInAppBrowser()) return
  if (import.meta.env.VITE_TEST_HOOKS === '1' && new URLSearchParams(location.search).get('gg-sw') !== '1')
    return
  const base = import.meta.env.BASE_URL
  const register = () => {
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      // no worker: the city works the same, it just cannot be installed (or push) from here
    })
  }
  const idle = () =>
    'requestIdleCallback' in window
      ? requestIdleCallback(register, { timeout: 10_000 })
      : setTimeout(register, 3000)
  if (document.readyState === 'complete') idle()
  else window.addEventListener('load', idle, { once: true })
}
