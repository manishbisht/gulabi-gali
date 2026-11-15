// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE } from './api'
import {
  createReporter,
  installErrorReporting,
  MAX_PER_PAGE,
  noteDistrict,
  scrub,
  sendBeacon,
  uaClass,
} from './errorBeacon'
import type { ClientErrorReport } from './protocol'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  noteDistrict(null)
})

const IG_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 Instagram 312.0.0.34.111 Android'
const FB_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.30.112]'
const DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

const sent = () => {
  const send = vi.fn<(r: ClientErrorReport) => void>()
  return {
    send,
    reporter: createReporter({ send, ua: { device: 'mobile', app: 'instagram' }, build: 'abc1234' }),
  }
}

describe('uaClass', () => {
  it('names the device kind and the in-app browser, never more', () => {
    expect(uaClass(IG_ANDROID)).toEqual({ device: 'mobile', app: 'instagram' })
    expect(uaClass(FB_IOS)).toEqual({ device: 'mobile', app: 'facebook' })
    expect(uaClass(DESKTOP)).toEqual({ device: 'desktop', app: 'other' })
    expect(uaClass(DESKTOP, true)).toEqual({ device: 'mobile', app: 'other' }) // a coarse pointer
  })
})

describe('scrub', () => {
  it('takes every query string and fragment off a URL, keeping a stack frame’s line and column', () => {
    expect(scrub('at https://g.test/assets/a.js?v=2:10:20')).toBe('at https://g.test/assets/a.js:10:20')
    expect(scrub('GET https://api.test/live?token=SECRET#x failed')).toBe('GET https://api.test/live failed')
    expect(scrub('mail me at a.b@example.in')).toBe('mail me at [email]')
  })

  it('keeps Safari and Firefox stack frames (`fn@url:line:col`) whole, and still takes out a real email', () => {
    const safari = [
      'tick@https://gulabi-gali.manishbisht.me/assets/index-abc.js?v=3:1:2345',
      'module code@https://gulabi-gali.manishbisht.me/assets/main-x1.js:3:4',
      'global code@https://gulabi-gali.manishbisht.me/:1:1',
    ].join('\n')
    expect(scrub(safari)).toBe(
      [
        'tick@https://gulabi-gali.manishbisht.me/assets/index-abc.js:1:2345',
        'module code@https://gulabi-gali.manishbisht.me/assets/main-x1.js:3:4',
        'global code@https://gulabi-gali.manishbisht.me/:1:1',
      ].join('\n'),
    )
    const firefox =
      'createStage/onLost@https://g.test/assets/stage-9f.js:12:7\n@https://g.test/assets/index.js:1:99'
    expect(scrub(firefox)).toBe(firefox)
    expect(scrub(`${firefox}\nsent by riya.k@example.in`)).toBe(`${firefox}\nsent by [email]`)
  })

  it('keeps a frame whose URL has no scheme (`fn@file.js:1:2`): that is a frame, not an address', () => {
    const bare = 'tick@index-abc.js:1:2345\nrender@main.js:3:4\n@chunk.js:9:9'
    expect(scrub(bare)).toBe(bare)
    // an address is still one, with a port after it or a script-like name inside it
    expect(scrub('write to riya.k@example.in:25 now')).toBe('write to [email]:25 now')
    expect(scrub('write to riya@main.js.example.in')).toBe('write to [email]')
  })
})

