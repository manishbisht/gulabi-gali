// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { isInAppBrowser } from './inApp'
import { authMode, useAuth, type AuthState } from './useAuth'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const INSTAGRAM_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 320.0.0.0.0 Android (33/13)'
const INSTAGRAM_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21C62 Instagram 320.0.0 (iPhone14,5; iOS 17_2)'
const FACEBOOK =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]'
const LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) Mobile/21C62 Line/14.0.0'
const WEBVIEW =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 Version/4.0 Chrome/120 Mobile Safari/537.36'
const CHROME =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

it('isInAppBrowser detects Instagram Android and iOS UAs and not Chrome', () => {
  expect(isInAppBrowser(INSTAGRAM_ANDROID)).toBe(true)
  expect(isInAppBrowser(INSTAGRAM_IOS)).toBe(true)
  expect(isInAppBrowser(FACEBOOK)).toBe(true)
  expect(isInAppBrowser(LINE)).toBe(true)
  expect(isInAppBrowser(WEBVIEW)).toBe(true)
  expect(isInAppBrowser(CHROME)).toBe(false)
})

afterEach(() => vi.unstubAllEnvs())

it('mode precedence clerk > dev > none', () => {
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '')
  vi.stubEnv('VITE_DEV_AUTH', '')
  expect(authMode()).toBe('none')
  vi.stubEnv('VITE_DEV_AUTH', '1')
  expect(authMode()).toBe('dev')
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_abc')
  expect(authMode()).toBe('clerk')
  vi.stubEnv('VITE_DEV_AUTH', '')
  expect(authMode()).toBe('clerk')
})

let root: Root
let host: HTMLElement
let auth: AuthState

function Probe() {
  const current = useAuth()
  useEffect(() => {
    auth = current
  })
  return null
}

beforeEach(() => {
  sessionStorage.clear()
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '')
  vi.stubEnv('VITE_DEV_AUTH', '1')
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function mount() {
  await act(async () =>
    root.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    ),
  )
}

async function devSignIn(name: string, answer: () => Response = () => Response.json({ token: 'tok-123' })) {
  const fetchMock = vi.fn(async () => answer())
  vi.stubGlobal('fetch', fetchMock)
  await act(async () => auth.openSignIn())
  const input = host.querySelector('input') as HTMLInputElement
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, name)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () =>
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  return fetchMock
}

it('dev sign-in stores the token and token() returns it', async () => {
  await mount()
  expect(auth.mode).toBe('dev')
  expect(auth.signedIn).toBe(false)
  expect(await auth.token()).toBeNull()
  const fetchMock = await devSignIn('Asha')
  expect(fetchMock).toHaveBeenCalledOnce()
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toMatch(/\/api\/dev\/login$/)
  expect(JSON.parse(init.body as string)).toEqual({ name: 'Asha' })
  expect(sessionStorage.getItem('gg-dev-token')).toBe('tok-123')
  expect(auth.signedIn).toBe(true)
  expect(await auth.token()).toBe('tok-123')
  expect(host.querySelector('form')).toBeNull() // the sheet closed
})

it('a login answer without a usable token signs nobody in', async () => {
  await mount()
  for (const bad of [{}, { token: 7 }, { token: '' }, { token: null }]) {
    await devSignIn('Asha', () => Response.json(bad))
    expect(auth.signedIn, JSON.stringify(bad)).toBe(false)
    expect(sessionStorage.getItem('gg-dev-token')).toBeNull()
    expect(host.querySelector('[role="alert"]')).not.toBeNull() // and says so
  }
})

it('signOut clears it', async () => {
  await mount()
  await devSignIn('Asha')
  await act(async () => auth.signOut())
  expect(sessionStorage.getItem('gg-dev-token')).toBeNull()
  expect(auth.signedIn).toBe(false)
  expect(await auth.token()).toBeNull()
})

it('a stored dev token signs the visitor in on load', async () => {
  sessionStorage.setItem('gg-dev-token', 'old')
  await mount()
  expect(auth.signedIn).toBe(true)
  expect(await auth.token()).toBe('old')
})

it('none mode: nobody is signed in and openSignIn does nothing', async () => {
  vi.stubEnv('VITE_DEV_AUTH', '')
  await mount()
  expect(auth.mode).toBe('none')
  await act(async () => auth.openSignIn())
  expect(host.querySelector('form')).toBeNull()
  expect(await auth.token()).toBeNull()
})
