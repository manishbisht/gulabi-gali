// @vitest-environment happy-dom
import { act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider'
import type { ClerkSession } from './clerk'
import { useAuth, type AuthState } from './useAuth'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const clerk = vi.hoisted(() => ({ crash: () => {} }))
vi.mock('./clerk', () => ({
  default: function FakeClerk({ onSession }: { onSession: (s: ClerkSession) => void }) {
    const [boom, setBoom] = useState(false)
    useEffect(() => {
      onSession({ signedIn: true, ready: true, token: async () => 'live', signOut: async () => {} })
      clerk.crash = () => setBoom(true)
    }, [onSession])
    if (boom) throw new Error('clerk crashed after sign-in')
    return null
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
  return null
}

beforeEach(() => {
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
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

it('a Clerk crash after sign-in drops the session instead of keeping a dead token getter', async () => {
  await act(async () =>
    root.render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    ),
  )
  await vi.waitFor(() => expect(auth?.signedIn).toBe(true))
  await act(async () => clerk.crash())
  expect(auth?.signedIn).toBe(false)
  expect(await auth?.token()).toBeNull()
})
