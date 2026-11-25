import { expect, test, type Page } from '@playwright/test'

/** A small phone, held upright. */
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

/** The fixed day's sun (see `enterOffline`): midday for the pictures, and a little before sunset for the view. */
const MIDDAY = '2026-11-15T06:30:00Z'
const GOLDEN = '2026-11-15T11:55:00Z'

/**
 * Opens the city offline (as in city.spec.ts: a live district would pull a teleported player back), in `district`
 * if given, on a fixed clear day whatever the weather, with the monkey switched off so no raid can interrupt (the
 * switch itself is checked on its own). A run that takes pictures (`GG_GALTA_SHOTS`, a directory) asks for the
 * full picture, at midday.
 */
async function enterOffline(page: Page, district?: string, monkey = false) {
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
  if (!monkey) await page.addInitScript(() => localStorage.setItem('gg-no-bandar', '1'))
  const full = process.env.GG_GALTA_SHOTS ? '&gg-full=1' : ''
  await page.goto(`/?gg-test=1${full}`)
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  if (full) await page.evaluate((at) => window.__gg.setNow(at), MIDDAY)
}

const shot = (page: Page, name: string) =>
  process.env.GG_GALTA_SHOTS
    ? page.screenshot({ path: `${process.env.GG_GALTA_SHOTS}/${name}.png` })
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

test('no metro goes out to Galta Ji: the bus does, from the metro station, and back from its bus stand', async ({
  page,
}) => {
  await enterOffline(page)
  await page.evaluate(() => window.__gg.teleport(-7.2, 11)) // the Walled City's station
  await page.getByRole('button', { name: 'Metro', exact: true }).tap()
  const sheet = page.getByRole('region', { name: 'Kahan chalein?' })
  const bus = sheet.getByRole('button', { name: 'Galta Ji Bus', exact: true })
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
  await expect.poll(() => page.evaluate(() => window.__gg.district())).toBe('galta')
  await cab.tap()
  await expect(cab).toHaveCount(0)

  // set down at the bus stand at the gorge's mouth: the button says "Bus", and every stop from here is by bus
  const back = page.getByRole('button', { name: 'Bus', exact: true })
  await expect(back).toBeVisible()
  await expect(page.locator('.fade')).not.toHaveAttribute('data-on')
  await expect(page.getByRole('button', { name: 'Metro', exact: true })).toHaveCount(0)
  await back.tap()
  await expect(sheet.locator('.travel-stop[data-by="bus"]')).toHaveCount(6)
  await sheet.getByRole('button', { name: 'Nahargarh Bus', exact: true }).tap()
  await expect(page.getByRole('button', { name: 'Bus safar — chhodne ke liye tap karo' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__gg.district())).toBe('nahargarh')
})

test('Galta Ji: the auto from the mouth sets you down by the main temple, its card and the stamp there; the kund stops you; the map', async ({
  page,
}) => {
  await enterOffline(page, 'galta')
  expect(await page.evaluate(() => window.__gg.district())).toBe('galta')
  await expect(page.locator('.stamp-count')).toHaveText('0/14')
  await expect(page.locator('.hud-top')).toContainText('Galta Ji')
  await page.waitForTimeout(800)
  await shot(page, 'galta-spawn')

  // the autos wait on the road by the bus stand
  await page.evaluate(() => window.__gg.teleport(13.6, 84))
  await page.getByRole('button', { name: 'Le chalo', exact: true }).tap()
  const sheet = page.getByRole('region', { name: 'Le chalo · kahan jaana hai?' })
  await expect(sheet.getByRole('button')).toHaveText(['Galta Ji', 'Rehne do'])
  await sheet.getByRole('button', { name: 'Galta Ji' }).tap()
  const card = page.locator('section.landmark-card[aria-label="Galta Ji"]')
  await expect(card).toBeVisible({ timeout: 8000 })
  await expect(card).toContainText('kund')
  await expect(card).toContainText('Kehte hain')
  const p = await position(page)
  expect(p.x).toBeGreaterThan(6) // on the path, between the kund and the temple
  expect(p.x).toBeLessThan(19)
  await shot(page, 'galta-temple')
  await card.getByRole('button', { name: 'Stamp lo' }).tap()
  await expect(page.locator('.stamp-count')).toHaveText('1/14')

  // the main kund is water: from its ghat, walking on toward it gets you to the edge and no further
  await page.evaluate(() => window.__gg.teleport(-10, 16))
  await expect
    .poll(async () => Math.cos((await page.evaluate(() => window.__gg.view())).yaw))
    .toBeGreaterThan(0.9)
  await hold(page, 'w', 2)
  const edge = await position(page)
  expect(edge.z).toBeLessThan(16)
  expect(edge.z).toBeGreaterThan(14)

  await page.getByRole('button', { name: 'Naksha · Galta Ji', exact: true }).tap()
  const map = page.getByRole('dialog', { name: 'Naksha · Galta Ji' })
  await expect(map.getByRole('button', { name: 'Bus stand', exact: true }).first()).toBeVisible()
  // the Surya Mandir has its own pin, and a row in the list, by name
  await expect(map.locator('.map-item[data-kind="viewpoint"]')).toHaveAccessibleName('Surya Mandir')
  await expect(map.locator('li button[data-kind="viewpoint"]')).toContainText('Surya Mandir')
  await shot(page, 'galta-map')
})

test('Galta Ji: the monkeys live here too, and the switch to stop them is in the HUD', async ({ page }) => {
  await enterOffline(page, 'galta', true)
  const bandar = page.getByRole('button', { name: 'Bandar band karo' })
  await expect(bandar).toBeVisible()
  await expect(bandar).toHaveAttribute('aria-pressed', 'false')
  await bandar.tap()
  await expect(bandar).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('gg-no-bandar'))).toBe('1')
})

test('Galta Ji: up out of the gorge, the roof by the Surya Mandir looks west over the city below', async ({
  page,
}) => {
  await enterOffline(page, 'galta')
  const { stair } = (await page.evaluate(() => window.__gg.roof()))!
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), stair)
  await page.getByRole('button', { name: 'Chhat pe chalo' }).tap()
  await expect.poll(async () => (await page.evaluate(() => window.__gg.roof()))!.up).toBe(true)
  expect((await page.evaluate(() => window.__gg.roof()))!.y).toBeGreaterThan(8)
  await expect(page.locator('.fade')).not.toHaveAttribute('data-on')
  // turned west, out over the edge (yaw 0 looks north, -z; a quarter turn looks west, -x)
  await expect
    .poll(async () => Math.sin((await page.evaluate(() => window.__gg.view())).yaw))
    .toBeGreaterThan(0.9)
  if (process.env.GG_GALTA_SHOTS) {
    await page.waitForTimeout(800)
    await shot(page, 'galta-surya-mandir-midday')
    await page.evaluate((at) => window.__gg.setNow(at), GOLDEN)
    await page.waitForTimeout(1200)
    await shot(page, 'galta-surya-mandir-golden')
  }
  await page.getByRole('button', { name: 'Neeche chalo' }).tap()
  await expect.poll(async () => (await page.evaluate(() => window.__gg.roof()))!.up).toBe(false)
})
