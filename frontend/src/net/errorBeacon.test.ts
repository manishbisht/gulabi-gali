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
