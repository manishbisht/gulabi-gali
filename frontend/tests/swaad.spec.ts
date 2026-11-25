import { expect, test, type Locator } from '@playwright/test'
import { enterCity } from './support/city'

/** A small phone, held upright. */
const PHONE = { width: 360, height: 740 }
test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
/** Room kept against the screen's right edge and foot: CI's fonts run a few px wider than a Mac's. */
const SLACK = 10

/** Each item whole on the screen with `SLACK` to spare, and none on another (hud.spec.ts's `sideBySide`). */
async function sideBySide(items: Record<string, Locator>) {
  for (const item of Object.values(items)) await expect(item).toBeVisible()
  const boxes = await Promise.all(
    Object.entries(items).map(async ([k, l]) => [k, (await l.boundingBox())!] as const),
  )
  for (const [k, b] of boxes) {
    expect.soft(b.x, `${k} left`).toBeGreaterThanOrEqual(0)
    expect.soft(b.x + b.width, `${k} right`).toBeLessThanOrEqual(PHONE.width - SLACK)
    expect.soft(b.y + b.height, `${k} bottom`).toBeLessThanOrEqual(PHONE.height - SLACK)
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

for (const [lang, enter, tasteName, sitName, close] of [
  ['hi', 'Padharo!', 'Chakho', 'Baitho', 'Mazaa aa gaya'],
  ['en', 'Come in', 'Taste it', 'Sit here', 'Delicious!'],
] as const)
  test(`on a small phone (${lang}) the joystick, "${sitName}" and "${tasteName}" fit, and then the dish card beside the joystick`, async ({
    page,
  }) => {
    await page.route('**/api/city*', (route) => route.abort())
    // the city offline, as in hud.spec.ts: a live district would pull a teleported player back
    await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
    await page.addInitScript((l) => localStorage.setItem('gg-lang', l), lang)
    await page.goto('/?gg-test=1')
    await page.getByRole('button', { name: enter }).click()
    await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
    await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), GHEWAR)
    const joystick = page.locator('.joystick')
    const taste = page.getByRole('button', { name: tasteName, exact: true })
    const sit = page.getByRole('button', { name: sitName, exact: true })
    await sideBySide({ joystick, sit, taste })
    for (const button of [taste, sit]) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)

    await taste.click()
    const card = page.getByRole('region', { name: 'Ghewar' })
    await expect(card).toBeVisible()
    await expect(sit).toBeHidden()
    // the card slides up for 220 ms: measure where it comes to rest
    await card.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    await sideBySide({ joystick, card })
    expect((await card.boundingBox())!.width).toBeGreaterThanOrEqual(180)
    await expect(card.getByRole('button', { name: close })).toBeInViewport({ ratio: 1 })
  })

/** Johari Bazaar's tapri at (5.8, -40), its counter facing -x: it serves ghewar. */
const GHEWAR = { x: 5.8 - 2, z: -40 }

test('a stall serves: "Chakho" gives the dish, the vendor\'s line and a note, and it joins Jaipur ka Swaad', async ({
  page,
}, info) => {
  await page.route('**/api/city*', (route) => route.abort()) // no live weather in this run
  // the city offline, as in hud.spec.ts: a live district would pull a teleported player back
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await enterCity(page)
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), GHEWAR)

  const taste = page.getByRole('button', { name: 'Chakho', exact: true })
  await taste.click()
  const card = page.getByRole('region', { name: 'Ghewar' })
  await expect(card).toContainText('Teej aur Sankranti')
  await expect(card).toContainText('Johari Bazaar')
  await page.screenshot({ path: info.outputPath('swaad-card.png') })
  // the dish over the player's own head, for a moment
  await expect(page.locator('.swaad-emote')).toBeVisible()
  await expect(page.locator('.swaad-emote')).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('gg-tasted'))).toBe('["ghewar"]')

  // E with the card up closes it, and tastes nothing more
  await page.keyboard.press('e')
  await expect(card).toBeHidden()
  await expect(taste).toBeVisible()
  await taste.click()
  await expect(card).toBeVisible()

  // walking off puts the card away
  await page.evaluate(() => window.__gg.teleport(0, 40))
  await expect(card).toBeHidden()
  await expect(taste).toBeHidden()

  // the list is the Darshan sheet's second tab
  await page.locator('.stamp-count').click()
  const sheet = page.getByRole('dialog', { name: 'Jaipur Darshan' })
  await sheet.getByRole('tab', { name: 'Swaad 1/8' }).click()
  await expect(sheet.getByRole('heading', { name: 'Jaipur ka Swaad · 1/8' })).toBeVisible()
  await expect(sheet.locator('li')).toHaveCount(8)
  await expect(sheet.locator('li[data-got="true"]')).toHaveCount(1)
  await expect(sheet.locator('li[data-id="ghewar"]')).toContainText('Johari Bazaar')
  for (const row of await sheet.locator('li').all()) {
    const r = (await row.boundingBox())!
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.x + r.width).toBeLessThanOrEqual(360)
  }
  for (const tab of await sheet.getByRole('tab').all())
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: info.outputPath('swaad-list.png') })
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

test('in English, and the list survives a reload; all eight earn the closing line', async ({ page }) => {
  await page.route('**/api/city*', (route) => route.abort())
  // the city offline, as in hud.spec.ts: a live district would pull a teleported player back
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.addInitScript(() => {
    localStorage.setItem('gg-lang', 'en')
    if (!localStorage.getItem('gg-tasted'))
      localStorage.setItem(
        'gg-tasted',
        '["chai","kachori","lassi","kulfi","mirchi-vada","dal-baati","golgappe"]',
      )
  })
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: 'Come in' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), GHEWAR)
  await page.getByRole('button', { name: 'Taste it', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Ghewar' })).toContainText('Johari Bazaar')
  await page.getByRole('button', { name: 'Delicious!' }).click()
  await expect(page.getByRole('region', { name: 'Ghewar' })).toBeHidden()

  await page.reload()
  await page.getByRole('button', { name: 'Come in' }).click()
  await page.locator('.stamp-count').click()
  const sheet = page.getByRole('dialog', { name: 'Jaipur Darshan' })
  await sheet.getByRole('tab', { name: 'Swaad 8/8' }).click()
  await expect(sheet.locator('.swaad-done')).toContainText('All eight tasted')
})
