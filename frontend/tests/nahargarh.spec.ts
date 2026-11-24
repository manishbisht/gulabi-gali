import { expect, test, type Page } from '@playwright/test'

/** A small phone, held upright. */
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

/** The fixed day's sun (see `enterOffline`): midday for the pictures, and a little before sunset for the view. */
const MIDDAY = '2026-11-15T06:30:00Z'
const GOLDEN = '2026-11-15T11:55:00Z'

/**
 * Opens the city offline (as in city.spec.ts: a live district would pull a teleported player back), in `district`
 * if given. A run that takes pictures (`GG_NAHARGARH_SHOTS`, a directory) asks for the full picture, at midday.
 */
async function enterOffline(page: Page, district?: string) {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  // a fixed clear day, whatever the weather (see hud.spec.ts)
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
  const full = process.env.GG_NAHARGARH_SHOTS ? '&gg-full=1' : ''
  await page.goto(`/?gg-test=1${full}`)
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  if (full) await page.evaluate((at) => window.__gg.setNow(at), MIDDAY)
}

const shot = (page: Page, name: string) =>
  process.env.GG_NAHARGARH_SHOTS
    ? page.screenshot({ path: `${process.env.GG_NAHARGARH_SHOTS}/${name}.png` })
    : undefined

test('no metro goes up to Nahargarh: the bus does, from the metro station, and back down from its bus stand', async ({
  page,
}) => {
  await enterOffline(page)
  await page.evaluate(() => window.__gg.teleport(-7.2, 11)) // the Walled City's station
  await page.getByRole('button', { name: 'Metro', exact: true }).tap()
  const sheet = page.getByRole('region', { name: 'Kahan chalein?' })
  const bus = sheet.getByRole('button', { name: 'Nahargarh Bus', exact: true })
  await expect(bus).toHaveAttribute('data-by', 'bus')
  // every stop fits in the sheet on a small phone, the last one and the close button too
  for (const b of await sheet.getByRole('button').all()) {
    await b.scrollIntoViewIfNeeded()
    const box = (await b.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(740)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  await bus.tap()
  const cab = page.getByRole('button', { name: 'Bus safar — chhodne ke liye tap karo' })
  await expect(cab).toBeFocused()
  await expect(page.locator('.bus-road')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__gg.district())).toBe('nahargarh')
  await cab.tap()
  await expect(cab).toHaveCount(0)

  // set down at the bus stand on the ridge road: the button says "Bus", and every stop from here is by bus
  const back = page.getByRole('button', { name: 'Bus', exact: true })
  await expect(back).toBeVisible()
  await expect(page.locator('.fade')).not.toHaveAttribute('data-on')
  await expect(page.getByRole('button', { name: 'Metro', exact: true })).toHaveCount(0)
  await back.tap()
  await expect(sheet.locator('.travel-stop[data-by="bus"]')).toHaveCount(5)
  await sheet.getByRole('button', { name: 'Amer Bus', exact: true }).tap()
  await expect(page.getByRole('button', { name: 'Bus safar — chhodne ke liye tap karo' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__gg.district())).toBe('amer')
})

test('Nahargarh: at the fort gateway its card opens and the stamp is one of thirteen; the map calls the stop a bus stand', async ({
  page,
}) => {
  await enterOffline(page, 'nahargarh')
  expect(await page.evaluate(() => window.__gg.district())).toBe('nahargarh')
  await expect(page.locator('.stamp-count')).toHaveText('0/13')
  await expect(page.locator('.hud-top')).toContainText('Nahargarh')
  await page.waitForTimeout(800)
  await shot(page, 'nahargarh-spawn')

  await page.evaluate(() => window.__gg.teleport(12, -36))
  const card = page.locator('section.landmark-card[aria-label="Nahargarh ka Qila"]')
  await expect(card).toBeVisible()
  await shot(page, 'nahargarh-gate')
  await card.getByRole('button', { name: 'Stamp lo' }).tap()
  await expect(page.locator('.stamp-count')).toHaveText('1/13')

  await page.getByRole('button', { name: 'Naksha · Nahargarh', exact: true }).tap()
  const map = page.getByRole('dialog', { name: 'Naksha · Nahargarh' })
  await expect(map.getByRole('button', { name: 'Bus stand', exact: true }).first()).toBeVisible()
  // the sunset point has its own pin, and a row in the list, by name
  await expect(map.locator('.map-item[data-kind="viewpoint"]')).toHaveAccessibleName('Sunset Point')
  await expect(map.locator('li button[data-kind="viewpoint"]')).toContainText('Sunset Point')
  await shot(page, 'nahargarh-map')
})

test('Nahargarh: the bastion on the terrace is the sunset point, looking west over the city below', async ({
  page,
}) => {
  await enterOffline(page, 'nahargarh')
  const { stair } = (await page.evaluate(() => window.__gg.roof()))!
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), stair)
  await page.getByRole('button', { name: 'Chhat pe chalo' }).tap()
  await expect.poll(async () => (await page.evaluate(() => window.__gg.roof()))!.up).toBe(true)
  expect((await page.evaluate(() => window.__gg.roof()))!.y).toBeGreaterThan(8)
  await expect(page.locator('.fade')).not.toHaveAttribute('data-on')
  // turned west, out over the parapet (yaw 0 looks north, -z; a quarter turn looks west, -x)
  await expect
    .poll(async () => Math.sin((await page.evaluate(() => window.__gg.view())).yaw))
    .toBeGreaterThan(0.9)
  if (process.env.GG_NAHARGARH_SHOTS) {
    await page.waitForTimeout(800)
    await shot(page, 'nahargarh-sunset-point-midday')
    await page.evaluate((at) => window.__gg.setNow(at), GOLDEN)
    await page.waitForTimeout(1200)
    await shot(page, 'nahargarh-sunset-point-golden')
  }
  await page.getByRole('button', { name: 'Neeche chalo' }).tap()
  await expect.poll(async () => (await page.evaluate(() => window.__gg.roof()))!.up).toBe(false)
})
