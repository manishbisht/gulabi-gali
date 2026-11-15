import { expect, test, type Locator, type Page } from '@playwright/test'
import { closePeople, hopTo, resident } from './support/people'

/** A small phone, held upright. */
const PHONE = { width: 360, height: 740 }
test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

/** The most of the screen's height the HUD's top block may take, so the street stays playable. */
const TOP_SHARE = 0.35
const API = 'http://127.0.0.1:8787'

test.afterEach(closePeople)

/** The festival with a procession, the city line and the weather, all at once: the busiest the news gets. */
async function busiest(page: Page, district?: string, lang?: 'hi' | 'en', festival = 'gangaur') {
  if (district) await page.addInitScript((d) => localStorage.setItem('gg-district', d), district)
  if (lang) await page.addInitScript((l) => localStorage.setItem('gg-lang', l), lang)
  // The city line's text sets how the HUD wraps. A live /api/city reply (the local Worker asks Open-Meteo, up
  // to 8 s) could land after the patch below and swap in today's real weather, so the reply is fixed too.
  const now = new Date()
  const at = (h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).toISOString()
  await page.route('**/api/city', (route) =>
    route.fulfill({
      json: {
        fetchedAt: now.toISOString(),
        tempC: 31,
        condition: 'clear',
        aqi: 162,
        aqiBand: 'unhealthy',
        sunrise: at(6),
        sunset: at(18),
        festival: null,
        stale: false,
      },
    }),
  )
  await page.goto(`/?gg-test=1&gg-festival=${festival}`)
  await page.getByRole('button', { name: lang === 'en' ? 'Come in' : 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  await page.evaluate(() =>
    window.__gg.setSnapshot({ stale: false, tempC: 31, aqi: 162, aqiBand: 'unhealthy', condition: 'clear' }),
  )
}

/**
 * Every item whole, on the screen and above `TOP_SHARE` of its height; none on another (but `inside`, a pair
 * where one is part of the other, like a badge on its button); the info chips one line each; the switches
 * thumb-sized.
 */
async function laidOut(items: Record<string, Locator>, inside: [string, string][] = []) {
  for (const item of Object.values(items)) await expect(item).toBeVisible()
  const boxes = Object.fromEntries(
    await Promise.all(Object.entries(items).map(async ([k, l]) => [k, (await l.boundingBox())!] as const)),
  )
  for (const [k, b] of Object.entries(boxes)) {
    // whole, on the screen, and above the street
    expect.soft(b.x, `${k} left`).toBeGreaterThanOrEqual(0)
    expect.soft(b.x + b.width, `${k} right`).toBeLessThanOrEqual(PHONE.width)
    expect.soft(b.y + b.height, `${k} bottom`).toBeLessThanOrEqual(PHONE.height * TOP_SHARE)
  }
  // nothing sits on anything else
  const keys = Object.keys(boxes)
  const nested = (a: string, b: string) =>
    inside.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      if (nested(keys[i]!, keys[j]!)) continue
      const a = boxes[keys[i]!]!
      const b = boxes[keys[j]!]!
      const apart =
        a.x + a.width <= b.x + 0.5 ||
        b.x + b.width <= a.x + 0.5 ||
        a.y + a.height <= b.y + 0.5 ||
        b.y + b.height <= a.y + 0.5
      expect.soft(apart, `${keys[i]} overlaps ${keys[j]}`).toBe(true)
    }
  // one line each, not squeezed into a column of words
  for (const k of ['place', 'weather', 'stamps'])
    expect.soft(boxes[k]!.height, `${k} height`).toBeLessThanOrEqual(40)
  // thumb-sized switches
  for (const k of ['lang', 'sound', 'bandar'].filter((k) => k in boxes)) {
    expect.soft(boxes[k]!.width, `${k} width`).toBeGreaterThanOrEqual(44)
    expect.soft(boxes[k]!.height, `${k} height`).toBeGreaterThanOrEqual(44)
  }
}

type L = 'hi' | 'en'

/** The words the busiest HUD's items are found by, in each language. */
const WORDS = {
  hi: {
    map: 'Naksha',
    ghost: 'Abhi koi tumhe dekh nahi sakta',
    signIn: 'Dikhna hai? Login karo',
    sees: 'Jaipur tumhe dekh sakta hai',
  },
  en: {
    map: 'Map',
    ghost: 'Nobody can see you yet',
    signIn: 'Want to be seen? Sign in',
    sees: 'Jaipur can see you',
  },
} as const

/** The chips and switches every visitor has; the place chip is the map's button, named by the full name. */
function common(page: Page, place = 'Gulabi Shahar', lang: L = 'hi'): Record<string, Locator> {
  const toggles = page.locator('.hud-toggles')
  return {
    place: page.getByRole('button', { name: `${WORDS[lang].map} · ${place}`, exact: true }),
    weather: page.locator('.hud-top .hud-chip').nth(1),
    stamps: page.locator('.stamp-count'),
    lang: toggles.locator('.lang-toggle'),
    sound: toggles.locator('.sound-toggle'),
    // the monkey's switch is the Walled City's alone
    ...(place === 'Gulabi Shahar' || place === 'Pink City'
      ? { bandar: toggles.locator('.bandar-toggle') }
      : {}),
    banner: page.locator('.festival-banner'),
    procession: page.locator('.procession-line'),
    line: page.locator('.city-line'),
    // the card's own box, not only the lines in it
    news: page.locator('.hud-news'),
  }
}

/** The festival card holds its lines. */
const NEWS: [string, string][] = [
  ['news', 'banner'],
  ['news', 'procession'],
  ['news', 'line'],
]

test('on a small phone the HUD keeps to the top, with every chip whole and in reach', async ({ page }) => {
  // the busiest HUD a guest has: a festival with a procession, the sign-in nudge, the city line
  await busiest(page)
  const items: Record<string, Locator> = {
    ...common(page),
    ghost: page.getByText(WORDS.hi.ghost, { exact: true }),
    signIn: page.getByRole('button', { name: WORDS.hi.signIn }),
  }
  await laidOut(items, NEWS)
  await expect(items.weather!).toContainText('AQI 162')
})

/** Every district, with the full name its map button is labelled by, in each language. */
const DISTRICTS = [
  ['walled-city', 'Gulabi Shahar', 'Pink City'],
  ['mi-road', 'MI Road–Raja Park', 'MI Road & Raja Park'],
  ['university', 'University–JKK', 'University & JKK'],
  ['malviya-nagar', 'Malviya Nagar–WTP', 'Malviya Nagar & WTP'],
] as const
const LANGS: L[] = ['hi', 'en']

/** A picture of the busiest HUD, when GG_HUD_SHOTS names a directory. */
const shot = (page: Page, name: string) =>
  process.env.GG_HUD_SHOTS ? page.screenshot({ path: `${process.env.GG_HUD_SHOTS}/${name}.png` }) : undefined

for (const lang of LANGS)
  for (const [id, hi, en] of DISTRICTS)
    // Gangaur everywhere; a Teej day too, in the district with the longest name
    for (const festival of id === 'malviya-nagar' ? ['gangaur', 'teej'] : ['gangaur']) {
      const place = lang === 'en' ? en : hi
      test(`a guest's busiest HUD fits in ${place} (${lang}, ${festival}): festival, procession, city line, sign-in nudge`, async ({
        page,
      }) => {
        await busiest(page, id, lang, festival)
        await laidOut(
          {
            ...common(page, place, lang),
            ghost: page.getByText(WORDS[lang].ghost, { exact: true }),
            signIn: page.getByRole('button', { name: WORDS[lang].signIn }),
          },
          NEWS,
        )
        await shot(page, `guest-${lang}-${id}-${festival}`)
      })

      test(`signed in on a small phone, the identity row fits too in ${place} (${lang}, ${festival}): visibility, profile, invite, connections and its badge`, async ({
        browser,
      }) => {
        const phone = { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        const asha = await resident(browser, 'Asha', phone)
        // someone verified asks to meet her, so Connections carries a badge
        const ravi = await resident(browser, 'Ravi')
        expect(
          (await ravi.page.request.post(`${API}/api/dev/verify`, { data: { userId: ravi.id } })).status(),
        ).toBe(200)
        const token = await ravi.page.evaluate(() => sessionStorage.getItem('gg-dev-token')!)
        const asked = await ravi.page.request.post(`${API}/api/requests`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { to: asha.id, reason: 'Mujhe bhi chai aur kitaabein pasand hain' },
        })
        expect(asked.status()).toBe(201)

        const { page } = asha
        await busiest(page, id, lang, festival)
        const conn = page.locator('.conn-button')
        const items: Record<string, Locator> = {
          ...common(page, place, lang),
          visibility: page.getByText(WORDS[lang].sees, { exact: true }),
          profile: page.locator('.hud-identity .profile-button:not(.invite-button):not(.conn-button)'),
          invite: page.locator('.invite-button'),
          connections: conn,
          badge: conn.locator('.conn-badge'),
        }
        await expect(items.badge!).toHaveText('1')
        await laidOut(items, [['connections', 'badge'], ...NEWS])
        await shot(page, `signed-${lang}-${id}-${festival}`)
      })
    }

test('the HUD switches say what they do, and show their state only through aria-pressed', async ({
  page,
}) => {
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  const bandar = page.getByRole('button', { name: 'Bandar band karo' })
  await expect(bandar).toHaveAttribute('aria-pressed', 'false')
  await bandar.focus()
  await page.keyboard.press('Enter')
  // still the same switch, now pressed: the monkey is off
  await expect(bandar).toHaveAttribute('aria-pressed', 'true')
  // pressed, it shows its off edge; with the keyboard on it, the focus ring wins over that dashed edge
  await expect(bandar).toHaveCSS('outline-width', '3px')
  await expect(bandar).toHaveCSS('outline-style', 'solid')
  expect(await page.evaluate(() => localStorage.getItem('gg-no-bandar'))).toBe('1')
  await page.keyboard.press('Enter')
  await expect(bandar).toHaveAttribute('aria-pressed', 'false')
})

/** Each item whole on the screen, and none on another. */
async function sideBySide(items: Record<string, Locator>) {
  // A button appears a frame after the teleport that brings it into reach: measuring before it is there read
  // a null box (the one flake of a full run). Wait for each, then measure.
  for (const item of Object.values(items)) await expect(item).toBeVisible()
  const boxes = Object.entries(
    Object.fromEntries(
      await Promise.all(Object.entries(items).map(async ([k, l]) => [k, (await l.boundingBox())!] as const)),
    ),
  )
  for (const [k, b] of boxes) {
    expect.soft(b.x, `${k} left`).toBeGreaterThanOrEqual(0)
    expect.soft(b.x + b.width, `${k} right`).toBeLessThanOrEqual(PHONE.width)
    expect.soft(b.y + b.height, `${k} bottom`).toBeLessThanOrEqual(PHONE.height)
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [ka, a] = boxes[i]!
      const [kb, b] = boxes[j]!
      const apart =
        a.x + a.width <= b.x + 0.5 ||
        b.x + b.width <= a.x + 0.5 ||
        a.y + a.height <= b.y + 0.5 ||
        b.y + b.height <= a.y + 0.5
      expect.soft(apart, `${ka} overlaps ${kb}`).toBe(true)
    }
}

test('on a small phone with a dog in tow, the bottom row fits: on foot by an auto, and at its wheel', async ({
  page,
}) => {
  // the city offline, as in city.spec.ts: a live district would pull a teleported player back
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  // the street dog by the start (see animals.spec.ts) comes along
  await page.evaluate(() => window.__gg.freezeAnimals(true))
  const dog = await page.evaluate(() => window.__gg.animals().find((a) => a.id === 'walled-city-dog-0')!)
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 1.6), dog)
  await page.getByRole('button', { name: 'Saath chalo' }).click()
  await expect
    .poll(() =>
      page.evaluate(() => window.__gg.animals().find((a) => a.id === 'walled-city-dog-0')!.following),
    )
    .toBe(true)

  // on foot beside the walled city's auto: the joystick, "Auto chalao" and "Ghar jao"
  await page.evaluate(() => window.__gg.teleport(24, -2.5))
  const joystick = page.locator('.joystick')
  const mount = page.getByRole('button', { name: 'Auto chalao' })
  const home = page.getByRole('button', { name: 'Ghar jao' })
  await sideBySide({ joystick, mount, home })
  await page.screenshot({ path: '../.superpowers/sdd/2026-11-14-phase-4-extras/launch-b-onfoot-360.png' })

  // at the wheel: the joystick, the horn and the way out ("Ghar jao" waits until the player is out again)
  await mount.tap()
  const horn = page.getByRole('button', { name: 'Horn bajao' })
  const exit = page.getByRole('button', { name: 'Utro' })
  await expect(exit).toBeVisible()
  await expect(home).toBeHidden()
  await sideBySide({ joystick, horn, exit })
  await page.waitForTimeout(600) // the camera settles behind the auto, for the picture
  await page.screenshot({ path: '../.superpowers/sdd/2026-11-14-phase-4-extras/launch-b-driving-360.png' })
})

