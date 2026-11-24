import { expect, test, type Page } from '@playwright/test'
import { closePeople, hopTo, resident, seen, walk } from './support/people'

/** A small phone, held upright. */
const PHONE = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

/** Johari Bazaar's auto stand (the auto nose to -z), a spot beside it, and where rides stop (taxi.json). */
const BESIDE = { x: -0.6, z: 30 }
const DROPS = { 'hawa-mahal': { x: 35, z: -12.5 }, 'jantar-mantar': { x: -37, z: -34 } }

/** Opens the city offline (as in city.spec.ts): a live district would pull a teleported player back. */
async function enterOffline(page: Page) {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
}

const position = (page: Page) => page.evaluate(() => window.__gg.position())
const from = async (page: Page, to: { x: number; z: number }) => {
  const p = await position(page)
  return Math.hypot(p.x - to.x, p.z - to.z)
}

test.describe('on a phone, offline', () => {
  test.use(PHONE)

  test('"Le chalo" lists the landmarks, rides to Hawa Mahal in under 4 s and sets you down there; the compass clears', async ({
    page,
  }) => {
    await enterOffline(page)
    // the compass set on Hawa Mahal from the map, as a visitor would
    await page.getByRole('button', { name: 'Naksha · Gulabi Shahar', exact: true }).tap()
    await page
      .getByRole('dialog', { name: 'Naksha · Gulabi Shahar' })
      .getByRole('button', { name: 'Hawa Mahal', exact: true })
      .tap()
    const compass = page.getByRole('button', { name: /^Hawa Mahal · \d+ m/ })
    await expect(compass).toBeVisible()

    await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), BESIDE)
    const open = page.getByRole('button', { name: 'Le chalo', exact: true })
    await expect(open).toBeVisible()
    await expect(page.getByRole('button', { name: 'Auto chalao' })).toBeVisible()
    if (process.env.GG_TAXI_BUTTONS_SHOT) await page.screenshot({ path: process.env.GG_TAXI_BUTTONS_SHOT })
    await open.tap()
    const sheet = page.getByRole('region', { name: 'Le chalo · kahan jaana hai?' })
    await expect(sheet.getByRole('button')).toHaveText([
      'Hawa Mahal',
      'Jantar Mantar',
      'Tripolia Gate',
      'Badi Chaupar',
      'City Palace',
      'Rehne do',
    ])
    // the list has the row beside the joystick to itself: no second way into it, and no "Auto chalao" on it
    await expect(open).toBeHidden()
    await expect(page.getByRole('button', { name: 'Auto chalao' })).toBeHidden()
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    const card = (await sheet.boundingBox())!
    const stick = (await page.locator('.joystick').boundingBox())!
    expect(card.x).toBeGreaterThanOrEqual(stick.x + stick.width)
    expect(card.x + card.width).toBeLessThanOrEqual(360)
    expect(card.width).toBeGreaterThan(150)
    for (const b of await sheet.getByRole('button').all())
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    if (process.env.GG_TAXI_SHOT) await page.screenshot({ path: process.env.GG_TAXI_SHOT })

    const t0 = Date.now()
    await sheet.getByRole('button', { name: 'Hawa Mahal' }).tap()
    const ride = page.getByRole('button', { name: 'Auto mein — chhodne ke liye tap karo' })
    await expect(ride).toBeFocused()
    await expect(page.locator('.hud')).toHaveCount(0) // the street, clear
    if (process.env.GG_TAXI_RIDE_SHOT) {
      await page.waitForTimeout(1500)
      await page.screenshot({ path: process.env.GG_TAXI_RIDE_SHOT })
    }
    await expect(ride).toHaveCount(0, { timeout: 6000 })
    expect(Date.now() - t0).toBeLessThan(4500)
    // on foot beside Hawa Mahal: its card is up, the compass to it is gone, nobody is at the wheel
    expect(await from(page, DROPS['hawa-mahal'])).toBeLessThanOrEqual(6)
    await expect(page.getByRole('region', { name: 'Hawa Mahal' })).toBeVisible()
    await expect(page.locator('.compass')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Utro' })).toHaveCount(0)
    const out = await position(page)
    await page.waitForTimeout(500)
    expect(await position(page)).toEqual(out) // standing, not rolling
  })

  test('a tap skips the ride; at the wheel there is no "Le chalo"', async ({ page }) => {
    await enterOffline(page)
    await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), BESIDE)
    const open = page.getByRole('button', { name: 'Le chalo', exact: true })
    await page.getByRole('button', { name: 'Auto chalao' }).tap()
    await expect(page.getByRole('button', { name: 'Utro' })).toBeVisible()
    await expect(open).toHaveCount(0)
    await page.getByRole('button', { name: 'Utro' }).tap()
    await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), BESIDE)
    await open.tap()
    await page
      .getByRole('region', { name: 'Le chalo · kahan jaana hai?' })
      .getByRole('button', { name: 'Jantar Mantar' })
      .tap()
    const ride = page.getByRole('button', { name: 'Auto mein — chhodne ke liye tap karo' })
    await expect(ride).toBeVisible()
    await ride.tap()
    await expect(ride).toHaveCount(0, { timeout: 1000 })
    expect(await from(page, DROPS['jantar-mantar'])).toBeLessThanOrEqual(6)
  })

  test('with reduced motion the ride is a cut', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await enterOffline(page)
    await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), BESIDE)
    await page.getByRole('button', { name: 'Le chalo', exact: true }).tap()
    const t0 = Date.now()
    await page
      .getByRole('region', { name: 'Le chalo · kahan jaana hai?' })
      .getByRole('button', { name: 'Hawa Mahal' })
      .tap()
    await expect(page.getByRole('region', { name: 'Hawa Mahal' })).toBeVisible()
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(await from(page, DROPS['hawa-mahal'])).toBeLessThanOrEqual(6)
  })
})

