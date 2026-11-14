import { lazy, Suspense, useEffect, useState } from 'react'
import App from './App.tsx'

// The owner's moderation page: its own chunk, fetched only on #/admin, so none of it ships with the city.
const AdminPage = lazy(() => import('./admin/AdminPage'))

const onAdmin = () => /^#\/admin(\/|$)/.test(location.hash)

/** `#/admin` is the moderation page; anything else is the city. */
export default function Root() {
  const [admin, setAdmin] = useState(onAdmin)
  useEffect(() => {
    const follow = () => setAdmin(onAdmin())
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])
  return admin ? (
    <Suspense fallback={null}>
      <AdminPage />
    </Suspense>
  ) : (
    <App />
  )
}
