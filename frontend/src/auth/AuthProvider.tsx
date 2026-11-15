import { Component, lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react'
import { signOutStoppingPush } from '../push/push'
import DevAuth from './dev'
import type { ClerkSession } from './clerk'
import { AuthContext, authMode, SIGNED_OUT, type AuthState } from './useAuth'

// Loaded only in clerk mode: a build with no key keeps the SDK out of the entry chunk.
const ClerkAuth = lazy(() => import('./clerk'))

/** A failed Clerk chunk or a throwing SDK must not take the city down: render nothing, stay signed out. */
class ClerkBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFail() // whoever Clerk last reported as signed in is no longer vouched for
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * The app sits above the Clerk module, not inside it: the SDK arrives later and reports in, so the
 * tree never remounts when it loads and the world is never restarted. Until then, everyone is signed out.
 */
function ClerkMode({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<ClerkSession | null>(null)
  const value = useMemo<AuthState>(
    () => ({
      ...SIGNED_OUT,
      ready: false,
      ...session,
      // whichever way Clerk signs out, this device's pushes stop first (see `signOutStoppingPush`)
      ...(session && { signOut: signOutStoppingPush(session.token, session.signOut) }),
      mode: 'clerk',
      openSignIn: () => setOpen(true),
    }),
    [session],
  )
  const close = useCallback(() => setOpen(false), [])
  const forget = useCallback(() => setSession(null), [])
  return (
    <>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
      <ClerkBoundary onFail={forget}>
        <Suspense fallback={null}>
          <ClerkAuth
            publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY!}
            open={open}
            onClose={close}
            onSession={setSession}
          />
        </Suspense>
      </ClerkBoundary>
    </>
  )
}

/** Picks the sign-in mode once, from the build's env, and provides `useAuth()` to everything below. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const mode = authMode()
  if (mode === 'dev') return <DevAuth>{children}</DevAuth>
  if (mode === 'clerk') return <ClerkMode>{children}</ClerkMode>
  return <>{children}</>
}
