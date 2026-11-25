import { expect, test } from '@playwright/test'
import { enterCity } from './support/city'

/** A small phone, held upright. */
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

/** Johari Bazaar's tapri at (5.8, -40), its counter facing -x: it serves ghewar. */
const GHEWAR = { x: 5.8 - 2, z: -40 }

test('a stall serves: "Chakho" gives the dish, the vendor\'s line and a note, and it joins Jaipur ka Swaad', async ({
  page,
}, info) => {
  await page.route('**/api/city*', (route) => route.abort()) // no live weather in this run
  await enterCity(page)
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), GHEWAR)

  const taste = page.getByRole('button', { name: 'Chakho', exact: true })
  await expect(taste).toBeVisible()
  // beside "Baitho", both whole on the phone and thumb-sized
  const sit = page.getByRole('button', { name: 'Baitho', exact: true })
  await expect(sit).toBeVisible()
  for (const button of [taste, sit]) {
    const box = (await button.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(360)
    expect(box.y + box.height).toBeLessThanOrEqual(740)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }

  await taste.click()
  const card = page.getByRole('region', { name: 'Ghewar' })
  await expect(card).toContainText('Teej aur Sankranti')
  await expect(card).toContainText('Johari Bazaar')
  // the card has the row beside the joystick to itself: whole on the phone, and wide enough to read
  await expect(sit).toBeHidden()
  await expect
    .poll(async () => {
      const box = (await card.boundingBox())!
      return box.x >= 0 && box.x + box.width <= 360 && box.y + box.height <= 740 && box.width >= 180
    })
    .toBe(true)
  await expect(card.getByRole('button', { name: 'Mazaa aa gaya' })).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: info.outputPath('swaad-card.png') })
  // the dish over the player's own head, for a moment
  await expect(page.locator('.swaad-emote')).toBeVisible()
  await expect(page.locator('.swaad-emote')).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('gg-tasted'))).toBe('["ghewar"]')

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
