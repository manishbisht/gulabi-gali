/*
 * Gulabi Gali's service worker. It does one thing: show a push notification for a new request or message, or a
 * friend's invite for chai (a tap opens the inbox, which says who and where), or for a plan the person said they
 * would come to being an hour away (a tap opens the city at that plan's poster). It caches nothing and never sees a
 * page's requests (see below). It is registered on every visit (src/pwa/install.ts), so the site can be installed.
 *
 * A push names nobody and quotes nothing: its payload is only {t: 'request' | 'message' | 'chai' | 'meetup', lang:
 * 'hi' | 'en'} (backend/src/push.ts), and a reminder's `at`, the poster's place (`<district>:poster-<wall>`), which goes
 * only into the tap's data (`?at=`, see src/world/placeLink.ts), never on the screen. The words shown are these,
 * never anything from the payload. They are the same as pushTitle, pushRequest, pushMessage, pushChai and pushMeetup in
 * src/i18n/strings.ts (src/push/sw.test.ts checks).
 */
const COPY = {
  hi: {
    title: 'Gulabi Gali',
    request: 'Ek nayi request',
    message: 'Ek naya message',
    chai: 'Ek dost ne chai pe bulaya',
    meetup: 'Tumhara plan ek ghante mein',
  },
  en: {
    title: 'Gulabi Gali',
    request: 'A new request',
    message: 'A new message',
    chai: 'A friend invited you for chai',
    meetup: 'Your plan is in an hour',
  },
}

/** A poster's place, as a place link names it: anything else a payload says is ignored. */
const POSTER_PLACE = /^[a-z][a-z-]{0,30}:poster-\d{1,3}$/

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/*
 * No fetch listener, on purpose: the worker never sees a page's requests. Chrome no longer needs one to offer "Add to
 * Home screen" (the manifest is enough), iOS never did, and an empty one would still wake the worker for every
 * request in Safari and Firefox. Nothing is cached either: each deploy replaces the hashed files in /assets, and an
 * old cached index.html or chunk would ask for files that are gone and break the city until the cache was cleared.
 */

self.addEventListener('push', (event) => {
  let data = null
  try {
    data = event.data ? event.data.json() : null
  } catch {
    // Unreadable: still a push, and every push must show (userVisibleOnly), so the general words go up.
  }
  const lang = data && data.lang === 'en' ? 'en' : 'hi'
  const kind = data && (data.t === 'request' || data.t === 'chai' || data.t === 'meetup') ? data.t : 'message'
  const copy = COPY[lang]
  const at = kind === 'meetup' && typeof data.at === 'string' && POSTER_PLACE.test(data.at) ? data.at : null
  event.waitUntil(
    self.registration.showNotification(copy.title, {
      body: copy[kind],
      // One notification per kind: a newer one replaces the last instead of stacking up.
      tag: `gg-${kind}`,
      renotify: true,
      data: at ? { kind, at } : { kind },
      icon: new URL('apple-touch-icon.png', self.registration.scope).href,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // A meet-up reminder opens the city at its poster (or as it is, when it does not say where); anything else,
  // the inbox.
  const data = event.notification.data || {}
  const inbox = data.kind !== 'meetup'
  const at = !inbox && typeof data.at === 'string' && POSTER_PLACE.test(data.at) ? data.at : null
  const url = new URL(inbox ? '?inbox=1' : at ? `?at=${at}` : '', self.registration.scope).href
  event.waitUntil(
    (async () => {
      const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const page = pages.find((c) => new URL(c.url).origin === self.location.origin)
      if (!page) return self.clients.openWindow(url)
      if (inbox) page.postMessage({ t: 'gg-open-inbox' })
      await page.focus()
      if (!at) return
      // The open page goes to the poster (the link is followed after "Padharo", as any place link is); a page
      // this worker does not control yet cannot be steered, so the poster opens in a new window instead.
      try {
        await page.navigate(url)
      } catch {
        await self.clients.openWindow(url)
      }
    })(),
  )
})
