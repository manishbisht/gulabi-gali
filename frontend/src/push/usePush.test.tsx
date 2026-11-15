// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Lang } from '../i18n/strings'
import { usePush, type PushHookInput } from './usePush'

const push = vi.hoisted(() => ({
  syncPush: vi.fn<(token: string, lang: string) => Promise<void>>(async () => undefined),
  dropPushIfOn: vi.fn(async () => undefined),
}))
vi.mock('./push', async (real) => ({ ...(await real<typeof import('./push')>()), ...push }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
let out: ReturnType<typeof usePush>
function Probe(props: PushHookInput) {
  const current = usePush(props)
  useEffect(() => {
    out = current
  })
  return null
}
const base: PushHookInput = {
  ready: true,
  signedIn: true,
  resident: true,
  token: async () => 'tok',
  lang: 'hi',
}
const render = (over: Partial<PushHookInput> = {}) =>
  act(async () => root.render(<Probe {...base} {...over} />))

/** A stand-in `navigator.serviceWorker` that the test can post a message from. */
function fakeWorkerChannel() {
  const target = new EventTarget()
  vi.stubGlobal('navigator', { ...navigator, serviceWorker: target })
  return (data: unknown) => target.dispatchEvent(new MessageEvent('message', { data }))
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  history.replaceState(null, '', '/')
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('a tapped notification opens the site at ?inbox=1: the inbox is asked for, and the address is tidied', async () => {
  history.replaceState(null, '', '/?inbox=1&x=2')
  await render()
  expect(out.inboxAsked).toBe(true)
  expect(location.search).toBe('?x=2')
  await act(async () => out.inboxDone())
  expect(out.inboxAsked).toBe(false)
})

it('no ?inbox: nothing asked', async () => {
  await render()
  expect(out.inboxAsked).toBe(false)
})

it('a tap with the page already open: the service worker says so, and the inbox is asked for', async () => {
  const post = fakeWorkerChannel()
  await render()
  await act(async () => void post({ t: 'something else' }))
  expect(out.inboxAsked).toBe(false)
  await act(async () => void post({ t: 'gg-open-inbox' }))
  expect(out.inboxAsked).toBe(true)
})

it('a resident’s subscription is refreshed on each visit, and again when the language changes', async () => {
  await render()
  expect(push.syncPush).toHaveBeenCalledWith('tok', 'hi')
  await render({ lang: 'en' as Lang })
  expect(push.syncPush).toHaveBeenLastCalledWith('tok', 'en')
  expect(push.syncPush).toHaveBeenCalledTimes(2)
  expect(push.dropPushIfOn).not.toHaveBeenCalled()
})

it('signed out (the session ended elsewhere): this device stops getting pushes', async () => {
  await render({ signedIn: false, resident: false })
  expect(push.dropPushIfOn).toHaveBeenCalled()
  expect(push.syncPush).not.toHaveBeenCalled()
})

it('nothing while sign-in is still finding out who this is, or for someone without a profile yet', async () => {
  await render({ ready: false, signedIn: false, resident: false })
  await render({ ready: true, signedIn: true, resident: false })
  expect(push.dropPushIfOn).not.toHaveBeenCalled()
  expect(push.syncPush).not.toHaveBeenCalled()
})
