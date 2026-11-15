import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test.use({ viewport: { width: 390, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

test('photo mode hides the HUD, saves a PNG of the street where files cannot be shared, and gives the HUD back', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    // many in-app browsers (Instagram's) cannot share files; make this one say so
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
  })
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  await expect(page.locator('.hud')).toBeVisible()

  await page.locator('.photo-button').click()
  await expect(page.locator('.hud')).toHaveCount(0)
  await expect(page.locator('.npc-bubbles')).toBeHidden()
  await expect(page.locator('.photo-wordmark')).toHaveText('Gulabi Gali · Jaipur')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.photo-shutter').click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^gulabi-gali-\d{8}-\d{6}\.png$/)
  const path = process.env.PHOTO_OUT ?? info.outputPath('photo.png')
  await download.saveAs(path)
  const png = readFileSync(path)
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  expect(png.readUInt32BE(16)).toBeGreaterThan(0) // width, from the IHDR chunk
  expect(png.readUInt32BE(20)).toBeGreaterThan(0) // height

  await page.locator('.photo-exit').click()
  await expect(page.locator('.photo-frame')).toHaveCount(0)
  await expect(page.locator('.hud')).toBeVisible()
})
