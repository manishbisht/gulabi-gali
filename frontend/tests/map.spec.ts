import { expect, test, type Page } from '@playwright/test'

/** A small phone, held upright. */
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

/** Opens the city offline (as in city.spec.ts): a live district would pull a teleported player back. */
async function enterOffline(page: Page) {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
}

/** The metres the compass reads now. */
async function metres(page: Page): Promise<number> {
  const text = await page.locator('.compass').innerText()
  return Number(/· (\d+) m/.exec(text)![1])
}

/** How far the compass arrow is turned, in degrees (clockwise from straight up the screen). */
async function turn(page: Page): Promise<number> {
  const style = (await page.locator('.compass-arrow').getAttribute('style')) ?? ''
  return Number(/rotate\((-?\d+)deg\)/.exec(style)?.[1])
}

test('the map: open it, pick Hawa Mahal, follow the compass there, and it clears on arrival', async ({
  page,
}) => {
  await enterOffline(page)
  // the place chip is the map's button
  const naksha = page.getByRole('button', { name: 'Naksha · Gulabi Shahar', exact: true })
  await expect(naksha).toHaveAttribute('aria-haspopup', 'dialog')
  await naksha.tap()
  const map = page.getByRole('dialog', { name: 'Naksha · Gulabi Shahar' })
  await expect(map).toBeVisible()
  // every place is a button with a name, and you are on it
  await expect(map.getByRole('button', { name: 'Jantar Mantar', exact: true })).toBeVisible()
  await expect(map.getByRole('button', { name: 'Metro station', exact: true })).toBeVisible()
  await expect(map.locator('.map-you')).toHaveCount(1)
  // offline nobody else is on the street, so nobody is on the map
  await expect(map.locator('.map-person')).toHaveCount(0)
  if (process.env.GG_MAP_SHOT) await page.screenshot({ path: process.env.GG_MAP_SHOT })

  await map.getByRole('button', { name: 'Hawa Mahal', exact: true }).tap()
  await expect(map).toBeHidden()
  // from the start, halfway up Johari Bazaar, Hawa Mahal's face is about 62 m off
  const compass = page.getByRole('button', { name: /^Hawa Mahal · \d+ m/ })
  await expect(compass).toBeVisible()
  const start = await metres(page)
  expect(start).toBeGreaterThan(50)
  // the view looks north up the bazaar; Hawa Mahal is north-north-east of it: the arrow turns right by ~29°
  await expect.poll(() => turn(page)).toBeGreaterThan(20)
  expect(await turn(page)).toBeLessThan(40)
  if (process.env.GG_COMPASS_SHOT) await page.screenshot({ path: process.env.GG_COMPASS_SHOT })

  // walk there: up Johari Bazaar to the Chaupar, then east along the bazaar to stand before it
  for (const [x, z] of [
    [1.5, 24],
    [2, 9],
    [20, 2],
  ] as const) {
    await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), { x, z })
    await expect.poll(() => metres(page)).toBeLessThan(start)
  }
  await page.evaluate(() => window.__gg.teleport(36, -10)) // 4.5 m from its face
  await expect(compass).toBeHidden()
  await expect(page.locator('.compass')).toHaveCount(0)
})

test('M opens the map and Escape closes it; a tap on the compass clears it', async ({ page }) => {
  await enterOffline(page)
  await expect(page.getByRole('button', { name: 'Naksha · Gulabi Shahar', exact: true })).toBeVisible()
  await page.keyboard.press('m')
  const map = page.getByRole('dialog', { name: 'Naksha · Gulabi Shahar' })
  await expect(map).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(map).toBeHidden()

  await page.keyboard.press('m')
  // the list under the map: the metro, with how far it is
  await map.getByRole('button', { name: /^Metro station · \d+ m$/ }).tap()
  const compass = page.getByRole('button', { name: /^Metro station · \d+ m/ })
  await expect(compass).toBeVisible()
  await compass.tap()
  await expect(compass).toBeHidden()
})

test('every bench is a thumb-sized row in the list; in photo mode M leaves the map shut', async ({
  page,
}) => {
  await enterOffline(page)
  await page.getByRole('button', { name: 'Naksha · Gulabi Shahar', exact: true }).tap()
  const map = page.getByRole('dialog', { name: 'Naksha · Gulabi Shahar' })
  // the benches past the nearest few fold away; open the fold and pick one by its row
  await map.locator('details.map-more summary').tap()
  const row = map.locator('.map-more-list button[data-kind="bench"]').first()
  const box = (await row.boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(44)
  const name = /^(Bench \d+) · /.exec((await row.textContent())!)![1]!
  await row.tap()
  await expect(map).toBeHidden()
  await expect(page.getByRole('button', { name: new RegExp(`^${name} · \\d+ m`) })).toBeVisible()

  // photo mode has the screen: no map over it
  await page.locator('.photo-button').tap()
  await expect(page.locator('.hud')).toHaveCount(0)
  await page.keyboard.press('m')
  await expect(map).toHaveCount(0)
  await page.locator('.photo-exit').tap()
  await expect(page.locator('.hud')).toBeVisible()
  // the target outlives photo mode
  await expect(page.getByRole('button', { name: new RegExp(`^${name} · \\d+ m`) })).toBeVisible()
})
