import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react'
import DevAuth from './dev'
import type { ClerkSession } from './clerk'
import { AuthContext, authMode, SIGNED_OUT, type AuthState } from './useAuth'

// Loaded only in clerk mode: a build with no key keeps the SDK out of the entry chunk.
const ClerkAuth = lazy(() => import('./clerk'))

/**
 * The app sits above the Clerk module, not inside it: the SDK arrives later and reports in, so the
 * tree never remounts when it loads and the world is never restarted. Until then, everyone is signed out.
 */
function ClerkMode({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<ClerkSession | null>(null)
  const value = useMemo<AuthState>(
    () => ({ ...SIGNED_OUT, ...session, mode: 'clerk', openSignIn: () => setOpen(true) }),
    [session],
  )
  const close = useCallback(() => setOpen(false), [])
  return (
    <>
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
      <Suspense fallback={null}>
        <ClerkAuth
          publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY!}
          open={open}
          onClose={close}
          onSession={setSession}
        />
      </Suspense>
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
