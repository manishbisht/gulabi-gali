import { readFileSync } from 'node:fs'
import { expect, test, type Download, type Page } from '@playwright/test'

/** A small phone, held upright. */
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

const IG_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 Instagram 360.0.0.30.109 Android'

/** This browser cannot share files (as many in-app ones cannot): pictures are saved as downloads instead. */
async function noFileSharing(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true })
  })
}

async function enter(page: Page, lang?: 'en') {
  if (lang) await page.addInitScript((l) => localStorage.setItem('gg-lang', l), lang)
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: lang === 'en' ? 'Come in' : 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  await expect(page.locator('.hud')).toBeVisible()
}

/** The downloaded file is a PNG of an Instagram Story's size: 1080×1920 (from its IHDR chunk). */
async function expectStoryPng(download: Download, path: string) {
  await download.saveAs(path)
  const png = readFileSync(path)
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1920])
}

test('photo mode makes a 1080×1920 postcard with the place on its band, saved where files cannot be shared', async ({
  page,
}, info) => {
  await noFileSharing(page)
  await enter(page)
  await page.locator('.photo-button').click()
  await expect(page.locator('.hud')).toHaveCount(0)
  // a plain photo until the postcard is picked
  const kinds = page.getByRole('radiogroup', { name: 'Frame chuno' })
  await expect(kinds.getByRole('radio', { name: 'Photo' })).toBeChecked()
  await kinds.getByRole('radio', { name: 'Postcard' }).tap()
  await expect(kinds.getByRole('radio', { name: 'Postcard' })).toBeChecked()
  await expect(page.locator('.photo-frame-postcard .photo-wordmark')).toHaveText(
    /^Gulabi Gali · .+ · Jaipur$/,
  )
  // the frame choice, the way back and the shutter all on the phone's screen, none over another
  const boxes = await Promise.all(
    ['.photo-kinds', '.photo-exit', '.photo-shutter', '.photo-frame-postcard .photo-wordmark'].map(
      async (s) => (await page.locator(s).boundingBox())!,
    ),
  )
  for (const b of boxes) {
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.width).toBeLessThanOrEqual(360)
  }
  const overlap = (a: (typeof boxes)[0], b: (typeof boxes)[0]) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      expect(overlap(boxes[i]!, boxes[j]!), `${i} and ${j}`).toBe(false)
  await page.screenshot({ path: info.outputPath('postcard-frame.png') })

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.photo-shutter').click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^gulabi-gali-postcard-\d{8}-\d{6}\.png$/)
  await expectStoryPng(download, process.env.POSTCARD_OUT ?? info.outputPath('postcard.png'))
  await expect(page.locator('.photo-note')).toHaveText('Postcard aapke phone mein save ho gaya.')

  await page.locator('.photo-exit').click()
  await expect(page.locator('.hud')).toBeVisible()
})

test('"Card banao" in the Darshan list makes a 1080×1920 card; a guest has no "naam dikhao"', async ({
  page,
}, info) => {
  await noFileSharing(page)
  await page.addInitScript(() => localStorage.setItem('gg-stamps', '["hawa-mahal","jkk"]'))
  await enter(page)
  await page.locator('.stamp-count').click()
  const list = page.getByRole('dialog', { name: 'Jaipur Darshan' })
  const make = list.getByRole('button', { name: 'Card banao' })
  await expect(make).toBeInViewport()
  const box = (await make.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(360)
  expect(box.height).toBeGreaterThanOrEqual(44)
  await expect(list.getByRole('checkbox')).toHaveCount(0) // a guest has no name to show
  const [download] = await Promise.all([page.waitForEvent('download'), make.click()])
  expect(download.suggestedFilename()).toMatch(/^gulabi-gali-darshan-\d{8}-\d{6}\.png$/)
  await expectStoryPng(download, process.env.DARSHAN_CARD_OUT ?? info.outputPath('darshan-card.png'))
  await expect(list.getByRole('status').filter({ hasText: 'Card' })).toHaveText(
    'Card aapke phone mein save ho gaya.',
  )
})

test('the Darshan card row fits a 360 px phone in English too', async ({ page }) => {
  await enter(page, 'en')
  await page.locator('.stamp-count').click()
  const list = page.getByRole('dialog', { name: 'Jaipur Darshan' })
  const make = list.getByRole('button', { name: 'Make a card' })
  await expect(make).toBeInViewport()
  const box = (await make.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(360)
})

test.describe("Instagram's in-app browser", () => {
  test.use({ userAgent: IG_UA })

  test('the postcard and the card open alone to press and hold, with the hint, and Escape closes them', async ({
    page,
  }, info) => {
    await noFileSharing(page)
    await enter(page)
    await page.locator('.photo-button').click()
    await page.getByRole('radiogroup', { name: 'Frame chuno' }).getByRole('radio', { name: 'Postcard' }).tap()
    await page.locator('.photo-shutter').click()
    const hold = page.getByRole('dialog', { name: 'Tasveer save karo' })
    await expect(hold).toBeVisible()
    await expect(hold).toContainText('Photo pe der tak dabao aur save karo')
    const img = hold.getByRole('img', { name: 'Aapki banayi tasveer' })
    await expect(img).toHaveAttribute('src', /^blob:/)
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]))
      .toEqual([1080, 1920])
    // the whole picture, the hint and the button on the phone's screen
    for (const el of [
      img,
      hold.getByText('Photo pe der tak dabao aur save karo'),
      hold.getByRole('button'),
    ]) {
      await expect(el).toBeInViewport({ ratio: 1 })
    }
    await page.screenshot({ path: info.outputPath('postcard-hold.png') })
    await page.keyboard.press('Escape')
    await expect(hold).toHaveCount(0)
    await expect(page.locator('.photo-shutter')).toBeVisible() // still in photo mode
    await page.locator('.photo-exit').click()

    await page.locator('.stamp-count').click()
    await page
      .getByRole('dialog', { name: 'Jaipur Darshan' })
      .getByRole('button', { name: 'Card banao' })
      .click()
    await expect(hold).toBeVisible()
    await hold.getByRole('button', { name: 'Band karo' }).click()
    await expect(hold).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Jaipur Darshan' })).toBeVisible()
  })
})
