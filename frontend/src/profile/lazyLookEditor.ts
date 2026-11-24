import { lazy } from 'react'

/** The dressing room, fetched the first time someone opens it: most visits never do. */
export const LookEditor = lazy(() => import('./LookEditor'))
