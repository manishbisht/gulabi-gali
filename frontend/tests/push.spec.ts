import { expect, test, type Page, type WebSocket } from '@playwright/test'
import { closePeople, resident, verify, type Resident } from './support/people'
import {
  fakeBrowserPush,
  fakePushService,
  NOTIFY,
  openPush,
  pushKeys,
  pushRows,
  type FakePushService,
  type PushKeys,
} from './support/push'

// Push notifications end to end, short of a real push service (a browser under test cannot receive one): the
// opt-in in the profile sheet, the service worker it registers, the Worker storing and removing the
// subscription, and the Worker deciding to push (to a fake push service on this machine) only when the inbox
// is shut, with nothing in it but the kind of thing and the language.

let service: FakePushService
test.beforeAll(async () => {
  service = await fakePushService()
})
test.afterAll(() => service.close())
test.afterEach(closePeople)

const REASON = 'Mujhe bhi pencil sketching pasand hai'

/** `from` asks `to` to meet, over the API with `from`'s own sign-in. */
async function ask(from: Resident, to: Resident) {
  const status = await from.page.evaluate(
    async ({ to, reason }) => {
      const res = await fetch('http://127.0.0.1:8787/api/requests', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('gg-dev-token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to, reason }),
      })
      return res.status
    },
    { to: to.id, reason: REASON },
  )
  expect(status).toBe(201)
}

/**
 * A resident whose browser hands out a subscription to the fake push service, under their own name. The page
 * is opened again with the stand-in in place, and its sockets are watched, so `shut` can see the inbox close.
 */
async function subscriber(browser: Parameters<typeof resident>[0], first: string) {
  const r = await resident(browser, first, NOTIFY)
  const keys = await pushKeys()
  await fakeBrowserPush(r.page, service.endpoint(r.name), keys)
  const sockets: WebSocket[] = []
  r.page.on('websocket', (ws) => sockets.push(ws))
  await r.page.goto('/?gg-test=1')
  await r.page.getByRole('button', { name: 'Padharo!' }).click()
  await expect(r.page.getByText('Jaipur tumhe dekh sakta hai')).toBeVisible()
  const inbox = () => sockets.find((ws) => ws.url().includes('/api/inbox') && !ws.isClosed())
  await expect.poll(() => inbox() !== undefined).toBe(true)
  return { ...r, keys, inbox: inbox()! }
}

const sheetOf = (page: Page) => page.getByRole('dialog', { name: 'Apni pehchaan banao' })
const switchOf = (page: Page) => sheetOf(page).getByRole('checkbox', { name: /Naye messages pe batao/ })

async function openSheet(page: Page) {
  await page.getByRole('button', { name: 'Profile', exact: true }).click()
  await expect(sheetOf(page)).toBeVisible()
}

/** Flips the push switch and waits for it to settle (it acts at once, not with Save). */
async function flip(page: Page, on: boolean) {
  const box = switchOf(page)
  await expect(box).toBeEnabled()
  await box.click()
  if (on) await expect(box).toBeChecked()
  else await expect(box).not.toBeChecked()
  await expect(box).toBeEnabled()
}