describe('the reporter', () => {
  it('sends only the fields of a report: no user id, no email, no name, no typed text', () => {
    const { send, reporter } = sent()
    noteDistrict('mi-road')
    const err = new TypeError('x is undefined at https://g.test/?name=Riya')
    err.stack = `TypeError: x is undefined\n    at f (https://g.test/a.js?who=me:1:2)\n${'y'.repeat(3000)}`
    reporter.report('error', err)
    expect(send).toHaveBeenCalledTimes(1)
    const body = send.mock.calls[0]![0]
    expect(Object.keys(body).sort()).toEqual(['build', 'district', 'msg', 'stack', 'ua', 'where'])
    expect(body).toMatchObject({
      msg: 'TypeError: x is undefined at https://g.test/',
      where: 'error',
      ua: { device: 'mobile', app: 'instagram' },
      build: 'abc1234',
      district: 'mi-road',
    })
    expect(body.stack!.length).toBe(1024)
    expect(body.stack).toContain('at f (https://g.test/a.js:1:2)')
    expect(JSON.stringify(body)).not.toMatch(/Riya|who=me/)
  })

  it('sends one identical error once, and at most five a page', () => {
    const { send, reporter } = sent()
    reporter.report('error', new Error('same'))
    reporter.report('error', new Error('same'))
    expect(send).toHaveBeenCalledTimes(1)
    reporter.report('rejection', new Error('same')) // caught somewhere else: a different error
    expect(send).toHaveBeenCalledTimes(2)
    for (let i = 0; i < 10; i++) reporter.report('error', new Error(`other ${i}`))
    expect(MAX_PER_PAGE).toBe(5)
    expect(send).toHaveBeenCalledTimes(5)
  })

  it('keeps the whole report under 3.5 kB as sent, by bytes: three-byte text cannot push it past the Worker’s 4 kB', () => {
    const { send, reporter } = sent()
    const hindi = 'नमस्ते जयपुर '.repeat(120) // three bytes a letter, more than the 1024-character cap
    const error = new Error(hindi)
    error.stack = hindi
    reporter.report('error', error)
    const report = send.mock.calls[0]![0]
    expect(new TextEncoder().encode(JSON.stringify(report)).length).toBeLessThanOrEqual(3500)
    expect(report.msg.length).toBeGreaterThan(0)
    expect(report.stack?.length ?? 0).toBeGreaterThan(0) // the stack gave way first, not all of it
  })

  it('does not cut a character in two when it shortens a report', () => {
    const { send, reporter } = sent()
    const error = new Error('x')
    error.stack = '😀'.repeat(1000) // a surrogate pair each
    reporter.report('error', error)
    const stack = send.mock.calls[0]![0].stack!
    expect(stack).toMatch(/^(?:😀)+$/u)
  })

  it('takes a rejection that is not an Error, and never throws itself', () => {
    const send = vi.fn(() => {
      throw new Error('offline')
    })
    const reporter = createReporter({ send, ua: { device: 'desktop', app: 'other' }, build: 'dev' })
    expect(() => reporter.report('rejection', 'just a string')).not.toThrow()
    expect(send.mock.calls[0]).toEqual([expect.objectContaining({ msg: 'just a string', stack: null })])
  })
})

describe('installErrorReporting', () => {
  it('reports window errors and unhandled rejections, and stops when removed', () => {
    const { send, reporter } = sent()
    const remove = installErrorReporting(reporter)
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }))
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.assign(rejection, { reason: new Error('nope') })
    window.dispatchEvent(rejection)
    expect(send.mock.calls.map(([r]) => [r.where, r.msg])).toEqual([
      ['error', 'Error: boom'],
      ['rejection', 'Error: nope'],
    ])
    remove()
    window.dispatchEvent(new ErrorEvent('error', { message: 'later', error: new Error('later') }))
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('sendBeacon', () => {
  const report: ClientErrorReport = {
    msg: 'm',
    stack: null,
    where: 'error',
    ua: { device: 'desktop', app: 'other' },
    build: 'dev',
    district: null,
  }

  it('beacons the report as text/plain to /api/errors', async () => {
    const beacon = vi.fn<(url: string, body: Blob) => boolean>(() => true)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon })
    sendBeacon(report)
    expect(beacon.mock.calls[0]![0]).toBe(`${API_BASE}/api/errors`)
    const blob = beacon.mock.calls[0]![1]
    expect(blob.type).toBe('text/plain')
    expect(JSON.parse(await blob.text())).toEqual(report)
  })

  it('falls back to a keepalive fetch when there is no beacon, or it is refused', () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: () => false })
    sendBeacon(report)
    expect(fetcher).toHaveBeenCalledWith(
      `${API_BASE}/api/errors`,
      expect.objectContaining({ method: 'POST', keepalive: true, credentials: 'omit' }),
    )
  })
})
