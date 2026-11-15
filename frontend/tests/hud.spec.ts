import { expect, test, type Locator, type Page } from '@playwright/test'
import { closePeople, resident } from './support/people'

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
  for (const k of ['lang', 'sound', 'bandar']) {
    expect.soft(boxes[k]!.width, `${k} width`).toBeGreaterThanOrEqual(44)
    expect.soft(boxes[k]!.height, `${k} height`).toBeGreaterThanOrEqual(44)
  }
}

/** The chips and switches every visitor has. */
function common(page: Page): Record<string, Locator> {
  const toggles = page.getByRole('group', { name: 'Settings' })
  return {
    place: page.locator('.hud-top .hud-chip').nth(0),
    weather: page.locator('.hud-top .hud-chip').nth(1),
    stamps: page.getByTitle('Jaipur Darshan stamps'),
    lang: toggles.getByRole('button', { name: 'Bhasha badlo: English' }),
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
  expect(await page.evaluate(() => localStorage.getItem('gg-no-bandar'))).toBe('1')
  await page.keyboard.press('Enter')
  await expect(bandar).toHaveAttribute('aria-pressed', 'false')
})
