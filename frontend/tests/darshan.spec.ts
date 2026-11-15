import { expect, test } from '@playwright/test'

/** A small phone, held upright. */
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

test('the stamps chip opens the Jaipur Darshan list: names for the collected, riddles for the rest', async ({
  page,
}, info) => {
  await page.addInitScript(() => localStorage.setItem('gg-stamps', '["hawa-mahal","jkk"]'))
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await expect(page.locator('.stamp-count')).toHaveText('2/9')

  await page.locator('.stamp-count').click()
  const list = page.getByRole('dialog', { name: 'Jaipur Darshan' })
  await expect(list.locator('li')).toHaveCount(9)
  await expect(list.locator('li[data-id="hawa-mahal"]')).toContainText('Hawa Mahal')
  await expect(list.locator('li[data-id="wtp"]')).not.toContainText('World Trade Park')
  await expect(list.locator('.darshan-badge')).toHaveCount(0)
  // every row whole inside the phone's width
  for (const row of await list.locator('li').all()) {
    const box = (await row.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(360)
  }
  // scrolled to the last row, the close control is still on the screen (a phone has no Escape)
  await list.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  const x = list.getByRole('button', { name: 'Band karo' }).first()
  await expect(x).toBeInViewport()
  await page.screenshot({ path: process.env.DARSHAN_SHOT ?? info.outputPath('darshan.png') })

  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
})