/** How many inbox sockets the Worker's InboxDO holds open for `userId` (`/api/dev/inbox`, DEV_AUTH only). */
async function inboxSockets(userId: string): Promise<number> {
  const res = await fetch('http://127.0.0.1:8787/api/dev/inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { sockets: number }).sockets
}

/**
 * Shuts the app on `who`'s page (the tab is gone): its inbox socket closes. Playwright may not report that close
 * for a page it is closing, so this waits until the Worker itself holds no inbox socket for them.
 */
async function shut(who: { page: Page; id: string; inbox: WebSocket }) {
  const closed = who.inbox.isClosed()
    ? null
    : who.inbox.waitForEvent('close', { timeout: 5000 }).catch(() => null)
  await who.page.close()
  await closed
  await expect.poll(() => inboxSockets(who.id)).toBe(0)
}

test('opted in from the profile: no push while the inbox is open; with it shut, a push that names nobody', async ({
  browser,
}) => {
  const meera = await subscriber(browser, 'Meera')
  await openSheet(meera.page)
  await expect(sheetOf(meera.page)).toContainText('na kisi ka naam, na koi baat')
  await flip(meera.page, true)
  // the service worker is the site's own static file, and the Worker holds this device, in Hinglish
  const sw = await meera.page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)
  expect(sw).toBe('http://127.0.0.1:5173/sw.js')
  expect(pushRows(meera.id)).toEqual([{ endpoint: service.endpoint(meera.name), lang: 'hi' }])
  await sheetOf(meera.page).getByRole('button', { name: 'Baad mein' }).click()

  // Kavya asks while Meera's app is open: the inbox tells the page, and nothing is pushed
  const kavya = await resident(browser, 'Kavya')
  await verify(kavya.page)
  await ask(kavya, meera)
  await expect(meera.page.getByRole('button', { name: /Mulaqaatein/ }).locator('.conn-badge')).toBeVisible()
  expect(service.got(meera.name)).toEqual([])

  // Meera's app is shut; Ravi asks: one push, and all it says is "a request", in her language
  await shut(meera)
  const ravi = await resident(browser, 'Ravi')
  await verify(ravi.page)
  await ask(ravi, meera)
  await expect.poll(() => service.got(meera.name).length).toBe(1)
  const [push] = service.got(meera.name)
  expect(push!.headers['content-encoding']).toBe('aes128gcm')
  expect(push!.headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/)
  const plain = await openPush(push!.body, meera.keys as PushKeys)
  expect(JSON.parse(plain)).toEqual({ t: 'request', lang: 'hi' })
  for (const leak of [ravi.name, 'Ravi', 'pencil', ravi.id]) expect(plain).not.toContain(leak)
})

test('switched off, or signed out: the device is off the Worker and unsubscribed', async ({ browser }) => {
  const asha = await subscriber(browser, 'Asha')
  await openSheet(asha.page)
  await flip(asha.page, true)
  expect(pushRows(asha.id)).toHaveLength(1)
  await flip(asha.page, false)
  expect(pushRows(asha.id)).toEqual([])
  expect(await asha.page.evaluate(() => window.__fakePush.unsubscribed)).toBe(true)

  // on again, then "Logout karo": signing out takes it off too
  await flip(asha.page, true)
  expect(pushRows(asha.id)).toHaveLength(1)
  await asha.page.evaluate(() => {
    window.__fakePush.unsubscribed = false
  })
  await sheetOf(asha.page).getByRole('button', { name: 'Logout karo' }).click()
  await expect(asha.page.getByRole('button', { name: 'Dikhna hai? Login karo' })).toBeVisible()
  await expect.poll(() => pushRows(asha.id)).toEqual([])
  expect(await asha.page.evaluate(() => window.__fakePush.unsubscribed)).toBe(true)
})

test('a tapped notification opens the site at ?inbox=1: the inbox is open once in', async ({ browser }) => {
  const r = await resident(browser, 'Nisha')
  await r.page.goto('/?inbox=1&gg-test=1')
  await r.page.getByRole('button', { name: 'Padharo!' }).click()
  await expect(r.page.getByRole('dialog', { name: 'Aapki mulaqaatein' })).toBeVisible()
  expect(new URL(r.page.url()).searchParams.has('inbox')).toBe(false)
})

test('inside Instagram the sheet says why there are no notifications, instead of a switch', async ({
  browser,
}) => {
  const r = await resident(browser, 'Insta', {
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 Instagram 350.0.0.0',
  })
  await openSheet(r.page)
  await expect(sheetOf(r.page)).toContainText(
    'Instagram ke andar wale browser mein notifications nahi aa sakte',
  )
  await expect(switchOf(r.page)).toHaveCount(0)
})

declare global {
  interface Window {
    __fakePush: { unsubscribed: boolean }
  }
}
