import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.tsx'
import { AuthProvider } from './auth/AuthProvider'
import { startErrorReporting } from './net/errorBeacon'
import { dropPwaSource, registerAppWorker, watchInstall } from './pwa/install'
import { ErrorBoundary } from './ui/ErrorBoundary'

// before anything reads the address (the analytics beacon, place links, shared links): a home-screen launch's tag
dropPwaSource()
startErrorReporting()
// Chrome's install offer can come at once; the worker waits for the page to load and go idle
watchInstall()
registerAppWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
