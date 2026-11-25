import { expect, test, type Page } from '@playwright/test'

/*
 * Real phones: the site installs to the home screen (a manifest Chrome accepts, its icons, a service worker
 * registered on every visit), says one quiet thing inside Instagram's own browser, offers the home screen once on an
 * iPhone, and keeps the HUD and the sheets clear of a notch and a home bar.
 */

/** A small phone, held upright. */
const PHONE = { width: 360, height: 740 }
test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

const INSTAGRAM =
  'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 320.0.0.0.0 Android (33/13)'
const FACEBOOK =
  'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.0;]'

/** The welcome screen in `lang`, with a fixed count (the real one depends on who is on). */
async function welcome(page: Page, lang: 'hi' | 'en' = 'hi', path = '/?gg-test=1') {
  await page.addInitScript((l) => localStorage.setItem('gg-lang', l), lang)
  await page.route('**/api/count', (route) => route.fulfill({ json: { people: 0 } }))
  await page.goto(path)
}

/**
 * Into the Walled City, offline, under fixed weather and a fixed "Aaj ka Darshan" goal (a live reply, or the day's own
 * goal, could change how the HUD's head wraps).
 */
async function intoCity(page: Page, lang: 'hi' | 'en' = 'hi') {
  await page.route('**/api/city*', (route) =>
    route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        tempC: 31,
        condition: 'clear',
        aqi: 90,
        aqiBand: 'moderate',
        sunrise: new Date().toISOString(),
        sunset: new Date().toISOString(),
        festival: null,
        stale: false,
      },
    }),
  )
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await welcome(page, lang, '/?gg-test=1&gg-today=photo')
  await page.getByRole('button', { name: lang === 'en' ? 'Come in' : 'Padharo!' }).tap()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
}

/** A PNG's width and height, from its header. */
function pngSize(body: Buffer): { width: number; height: number } {
  expect(body.subarray(1, 4).toString('latin1')).toBe('PNG')
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) }
}

test('the web app manifest is linked, parses, and every icon it names is there at its size', async ({
  page,
  request,
}) => {
  await welcome(page)
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBe('/manifest.webmanifest')
  const res = await request.get(href!)
  expect(res.ok()).toBe(true)
  const manifest = await res.json()
  expect(manifest).toMatchObject({
    id: '/',
    name: 'Gulabi Gali',
    short_name: 'Gulabi Gali',
    lang: 'hi',
    start_url: '/?source=pwa',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#2a1d24',
    theme_color: '#2a1d24',
  })
  // the page's own theme colour is the manifest's
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', manifest.theme_color)
  // what Chrome needs to install: a 192 and a 512 PNG, and a maskable one for the launcher's shapes
  const icons = manifest.icons as { src: string; sizes: string; type: string; purpose: string }[]
  const pngs = icons.filter((i) => i.type === 'image/png')
  expect(pngs.map((i) => `${i.sizes} ${i.purpose}`).sort()).toEqual([
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ])
  for (const icon of icons) {
    const file = await request.get(icon.src)
    expect(file.ok(), icon.src).toBe(true)
    if (icon.type !== 'image/png') continue
    const [w, h] = icon.sizes.split('x').map(Number)
    expect(pngSize(await file.body()), icon.src).toEqual({ width: w, height: h })
  }
})

test('a launch from the home screen loses its ?source=pwa before anything reads the address', async ({
  page,
}) => {
  await welcome(page, 'hi', '/?source=pwa&gg-test=1')
  await expect(page.getByRole('button', { name: 'Padharo!' })).toBeVisible()
  const url = new URL(page.url())
  expect(url.searchParams.get('source')).toBeNull()
  expect(url.searchParams.get('gg-test')).toBe('1')
})

test('the service worker registers on a visit, and never stands between the page and its requests', async ({
  page,
  request,
}) => {
  // the e2e build registers it only when asked (?gg-sw=1): a worker in every spec would sit in front of their routes
  await welcome(page, 'hi', '/?gg-test=1&gg-sw=1')
  const script = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)
  expect(script).toBe(new URL('/sw.js', page.url()).href)
  // no fetch listener: the worker is never woken for a request (installing needs only the manifest)
  expect(await (await request.get('/sw.js')).text()).not.toMatch(/addEventListener\('fetch'/)
  // once it controls the page, the page's requests still reach the network: nothing is answered from a cache
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null))
    .toBe(script)
  const fetched = await page.evaluate(async () => {
    const files = ['/manifest.webmanifest', '/icon-192.png', `/sw.js?fresh=${Date.now()}`]
    return Promise.all(files.map(async (f) => (await fetch(f, { cache: 'no-store' })).status))
  })
  expect(fetched).toEqual([200, 200, 200])
  expect(await page.evaluate(() => caches.keys())).toEqual([])
  await expect(page.getByRole('button', { name: 'Padharo!' })).toBeVisible()
})

