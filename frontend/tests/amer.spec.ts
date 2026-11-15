import { expect, test, type Page } from '@playwright/test'

/** A small phone, held upright. */
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

/**
 * Opens the city offline (as in city.spec.ts: a live district would pull a teleported player back), in `district`
 * if given. A run that takes pictures (`GG_AMER_SHOTS`, a directory) asks for the full picture, at midday.
 */
async function enterOffline(page: Page, district?: string) {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  // a fixed clear day, whatever the weather (see hud.spec.ts), round the midday the pictures are taken at
  await page.route('**/api/city', (route) =>
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
  const full = process.env.GG_AMER_SHOTS ? '&gg-full=1' : ''
  await page.goto(`/?gg-test=1${full}`)
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  if (full) await page.evaluate(() => window.__gg.setNow('2026-11-15T06:30:00Z'))
}

const shot = (page: Page, name: string) =>
  process.env.GG_AMER_SHOTS
    ? page.screenshot({ path: `${process.env.GG_AMER_SHOTS}/${name}.png` })
    : undefined

test('no metro goes to Amer: the bus does, from the metro station, and back again from its bus stand', async ({
  page,
}) => {
  await enterOffline(page)
  await page.evaluate(() => window.__gg.teleport(-7.2, 11)) // the Walled City's station
  await page.getByRole('button', { name: 'Metro', exact: true }).tap()
  const sheet = page.getByRole('region', { name: 'Kahan chalein?' })
  const bus = sheet.getByRole('button', { name: 'Amer Bus', exact: true })
  await expect(bus).toHaveAttribute('data-by', 'bus')
  await bus.tap()
  // the bus, not the metro coach
  const cab = page.getByRole('button', { name: 'Bus safar — chhodne ke liye tap karo' })
  await expect(cab).toBeFocused()
  await expect(page.locator('.bus-road')).toBeVisible()
  await shot(page, 'amer-bus')
  await expect.poll(() => page.evaluate(() => window.__gg.district())).toBe('amer')
  await cab.tap()
  await expect(cab).toHaveCount(0)

  // set down at Amer's bus stand: the same button says "Bus", and every stop from here is by bus
  const back = page.getByRole('button', { name: 'Bus', exact: true })
  await expect(back).toBeVisible()
  await expect(page.locator('.fade')).not.toHaveAttribute('data-on')
  await expect(page.getByRole('button', { name: 'Metro', exact: true })).toHaveCount(0)
  await back.tap()
  await expect(sheet.locator('.travel-stop[data-by="bus"]')).toHaveCount(4)
  if (process.env.GG_AMER_SHOTS) {
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    await shot(page, 'amer-sheet')
  }
  await sheet.getByRole('button', { name: 'Gulabi Shahar Bus', exact: true }).tap()
  await expect(page.getByRole('button', { name: 'Bus safar — chhodne ke liye tap karo' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__gg.district())).toBe('walled-city')
})

test('Amer: up the path to the fort gate its card opens and the stamp is the tenth; the map calls the stop a bus stand', async ({
  page,
}) => {
  await enterOffline(page, 'amer')
  expect(await page.evaluate(() => window.__gg.district())).toBe('amer')
  await expect(page.locator('.stamp-count')).toHaveText('0/10')
  // at the foot of the path, looking north up it to the gate, the lake and the fort on its hill to the left
  await page.evaluate(() => window.__gg.teleport(31.5, 22))
  await page.waitForTimeout(800)
  await shot(page, 'amer-approach')

  await page.evaluate(() => window.__gg.teleport(38, -30))
  const card = page.locator('section.landmark-card[aria-label="Amer ka Qila"]')
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Stamp lo' }).tap()
  await expect(page.locator('.stamp-count')).toHaveText('1/10')

  await page.getByRole('button', { name: 'Naksha · Amer', exact: true }).tap()
  const map = page.getByRole('dialog', { name: 'Naksha · Amer' })
  await expect(map.getByRole('button', { name: 'Bus stand', exact: true }).first()).toBeVisible()
})

test('Amer: the bastion on the rampart is a viewpoint over the lake at the fort', async ({ page }) => {
  await enterOffline(page, 'amer')
  const { stair } = (await page.evaluate(() => window.__gg.roof()))!
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), stair)
  await page.getByRole('button', { name: 'Chhat pe chalo' }).tap()
  await expect.poll(async () => (await page.evaluate(() => window.__gg.roof()))!.up).toBe(true)
  expect((await page.evaluate(() => window.__gg.roof()))!.y).toBeGreaterThan(8)
  await expect(page.locator('.fade')).not.toHaveAttribute('data-on')
  // turned north, across the lake to the fort
  const { yaw } = await page.evaluate(() => window.__gg.view())
  expect(Math.cos(yaw)).toBeGreaterThan(0.9)
  await page.waitForTimeout(800)
  await shot(page, 'amer-rampart')
  await page.getByRole('button', { name: 'Neeche chalo' }).tap()
  await expect.poll(async () => (await page.evaluate(() => window.__gg.roof()))!.up).toBe(false)
})
