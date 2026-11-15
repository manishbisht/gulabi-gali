import { expect, test, type Page } from '@playwright/test'

/** A small phone, held upright. */
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

/**
 * Opens the city offline (as in city.spec.ts): a live district would pull a teleported player back. A run that
 * takes screenshots (`GG_ROOF_SHOT`, `GG_SIGN_SHOT`) asks for the full picture (`gg-full=1`, see testRenderLite).
 */
async function enterOffline(page: Page) {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  const full = process.env.GG_ROOF_SHOT || process.env.GG_SIGN_SHOT ? '&gg-full=1' : ''
  await page.goto(`/?gg-test=1${full}`)
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  // a picture is taken at midday, whatever the clock says
  if (full) await page.evaluate(() => window.__gg.setNow('2026-11-15T06:30:00Z'))
}

const roof = (page: Page) => page.evaluate(() => window.__gg.roof()!)
const position = (page: Page) => page.evaluate(() => window.__gg.position())

test('the rooftop: up the stair, look out, walk the strip but never off it, and back down to the stair', async ({
  page,
}) => {
  await enterOffline(page)
  const { stair, area } = await roof(page)
  // nothing to climb from the street elsewhere
  await expect(page.getByRole('button', { name: 'Chhat pe chalo' })).toHaveCount(0)
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), stair)
  const climb = page.getByRole('button', { name: 'Chhat pe chalo' })
  await climb.tap()
  await expect.poll(async () => (await roof(page)).up).toBe(true)
  const up = await roof(page)
  expect(up.y).toBeGreaterThan(6)
  const down = page.getByRole('button', { name: 'Neeche chalo' })
  await expect(down).toBeVisible()
  await expect(climb).toHaveCount(0)
  // the fade has lifted: the street is there to look at
  await expect(page.locator('.fade')).not.toHaveAttribute('data-on')
  if (process.env.GG_ROOF_SHOT) {
    await page.waitForTimeout(800) // the view has swung round to look out over the street
    await page.screenshot({ path: process.env.GG_ROOF_SHOT })
  }

  // walk hard every way: the strip's railing holds, and the player stays up there
  const inStrip = (p: { x: number; z: number }) =>
    p.x >= area.minX && p.x <= area.maxX && p.z >= area.minZ && p.z <= area.maxZ
  for (const key of ['KeyW', 'KeyD', 'KeyS', 'KeyA']) {
    await page.keyboard.down(key)
    await page.waitForTimeout(1200)
    await page.keyboard.up(key)
    expect(inStrip(await position(page)), key).toBe(true)
    expect((await roof(page)).up).toBe(true)
  }

  // E comes down, to the stair's foot
  await page.keyboard.press('KeyE')
  await expect.poll(async () => (await roof(page)).up).toBe(false)
  expect((await roof(page)).y).toBe(0)
  const p = await position(page)
  expect(Math.hypot(p.x - stair.x, p.z - stair.z)).toBeLessThan(0.01)
  await expect(climb).toBeVisible()
})

test('signposts stand at the crossings', async ({ page }) => {
  await enterOffline(page)
  const posts = await page.evaluate(() => window.__gg.signposts())
  expect(posts.length).toBeGreaterThanOrEqual(2)
  if (process.env.GG_SIGN_SHOT) {
    // up Johari Bazaar, just short of the Chaupar: the post at its mouth, to the right, ahead
    await page.evaluate(() => window.__gg.teleport(2.5, 23))
    await page.waitForTimeout(800)
    await page.screenshot({ path: process.env.GG_SIGN_SHOT })
  }
})
