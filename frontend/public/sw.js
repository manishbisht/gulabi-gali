/*
 * Gulabi Gali's service worker. It does one thing: show a push notification for a new request or message, and
 * open the inbox when it is tapped. It caches nothing and never sees a page's requests.
 *
 * A push names nobody and quotes nothing: its payload is only {t: 'request' | 'message', lang: 'hi' | 'en'}
 * (backend/src/push.ts), and the words shown are these, never anything from the payload. They are the same as
 * pushTitle, pushRequest and pushMessage in src/i18n/strings.ts (src/push/sw.test.ts checks).
 */
const COPY = {
  hi: { title: 'Gulabi Gali', request: 'Ek nayi request', message: 'Ek naya message' },
  en: { title: 'Gulabi Gali', request: 'A new request', message: 'A new message' },
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = null
  try {
    data = event.data ? event.data.json() : null
  } catch {
    // Unreadable: still a push, and every push must show (userVisibleOnly), so the general words go up.
  }
  const lang = data && data.lang === 'en' ? 'en' : 'hi'
  const kind = data && data.t === 'request' ? 'request' : 'message'
  const copy = COPY[lang]
  event.waitUntil(
    self.registration.showNotification(copy.title, {
      body: copy[kind],
      // One notification per kind: a newer one replaces the last instead of stacking up.
      tag: `gg-${kind}`,
      renotify: true,
      icon: new URL('apple-touch-icon.png', self.registration.scope).href,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const page = pages.find((c) => new URL(c.url).origin === self.location.origin)
      if (page) {
        page.postMessage({ t: 'gg-open-inbox' })
        return page.focus()
      }
      return self.clients.openWindow(new URL('?inbox=1', self.registration.scope).href)
    })(),
  )
})
