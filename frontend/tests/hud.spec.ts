import { expect, test, type Locator } from '@playwright/test'

/** A small phone, held upright. */
const PHONE = { width: 360, height: 740 }
test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

/** The most of the screen's height the HUD's top block may take, so the street stays playable. */
const TOP_SHARE = 0.35

test('on a small phone the HUD keeps to the top, with every chip whole and in reach', async ({ page }) => {
  // the busiest HUD there is: a festival with a procession, a guest with the sign-in nudge, the city line
  await page.goto('/?gg-test=1&gg-festival=gangaur')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  await page.evaluate(() =>
    window.__gg.setSnapshot({ stale: false, tempC: 31, aqi: 162, aqiBand: 'unhealthy', condition: 'clear' }),
  )

  const toggles = page.getByRole('group', { name: 'Settings' })
  const lang = toggles.getByRole('button', { name: 'Bhasha badlo: English' })
  const sound = toggles.getByRole('button', { name: 'Awaaz chalu ya band karo' })
  const bandar = toggles.getByRole('button', { name: 'Bandar band karo' })
  const items: Record<string, Locator> = {
    place: page.locator('.hud-top .hud-chip').nth(0),
    weather: page.locator('.hud-top .hud-chip').nth(1),
    stamps: page.getByTitle('Jaipur Darshan stamps'),
    lang,
    sound,
    bandar,
    ghost: page.getByText('Abhi koi tumhe dekh nahi sakta', { exact: true }),
    signIn: page.getByRole('button', { name: 'Dikhna hai? Login karo' }),
    banner: page.getByText('Gangaur ki shubhkamnayein!'),
    procession: page.getByText('Gangaur ki sawari Tripolia se nikal rahi hai'),
    line: page.locator('.city-line'),
  }
  for (const item of Object.values(items)) await expect(item).toBeVisible()
  await expect(items.weather).toContainText('AQI 162')

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
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
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