test.describe('live', () => {
  test.afterEach(closePeople)

  test('the server takes the ride: the rider vanishes from the stand, reappears by Hawa Mahal, and walks on unrefused', async ({
    browser,
  }) => {
    const asha = await resident(browser, 'Asha')
    const ravi = await resident(browser, 'Ravi')
    await expect.poll(() => seen(ravi.page)).toContain(asha.id)
    await hopTo(asha.page, BESIDE.x, BESIDE.z)
    await asha.page.getByRole('button', { name: 'Le chalo', exact: true }).click()
    await asha.page
      .getByRole('region', { name: 'Le chalo · kahan jaana hai?' })
      .getByRole('button', { name: 'Hawa Mahal' })
      .click()
    // gone from the street while in the auto
    await expect.poll(() => seen(ravi.page), { timeout: 3000, intervals: [50] }).not.toContain(asha.id)
    await expect(asha.page.getByRole('button', { name: /^Auto mein/ })).toHaveCount(0, { timeout: 6000 })
    // back, by Hawa Mahal, where Asha's own screen has her
    const drop = DROPS['hawa-mahal']
    await expect
      .poll(async () => {
        const there = (await ravi.page.evaluate(() => window.__gg.people())).find((p) => p.id === asha.id)
        return there ? Math.hypot(there.x - drop.x, there.z - drop.z) : Infinity
      })
      .toBeLessThanOrEqual(6)
    // the speed check carries on from there: no snap back to the stand, now or after a walk
    const out = await asha.page.evaluate(() => window.__gg.position())
    await asha.page.waitForTimeout(1500)
    expect(await asha.page.evaluate(() => window.__gg.position())).toEqual(out)
    await walk(asha.page, 's', 700)
    await asha.page.waitForTimeout(1000)
    expect(await from(asha.page, drop)).toBeLessThan(12)
    expect(await from(asha.page, BESIDE)).toBeGreaterThan(40)
  })
})
