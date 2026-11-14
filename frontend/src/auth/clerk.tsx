import { useEffect } from 'react'
import { ClerkProvider, SignIn, useAuth as useClerkAuth, useClerk } from '@clerk/react'
import { SignInSheet } from './AuthShell'
import { isInAppBrowser } from './inApp'
import type { AuthState } from './useAuth'

// Everything that touches @clerk/react lives here, so the SDK is its own lazily loaded chunk and a
// build with no publishable key never downloads it.

export type ClerkSession = Pick<AuthState, 'signedIn' | 'token' | 'signOut'>

// Email code is the primary way in; Google is hidden where Google refuses to sign in.
const HIDE_GOOGLE = { socialButtonsRoot: { display: 'none' }, dividerRow: { display: 'none' } }

interface Props {
  publishableKey: string
  open: boolean
  onClose: () => void
  onSession: (session: ClerkSession) => void
}

/** Renders no app content: it reports who is signed in and shows the sheet, so the app tree never remounts. */
function Bridge({ open, onClose, onSession }: Omit<Props, 'publishableKey'>) {
  const { isSignedIn, getToken } = useClerkAuth()
  const { signOut } = useClerk()
  const signedIn = Boolean(isSignedIn)
  useEffect(() => {
    // getToken() returns Clerk's cached session token and refreshes it when it is about to expire.
    onSession({ signedIn, token: () => getToken(), signOut: () => signOut() })
  }, [onSession, signedIn, getToken, signOut])
  useEffect(() => {
    if (signedIn) onClose() // signing in closes the sheet, so signing out does not reopen it
  }, [signedIn, onClose])
  if (!open || signedIn) return null
  return <SignInSheet form={<SignIn routing="hash" />} onClose={onClose} />
}

export default function ClerkAuth({ publishableKey, ...rest }: Props) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      appearance={{
        options: { socialButtonsPlacement: 'top' },
        elements: isInAppBrowser() ? HIDE_GOOGLE : undefined,
        variables: { colorPrimary: '#c2185b', borderRadius: '0.75rem' },
      }}
    >
      <Bridge {...rest} />
    </ClerkProvider>
  )
}