for (const [app, ua] of [
  ['Instagram', INSTAGRAM],
  ['Facebook', FACEBOOK],
] as const)
  test.describe(`inside ${app}'s own browser`, () => {
    test.use({ userAgent: ua })

    for (const lang of ['hi', 'en'] as const)
      test(`the welcome screen says, in two lines at most, that the browser does it all (${lang})`, async ({
        page,
      }) => {
        await welcome(page, lang)
        const note = page.getByRole('note')
        await expect(note).toBeVisible()
        await expect(note).toContainText(app)
        // the menu as an iPhone draws it and as Android does
        await expect(note).toContainText('⋯')
        await expect(note).toContainText('⋮')
        const box = (await note.boundingBox())!
        const lineHeight = await note.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
        expect(box.height).toBeLessThanOrEqual(2 * lineHeight + 1)
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width)
        // and still two lines with 24 px less room than the screen gives it: CI's Linux fonts draw a little wider
        const narrower = await note.evaluate((el) => {
          const p = el as HTMLElement
          const parent = getComputedStyle(p.parentElement!)
          const room =
            p.parentElement!.clientWidth - parseFloat(parent.paddingLeft) - parseFloat(parent.paddingRight)
          p.style.maxWidth = `${room - 24}px`
          const h = p.getBoundingClientRect().height
          p.style.maxWidth = ''
          return h
        })
        expect(narrower).toBeLessThanOrEqual(2 * lineHeight + 1)
        // nothing blocked, nothing pushed off a small phone
        await expect(
          page.getByRole('button', { name: lang === 'en' ? 'Come in' : 'Padharo!' }),
        ).toBeInViewport()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          PHONE.width,
        )
      })
  })

test('in a browser the welcome screen has no such note', async ({ page }) => {
  await welcome(page)
  await expect(page.getByRole('button', { name: 'Padharo!' })).toBeVisible()
  await expect(page.locator('.intro-inapp')).toHaveCount(0)
})

test('with a notch and a home bar, the HUD, the joystick and a sheet keep clear of them', async ({
  page,
}) => {
  // an iPhone's insets, upright: the notch's 47 px at the top, the home bar's 34 px at the foot
  const inset = { top: 47, bottom: 34 }
  await intoCity(page)
  const place = page.getByRole('button', { name: 'Naksha · Gulabi Shahar', exact: true })
  const toggles = page.locator('.hud-toggles')
  const joystick = page.locator('.joystick')
  await expect(joystick).toBeVisible()
  const top = async () => Math.min((await place.boundingBox())!.y, (await toggles.boundingBox())!.y)
  const foot = async () => {
    const b = (await joystick.boundingBox())!
    return b.y + b.height
  }
  const head = async () => {
    const b = (await page.locator('.hud-head').boundingBox())!
    return b.y + b.height
  }
  // without insets the HUD sits 10 px from the edges (so the check below is not met by accident)
  expect(await top()).toBeLessThan(inset.top)
  expect(await foot()).toBeGreaterThan(PHONE.height - inset.bottom)
  const headBefore = await head()

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { ...inset, left: 0, right: 0 } })
  await expect.poll(top).toBeGreaterThanOrEqual(inset.top)
  expect(await foot()).toBeLessThanOrEqual(PHONE.height - inset.bottom)
  // the head moves down by the notch and no more: nothing in it wraps or grows (hud.spec.ts checks its fit)
  expect(Math.abs((await head()) - headBefore - inset.top)).toBeLessThanOrEqual(1)

  // a sheet over the street (the map) stays between the notch and the home bar
  await place.tap()
  const sheet = page.locator('.auth-sheet')
  await expect(sheet).toBeVisible()
  const s = (await sheet.boundingBox())!
  expect(s.y).toBeGreaterThanOrEqual(inset.top)
  expect(s.y + s.height).toBeLessThanOrEqual(PHONE.height - inset.bottom)
})

test.describe('on an iPhone in Safari', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  })

  for (const lang of ['hi', 'en'] as const)
    test(`after two minutes on the street, one line says where "Add to Home Screen" is, clear of the HUD (${lang})`, async ({
      page,
    }) => {
      // the page's clock is ours from the start; it runs on as usual until it is moved on below
      await page.clock.install()
      await intoCity(page, lang)
      const hint = page.locator('.install-hint')
      await expect(page.locator('.joystick')).toBeVisible()
      await expect(hint).toHaveCount(0)
      // two minutes on the street, a second at a time (the hint counts whole seconds on screen)
      for (let s = 0; s < 125 && !(await hint.count()); s++) await page.clock.fastForward(1000)
      await expect(hint).toBeVisible()
      await expect(hint).toContainText('Add to Home Screen')
      await expect(hint).toContainText('⋯')
      // only × to press: Safari has no install dialog to open
      await expect(hint.getByRole('button')).toHaveCount(1)

      // under the HUD's head, over the joystick, inside the screen: each with at least 10 px to spare
      const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!
      const h = (await hint.boundingBox())!
      const head = await box('.hud-head')
      const stick = await box('.joystick')
      expect(h.x).toBeGreaterThanOrEqual(10)
      expect(h.x + h.width).toBeLessThanOrEqual(PHONE.width - 10)
      expect(h.y).toBeGreaterThanOrEqual(head.y + head.height)
      expect(h.y + h.height + 10).toBeLessThanOrEqual(stick.y)
      // and with 10 px less room (CI's wider fonts) it still clears the joystick
      const taller = await hint.evaluate((el) => {
        const d = el as HTMLElement
        d.style.maxWidth = `${d.getBoundingClientRect().width - 10}px`
        const r = d.getBoundingClientRect()
        d.style.maxWidth = ''
        return r.y + r.height
      })
      expect(taller + 10).toBeLessThanOrEqual(stick.y)
    })
})
