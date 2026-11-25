import { expect, test, type Page } from '@playwright/test'

/** A small phone, held upright. */
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

/**
 * Opens the city offline (as in city.spec.ts: a live district would pull a teleported player back), in `district`
 * if given, on a fixed clear day whatever the weather. A run that takes pictures (`GG_PALACE_SHOTS`, a directory)
 * asks for the full picture, at midday.
 */
async function enterOffline(page: Page, district?: string) {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.route('**/api/city*', (route) =>
    route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        tempC: 24,
        condition: 'clear',
        aqi: 80,
        aqiBand: 'moderate',
        sunrise: '2026-11-15T01:15:00Z',
        sunset: '2026-11-15T12:10:00Z',
        festival: null,
        stale: false,
      },
    }),
  )
  if (district) await page.addInitScript((d) => localStorage.setItem('gg-district', d), district)
  const full = process.env.GG_PALACE_SHOTS ? '&gg-full=1' : ''
  await page.goto(`/?gg-test=1${full}`)
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  if (full) await page.evaluate(() => window.__gg.setNow('2026-11-15T06:30:00Z'))
}

const shot = (page: Page, name: string) =>
  process.env.GG_PALACE_SHOTS
    ? page.screenshot({ path: `${process.env.GG_PALACE_SHOTS}/${name}.png` })
    : undefined

const position = (page: Page) => page.evaluate(() => window.__gg.position())
/** Holds `key` down for `seconds` of game time (not wall-clock: a slow machine walks as far). */
async function hold(page: Page, key: string, seconds: number) {
  const t0 = await page.evaluate(() => window.__gg.gameTime())
  await page.keyboard.down(key)
  await expect
    .poll(() => page.evaluate(() => window.__gg.gameTime()), { timeout: 15_000 })
    .toBeGreaterThan(t0 + seconds)
  await page.keyboard.up(key)
}

test('Amer: the auto sets you down on the ghat facing Jal Mahal; its card and stamp there, and the water stops you', async ({
  page,
}) => {
  await enterOffline(page, 'amer')
  await expect(page.locator('.stamp-count')).toHaveText('0/14')
  // the auto waiting on the road by the lake
  await page.evaluate(() => window.__gg.teleport(-60, 45.4))
  await page.getByRole('button', { name: 'Le chalo', exact: true }).tap()
  const sheet = page.getByRole('region', { name: 'Le chalo · kahan jaana hai?' })
  await expect(sheet.getByRole('button')).toHaveText(['Amer ka Qila', 'Jal Mahal', 'Rehne do'])
  await sheet.getByRole('button', { name: 'Jal Mahal' }).tap()
  const card = page.locator('section.landmark-card[aria-label="Jal Mahal"]')
  await expect(card).toBeVisible({ timeout: 8000 })
  await expect(card).toContainText('Man Sagar')
  // out on the ghat, looking south across the water at the palace
  const p = await position(page)
  expect(p.x).toBeGreaterThan(-54)
  expect(p.x).toBeLessThan(-46)
  expect(p.z).toBeGreaterThan(58)
  expect(p.z).toBeLessThan(68.5)
  expect(Math.cos((await page.evaluate(() => window.__gg.view())).yaw)).toBeLessThan(-0.9)
  await shot(page, 'jal-mahal-ghat')
  await card.getByRole('button', { name: 'Stamp lo' }).tap()
  await expect(page.locator('.stamp-count')).toHaveText('1/14')

  // walking on toward the palace gets you to the ghat's end and no further
  await hold(page, 'w', 3)
  const end = await position(page)
  expect(end.z).toBeGreaterThan(p.z + 0.4)
  expect(end.z).toBeLessThan(68.5)

  await page.getByRole('button', { name: 'Naksha · Amer', exact: true }).tap()
  const map = page.getByRole('dialog', { name: 'Naksha · Amer' })
  await expect(map.locator('li button[data-id="jal-mahal"]')).toContainText('Jal Mahal')
})

test('Walled City: the City Palace gateway north of Jantar Mantar; its card and stamp at the gate, and the auto goes there', async ({
  page,
}) => {
  await enterOffline(page)
  await expect(page.locator('.stamp-count')).toHaveText('0/14')
  // the auto from Johari Bazaar's stand sets you down by the gateway, its card open
  await page.evaluate(() => window.__gg.teleport(-0.6, 30))
  await page.getByRole('button', { name: 'Le chalo', exact: true }).tap()
  const sheet = page.getByRole('region', { name: 'Le chalo · kahan jaana hai?' })
  // every stop fits on a small phone, the last one and "Rehne do" too (once the sheet has slid up)
  await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  for (const b of await sheet.getByRole('button').all()) {
    const box = (await b.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(740)
    expect(box.x + box.width).toBeLessThanOrEqual(360)
  }
  await sheet.getByRole('button', { name: 'City Palace' }).tap()
  const card = page.locator('section.landmark-card[aria-label="City Palace"]')
  await expect(card).toBeVisible({ timeout: 8000 })
  await expect(card).toContainText('Chandra Mahal')
  const p = await position(page)
  expect(p.z).toBeGreaterThan(-72) // outside the precinct wall, by the gate
  expect(p.z).toBeLessThan(-60)
  await shot(page, 'city-palace-gate')
  await card.getByRole('button', { name: 'Stamp lo' }).tap()
  await expect(page.locator('.stamp-count')).toHaveText('1/14')
})
