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
async function busiest(page: Page) {
  await page.goto('/?gg-test=1&gg-festival=gangaur')
  await page.getByRole('button', { name: 'Padharo!' }).click()
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

/** The chips and switches every visitor has; the place chip is the map's button. */
function common(page: Page, place = 'Gulabi Shahar'): Record<string, Locator> {
  const toggles = page.getByRole('group', { name: 'Settings' })
  return {
    place: page.getByRole('button', { name: `Naksha · ${place}`, exact: true }),
    weather: page.locator('.hud-top .hud-chip').nth(1),
    stamps: page.getByTitle('Jaipur Darshan stamps'),
    lang: toggles.getByRole('button', { name: 'English: bhasha badlo' }),
    sound: toggles.getByRole('button', { name: 'Awaaz chalu ya band karo' }),
    bandar: toggles.getByRole('button', { name: 'Bandar band karo' }),
    banner: page.getByText('Gangaur ki shubhkamnayein!'),
    procession: page.getByText('Gangaur ki sawari Tripolia se nikal rahi hai'),
    line: page.locator('.city-line'),
  }
}

test('on a small phone the HUD keeps to the top, with every chip whole and in reach', async ({ page }) => {
  // the busiest HUD a guest has: a festival with a procession, the sign-in nudge, the city line
  await busiest(page)
  const items: Record<string, Locator> = {
    ...common(page),
    ghost: page.getByText('Abhi koi tumhe dekh nahi sakta', { exact: true }),
    signIn: page.getByRole('button', { name: 'Dikhna hai? Login karo' }),
  }
  await laidOut(items)
  await expect(items.weather!).toContainText('AQI 162')
})

for (const [id, place] of [
  ['malviya-nagar', 'Malviya Nagar–WTP'],
  ['mi-road', 'MI Road–Raja Park'],
] as const)
  test(`the place chip (the map's button) fits with the longest district names: ${place}`, async ({
    page,
  }) => {
    // No festival: with Gangaur's two lines on top, a long name already pushed the news past the top share before
    // the chip became a button (287 px of 259 with the plain chip; see the T1 report).
    await page.addInitScript((d) => localStorage.setItem('gg-district', d), id)
    await page.goto('/?gg-test=1')
    await page.getByRole('button', { name: 'Padharo!' }).click()
    await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
    await page.evaluate(() =>
      window.__gg.setSnapshot({
        stale: false,
        tempC: 31,
        aqi: 162,
        aqiBand: 'unhealthy',
        condition: 'clear',
      }),
    )
    const { place: chip, weather, stamps, lang, sound, line } = common(page, place)
    await laidOut({
      place: chip!,
      weather: weather!,
      stamps: stamps!,
      lang: lang!,
      sound: sound!,
      line: line!,
      ghost: page.getByText('Abhi koi tumhe dekh nahi sakta', { exact: true }),
      signIn: page.getByRole('button', { name: 'Dikhna hai? Login karo' }),
    })
    if (process.env.GG_HUD_LONG_SHOT && id === 'malviya-nagar')
      await page.screenshot({ path: process.env.GG_HUD_LONG_SHOT })
  })

test('signed in on a small phone, the identity row fits too: visibility, profile, invite, connections and its badge', async ({
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
  await busiest(page)
  const conn = page.locator('.conn-button')
  const items: Record<string, Locator> = {
    ...common(page),
    visibility: page.getByText('Jaipur tumhe dekh sakta hai', { exact: true }),
    profile: page.getByRole('button', { name: 'Profile', exact: true }),
    invite: page.getByRole('button', { name: 'Invite', exact: true }),
    connections: conn,
    badge: conn.locator('.conn-badge'),
  }
  await expect(items.badge!).toHaveText('1')
  await laidOut(items, [['connections', 'badge']])
  if (process.env.GG_HUD_SHOT) await page.screenshot({ path: process.env.GG_HUD_SHOT })
})

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
