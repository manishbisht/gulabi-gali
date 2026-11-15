import { API_BASE } from './api'
import type { ClientErrorReport, ClientErrorWhere, DistrictId, UaApp, UaDevice } from './protocol'

/*
 * The error beacon: what goes wrong on someone's phone reaches our own Worker (`POST /api/errors`, kept 14
 * days in D1, read on the admin page), never a third party. A report carries no account id, no name and no
 * text anyone typed: only the error, where it was caught, the kind of browser, the build and the district.
 */

/** At most this many reports leave one page load. */
export const MAX_PER_PAGE = 5
const MSG_MAX = 300
const STACK_MAX = 1024

/** The bundle's git short sha, defined by vite.config.ts. */
declare const __GG_BUILD__: string | undefined
const BUILD: string = typeof __GG_BUILD__ === 'string' ? __GG_BUILD__ : 'dev'

/** Mobile or desktop, and the in-app browser by name (Instagram, Facebook) or `other`. */
export function uaClass(ua: string, coarse = false): { device: UaDevice; app: UaApp } {
  const app: UaApp = /\bInstagram\b/i.test(ua)
    ? 'instagram'
    : /FBAN|FBAV|FB_IAB|FBIOS/.test(ua)
      ? 'facebook'
      : 'other'
  const device: UaDevice = coarse || /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? 'mobile' : 'desktop'
  return { device, app }
}

const END = `\\s'"()<>`
/** A query string or fragment, up to a stack frame's `:line:col` or the end of the URL. */
const QUERY = new RegExp(
  `(\\b[a-z][a-z0-9+.-]*://[^?#${END}]*)[?#][^${END}]*?(?=(?::\\d+){1,2}(?=[${END}]|$)|[${END}]|$)`,
  'gi',
)
/**
 * An email: no `/` or `:` on either side of the `@`, so a Safari or Firefox stack frame (`fn@https://host/x.js:1:2`)
 * is never taken for one, nor is a bare one (`fn@file.js:1:2`: no address ends in a script extension). Keep the
 * same as the copy in backend/src/errors.ts (a test holds them equal).
 */
const EMAIL = new RegExp(
  `[^@${END}/:]+@(?![^@${END}/:]+\\.(?:m?js|cjs|jsx?|tsx?)(?=[:${END}]|$))[^@${END}/:]+\\.[a-z]{2,}\\b`,
  'gi',
)

/** `text` with no query string or fragment on any URL, and every email-shaped run as `[email]`. */
export function scrub(text: string): string {
  return text.replace(QUERY, '$1').replace(EMAIL, '[email]')
}

/**
 * The most a report may weigh as sent. The Worker reads at most 4 kB, and `MSG_MAX` and `STACK_MAX` count
 * characters: Devanagari is three bytes a letter, an emoji four, a control character six when escaped.
 */
const BODY_MAX_BYTES = 3500
const bytesOf = (r: ClientErrorReport) => new TextEncoder().encode(JSON.stringify(r)).length

/** `text` cut by `by` characters from the end, never leaving half of a surrogate pair. */
function shorter(text: string, by: number): string {
  let out = text.slice(0, Math.max(0, text.length - by))
  if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1)
  return out
}

/** The report cut, the stack first and then the message, until it weighs no more than `BODY_MAX_BYTES`. */
function fit(report: ClientErrorReport): ClientErrorReport {
  let { msg, stack } = report
  for (
    let over = bytesOf(report) - BODY_MAX_BYTES;
    over > 0;
    over = bytesOf({ ...report, msg, stack }) - BODY_MAX_BYTES
  ) {
    // a character is at least a byte, so cutting `over` characters always makes progress
    if (stack) stack = shorter(stack, Math.ceil(over / 6)) || null
    else if (msg.length > 1) msg = shorter(msg, Math.ceil(over / 6))
    else break
  }
  return { ...report, msg, stack }
}

/** The district the player is in (null before the city opens), for the next report. */
let district: DistrictId | null = null
export function noteDistrict(id: DistrictId | null): void {
  district = id
}

export interface Reporter {
  /** Sends `error` caught at `where`, unless the same one went already or the page has sent its five. */
  report(where: ClientErrorWhere, error: unknown): void
}

export function createReporter(opts: {
  send(report: ClientErrorReport): void
  ua: ClientErrorReport['ua']
  build: string
}): Reporter {
  const seen = new Set<string>()
  return {
    report(where, error) {
      try {
        if (seen.size >= MAX_PER_PAGE) return
        const msg = scrub(
          error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'unknown'),
        ).slice(0, MSG_MAX)
        const key = `${where}\n${msg}`
        if (seen.has(key)) return
        seen.add(key)
        const stack = error instanceof Error && error.stack ? scrub(error.stack).slice(0, STACK_MAX) : null
        opts.send(fit({ msg, stack, where, ua: opts.ua, build: opts.build, district }))
      } catch {
        // reporting must never be a second error
      }
    },
  }
}

/** `navigator.sendBeacon` (it outlives a page being closed), else a keepalive fetch; never throws or waits. */
export function sendBeacon(report: ClientErrorReport): void {
  const url = `${API_BASE}/api/errors`
  const body = JSON.stringify(report)
  try {
    // text/plain keeps it a simple request: no preflight, and the Worker reads the body as JSON anyway
    if (navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) return
  } catch {
    // fall through to fetch
  }
  void fetch(url, {
    method: 'POST',
    body,
    keepalive: true,
    mode: 'no-cors',
    credentials: 'omit',
    headers: { 'content-type': 'text/plain' },
  }).catch(() => undefined)
}

/** Listens for window errors and unhandled rejections; returns what removes the listeners. */
export function installErrorReporting(reporter: Reporter): () => void {
  const onError = (e: ErrorEvent) => reporter.report('error', e.error ?? e.message)
  const onRejection = (e: PromiseRejectionEvent) => reporter.report('rejection', e.reason)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

let page: Reporter | null = null
/** The page's one reporter, made on first use. */
function pageReporter(): Reporter {
  page ??= createReporter({
    send: sendBeacon,
    ua: uaClass(
      navigator.userAgent,
      typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    ),
    build: BUILD,
  })
  return page
}

/** Reports an error the page caught itself (React's boundary, a lost WebGL context). */
export const beaconError = (where: ClientErrorWhere, error: unknown): void =>
  pageReporter().report(where, error)

/** Starts the page's reporting: called once, from main.tsx. */
export const startErrorReporting = (): (() => void) => installErrorReporting(pageReporter())