/** The Walled City's tapri by Johari Bazaar, at (-5.6, 36), its counter facing east. */
const TAPRI = { x: -5.6, z: 36 }

test('seated at a tapri on a small phone, the bench panel and the joystick fit side by side, with no street button on them', async ({
  browser,
}) => {
  // Seated and "Auto chalao" together cannot happen: benches.test.ts holds every seat out of an auto's
  // reach. So the bottom row seated is the panel and the joystick, and the street's buttons are gone.
  const phone = { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  const asha = await resident(browser, 'Asha', phone)
  const { page } = asha
  await hopTo(page, TAPRI.x + 2.2, TAPRI.z + 0.5)
  await page.getByRole('button', { name: 'Baitho' }).click()
  const panel = page.getByRole('region', { name: 'Tapri pe' })
  await expect(panel).toBeVisible()
  // the card slides up for 220 ms: measure where it comes to rest, not where it starts
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  await sideBySide({ panel, joystick: page.locator('.joystick') })
  await expect(page.locator('.hud-actions button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Auto chalao' })).toHaveCount(0)
})

/** The most of the screen's height a card at the bottom may take, so the street above stays in view. */
const CARD_SHARE = 0.4

test('a landmark card on a small phone: "Bulao" sits on the stamp row, and the card stays beside the joystick', async ({
  page,
}) => {
  // in by a link to Albert Hall (offline, as in city.spec.ts), which stands you in its ring
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.goto('/?gg-test=1&at=mi-road:albert-hall')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  const card = page.getByRole('region', { name: 'Albert Hall' })
  await expect(card).toBeVisible()
  await card.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const stamp = card.getByRole('button', { name: 'Stamp lo' })
  const bulao = card.getByRole('button', { name: 'Bulao: Albert Hall ka link bhejo' })
  await sideBySide({ card, joystick: page.locator('.joystick') })
  const [c, s, b] = [(await card.boundingBox())!, (await stamp.boundingBox())!, (await bulao.boundingBox())!]
  expect(c.height, 'card height').toBeLessThanOrEqual(PHONE.height * CARD_SHARE)
  // one row of actions: Bulao beside the stamp button, not wrapped under it, and thumb-sized
  expect(Math.abs(b.y + b.height / 2 - (s.y + s.height / 2)), 'Bulao on the stamp row').toBeLessThan(4)
  expect(b.x + b.width, 'Bulao inside the card').toBeLessThanOrEqual(c.x + c.width)
  expect(b.width).toBeGreaterThanOrEqual(44)
  expect(b.height).toBeGreaterThanOrEqual(44)
  if (process.env.GG_CARD_SHOT) await page.screenshot({ path: process.env.GG_CARD_SHOT })
})

