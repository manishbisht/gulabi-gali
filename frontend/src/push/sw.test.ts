/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../i18n/strings'

/** public/sw.js as the browser gets it: a plain script, served as-is from the site's origin. */
const SOURCE = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'sw.js'), 'utf8')
const SCOPE = 'https://gulabi-gali.manishbisht.me/'

interface FakeClient {
  url: string
  postMessage: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
}

/** Runs the service worker against a stand-in `self`, and hands back its listeners and what it called. */
function boot(windows: FakeClient[] = []) {
  const on = new Map<string, (e: unknown) => void>()
  const showNotification = vi.fn(async () => undefined)
  const openWindow = vi.fn(async () => null)
  const self = {
    location: new URL(`${SCOPE}sw.js`),
    registration: { scope: SCOPE, showNotification },
    clients: { matchAll: vi.fn(async () => windows), openWindow, claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (type: string, fn: (e: unknown) => void) => on.set(type, fn),
  }
  new Function('self', SOURCE)(self)
  /** Fires `type` and waits for whatever it handed to `waitUntil`. */
  const fire = async (type: string, extra: object = {}) => {
    const work: Promise<unknown>[] = []
    on.get(type)!({ waitUntil: (p: Promise<unknown>) => work.push(p), ...extra })
    await Promise.all(work)
  }
  return { on, fire, showNotification, openWindow, self }
}

const push = (payload: unknown) => ({
  data: {
    json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload),
  },
})

describe('the service worker', () => {
  it('handles only push, a tap on a notification, install and activate: no fetch, no cache', () => {
    const { on } = boot()
    expect([...on.keys()].sort()).toEqual(['activate', 'install', 'notificationclick', 'push'])
    expect(SOURCE).not.toMatch(/caches\.|importScripts|fetch\(/)
  })

  for (const lang of ['hi', 'en'] as const) {
    it(`shows "${t('pushTitle', lang)}: ${t('pushRequest', lang)}" and "… ${t('pushMessage', lang)}" in ${lang}, the copy strings.ts has`, async () => {
      const sw = boot()
      await sw.fire('push', push({ t: 'request', lang }))
      await sw.fire('push', push({ t: 'message', lang }))
      expect(sw.showNotification).toHaveBeenNthCalledWith(
        1,
        t('pushTitle', lang),
        expect.objectContaining({ body: t('pushRequest', lang), tag: 'gg-request' }),
      )
      expect(sw.showNotification).toHaveBeenNthCalledWith(
        2,
        t('pushTitle', lang),
        expect.objectContaining({ body: t('pushMessage', lang), tag: 'gg-message' }),
      )
    })
  }

  it('shows only its own words: anything else a payload carries never reaches the screen', async () => {
    const sw = boot()
    await sw.fire(
      'push',
      push({ t: 'message', lang: 'en', name: 'Kavya', body: 'kal chai pe?', title: 'Kavya' }),
    )
    const [title, options] = sw.showNotification.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(JSON.stringify([title, options])).not.toMatch(/Kavya|chai/)
    expect(title).toBe('Gulabi Gali')
  })

  it('a push it cannot read still says something, in Hinglish (userVisibleOnly: every push shows)', async () => {
    const sw = boot()
    await sw.fire('push', { data: { json: () => JSON.parse('nope') } })
    await sw.fire('push', {})
    await sw.fire('push', push({ t: 'other', lang: 'xx' }))
    for (const call of sw.showNotification.mock.calls as unknown as [string, { body: string }][])
      expect(call).toEqual(['Gulabi Gali', expect.objectContaining({ body: t('pushMessage', 'hi') })])
  })

  it('a tap with no page open opens the inbox', async () => {
    const sw = boot()
    const close = vi.fn()
    await sw.fire('notificationclick', { notification: { close } })
    expect(close).toHaveBeenCalled()
    expect(sw.openWindow).toHaveBeenCalledWith(`${SCOPE}?inbox=1`)
  })

  it('a tap with the page open brings it forward and tells it to open the inbox', async () => {
    const page: FakeClient = { url: `${SCOPE}?x=1`, postMessage: vi.fn(), focus: vi.fn(async () => page) }
    const sw = boot([page])
    await sw.fire('notificationclick', { notification: { close: vi.fn() } })
    expect(page.postMessage).toHaveBeenCalledWith({ t: 'gg-open-inbox' })
    expect(page.focus).toHaveBeenCalled()
    expect(sw.openWindow).not.toHaveBeenCalled()
  })
})
