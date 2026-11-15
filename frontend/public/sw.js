/*
 * Gulabi Gali's service worker. It does one thing: show a push notification for a new request or message (a tap
 * opens the inbox), or for a plan the person said they would come to being an hour away (a tap opens the city).
 * It caches nothing and never sees a page's requests.
 *
 * A push names nobody and quotes nothing: its payload is only {t: 'request' | 'message' | 'meetup', lang: 'hi' |
 * 'en'} (backend/src/push.ts), and the words shown are these, never anything from the payload. They are the same
 * as pushTitle, pushRequest, pushMessage and pushMeetup in src/i18n/strings.ts (src/push/sw.test.ts checks).
 */
const COPY = {
  hi: {
    title: 'Gulabi Gali',
    request: 'Ek nayi request',
    message: 'Ek naya message',
    meetup: 'Tumhara plan ek ghante mein',
  },
  en: {
    title: 'Gulabi Gali',
    request: 'A new request',
    message: 'A new message',
    meetup: 'Your plan is in an hour',
  },
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
  const kind = data && (data.t === 'request' || data.t === 'meetup') ? data.t : 'message'
  const copy = COPY[lang]
  event.waitUntil(
    self.registration.showNotification(copy.title, {
      body: copy[kind],
      // One notification per kind: a newer one replaces the last instead of stacking up.
      tag: `gg-${kind}`,
      renotify: true,
      data: { kind },
      icon: new URL('apple-touch-icon.png', self.registration.scope).href,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // A meet-up reminder opens the city as it is; anything else, the inbox.
  const inbox = !(event.notification.data && event.notification.data.kind === 'meetup')
  event.waitUntil(
    (async () => {
      const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const page = pages.find((c) => new URL(c.url).origin === self.location.origin)
      if (page) {
        if (inbox) page.postMessage({ t: 'gg-open-inbox' })
        return page.focus()
      }
      return self.clients.openWindow(new URL(inbox ? '?inbox=1' : '', self.registration.scope).href)
    })(),
  )
})
