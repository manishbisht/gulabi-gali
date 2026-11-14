import { createContext, useContext } from 'react'

export type AuthMode = 'clerk' | 'dev' | 'none'

export interface AuthState {
  mode: AuthMode
  signedIn: boolean
  /** A fresh bearer token for the API, or null when signed out. */
  token(): Promise<string | null>
  /** Opens the sign-in sheet. A no-op in `none` mode. */
  openSignIn(): void
  signOut(): Promise<void>
}

/** clerk when a publishable key is set, else dev when VITE_DEV_AUTH is '1', else none. Read per call, so tests can stub it. */
export function authMode(): AuthMode {
  if (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) return 'clerk'
  return import.meta.env.VITE_DEV_AUTH === '1' ? 'dev' : 'none'
}

export const SIGNED_OUT: AuthState = {
  mode: 'none',
  signedIn: false,
  token: async () => null,
  openSignIn: () => undefined,
  signOut: async () => undefined,
}

export const AuthContext = createContext<AuthState>(SIGNED_OUT)

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