test('seated at a tapri on a small phone, the panel head keeps its title, "Bulao" and Utho on one row', async ({
  browser,
}) => {
  const phone = { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  const { page } = await resident(browser, 'Bina', phone)
  await hopTo(page, TAPRI.x + 2.2, TAPRI.z + 0.5)
  await page.getByRole('button', { name: 'Baitho' }).click()
  const panel = page.getByRole('region', { name: 'Tapri pe' })
  await expect(panel).toBeVisible()
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const title = panel.getByRole('heading', { name: 'Tapri pe' })
  const bulao = panel.getByRole('button', { name: /^Bulao: Chai ki tapri \d+ ka link bhejo$/ })
  const utho = panel.getByRole('button', { name: 'Utho' })
  await sideBySide({ panel, joystick: page.locator('.joystick') })
  await sideBySide({ title, bulao, utho })
  const boxes = await Promise.all([title, bulao, utho].map(async (l) => (await l.boundingBox())!))
  const mid = (b: { y: number; height: number }) => b.y + b.height / 2
  for (const b of boxes.slice(1)) expect(Math.abs(mid(b) - mid(boxes[0]!)), 'one row').toBeLessThan(6)
  for (const b of boxes.slice(1)) expect(b.height, 'thumb-sized').toBeGreaterThanOrEqual(44)
  if (process.env.GG_BENCH_SHOT) await page.screenshot({ path: process.env.GG_BENCH_SHOT })
})
