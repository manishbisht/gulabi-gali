// @vitest-environment happy-dom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import { useAuth, type AuthState } from './useAuth'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./clerk', () => ({
  default: () => {
    throw new Error('clerk-js failed to load')
  },
}))

let root: Root
let host: HTMLElement
let auth: AuthState | null = null

function Probe() {
  const current = useAuth()
  useEffect(() => {
    auth = current
  })
  return <p id="city">the city</p>
}

beforeEach(() => {
  sessionStorage.clear()
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k')
  vi.stubEnv('VITE_DEV_AUTH', '1')
  vi.spyOn(console, 'error').mockImplementation(() => undefined) // React logs the caught render error
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('the city still renders, signed out, when Clerk throws', async () => {
  await act(async () =>
    root.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    ),
  )
  expect(host.querySelector('#city')).not.toBeNull()
  expect(auth?.mode).toBe('clerk')
  expect(auth?.signedIn).toBe(false)
  expect(await auth?.token()).toBeNull()
})

it('in clerk mode a stored gg-dev-token is never read or sent', async () => {
  sessionStorage.setItem('gg-dev-token', 'stale-dev-token')
  const get = vi.spyOn(Storage.prototype, 'getItem')
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  await act(async () =>
    root.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    ),
  )
  expect(await auth?.token()).toBeNull()
  expect(get).not.toHaveBeenCalledWith('gg-dev-token')
  expect(fetchMock).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
