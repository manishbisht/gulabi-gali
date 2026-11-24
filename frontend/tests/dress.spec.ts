import { expect, test, type Locator, type Page } from '@playwright/test'
import { enterCity } from './support/city'
import { closePeople, resident } from './support/people'

/** A small phone, held upright. */
const PHONE = { width: 360, height: 740 }
const API = 'http://127.0.0.1:8787'

test.afterEach(closePeople)

/** Entirely on the screen. */
async function onScreen(item: Locator, what: string) {
  const b = (await item.boundingBox())!
  expect.soft(b.x, `${what} left`).toBeGreaterThanOrEqual(0)
  expect.soft(b.y, `${what} top`).toBeGreaterThanOrEqual(0)
  expect.soft(b.x + b.width, `${what} right`).toBeLessThanOrEqual(PHONE.width)
  expect.soft(b.y + b.height, `${what} bottom`).toBeLessThanOrEqual(PHONE.height)
}

/** The dressing room fits the phone: the figure, the buttons and every choice reachable, nothing sideways. */
async function fits(page: Page, editor: Locator, save: string, cancel: string) {
  await onScreen(editor, 'editor')
  await onScreen(editor.locator('canvas.look-preview'), 'figure')
  await onScreen(editor.getByRole('button', { name: save }), 'save')
  await onScreen(editor.getByRole('button', { name: cancel }), 'cancel')
  const options = editor.locator('.look-options')
  // the choices scroll up and down, never sideways
  expect(await options.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width)
  // every radio can be brought into view inside the editor, and is a thumb-sized target
  for (const r of await editor.getByRole('radio').all()) {
    await r.scrollIntoViewIfNeeded()
    const b = (await r.boundingBox())!
    expect.soft(b.width, 'radio width').toBeGreaterThanOrEqual(44)
    expect.soft(b.height, 'radio height').toBeGreaterThanOrEqual(44)
    expect.soft(b.x + b.width, 'radio right').toBeLessThanOrEqual(PHONE.width)
  }
}

test.describe('on a small phone', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  for (const lang of ['hi', 'en'] as const) {
    const W =
      lang === 'hi'
        ? { chip: 'Apna roop badlo', title: 'Apna roop', save: 'Save karo', cancel: 'Rehne do', tone: 'Rang' }
        : { chip: 'Change your look', title: 'Your look', save: 'Save', cancel: 'Cancel', tone: 'Skin tone' }

    test(`a guest dresses up with the keyboard, on this phone only, and it fits (${lang})`, async ({
      page,
    }, info) => {
      await page.addInitScript((l) => localStorage.setItem('gg-lang', l), lang)
      // an older look, as every guest had before the dressing room
      await page.addInitScript(() =>
        localStorage.setItem('gg-look', JSON.stringify({ skin: 1, outfit: 'teal', head: 'cap' })),
      )
      await page.goto('/?gg-test=1')
      await page.getByRole('button', { name: lang === 'en' ? 'Come in' : 'Padharo!' }).click()
      await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)

      await page.getByRole('button', { name: W.chip }).click()
      const editor = page.getByRole('dialog', { name: W.title })
      await expect(editor).toBeVisible()
      await fits(page, editor, W.save, W.cancel)
      await page.screenshot({ path: info.outputPath(`dress-360-${lang}.png`) })

      // the look as it was: tone 3 (the older skin 1), a white cap
      const tones = editor.getByRole('group', { name: W.tone, exact: true })
      const tone = (n: number) =>
        tones.getByRole('radio', { name: `${lang === 'hi' ? 'Rang' : 'Tone'} ${n}` })
      await expect(tone(3)).toBeChecked()
      // arrows move within a group, as radios do anywhere
      await tone(3).focus()
      await page.keyboard.press('ArrowRight')
      await expect(tone(4)).toBeChecked()
      await expect(tone(4)).toBeFocused()
      // the tones are the dialog's first stop: Shift+Tab wraps to its last control, never out of it
      await page.keyboard.press('Shift+Tab')
      await expect(editor.getByRole('button', { name: W.save })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(tone(4)).toBeFocused()
      // Tab goes on to the next group, landing on its chosen colour
      await page.keyboard.press('Tab')
      await expect(
        editor.getByRole('radio', { name: lang === 'hi' ? 'Firozi' : 'Teal' }).first(),
      ).toBeFocused()
      // pick a pagdi, by keyboard: Space on the head group's options
      const pagdi = editor.getByRole('radio', { name: 'Pagdi', exact: true })
      await pagdi.focus()
      await page.keyboard.press('Space')
      await expect(pagdi).toBeChecked()
      await editor.getByRole('radio', { name: lang === 'hi' ? 'Choti' : 'Plait' }).check()

      await editor.getByRole('button', { name: W.save }).click()
      await expect(editor).toBeHidden()
      // focus goes back to the chip that opened it
      await expect(page.getByRole('button', { name: W.chip })).toBeFocused()
      const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('gg-look')!))
      expect(kept).toMatchObject({ tone: 3, hat: 2, hair: 4, outfit: 'teal', head: 'safa', skin: 2 })

      // Cancel changes nothing
      await page.getByRole('button', { name: W.chip }).click()
      await editor.getByRole('radio', { name: lang === 'hi' ? 'Kuch nahi' : 'Nothing' }).check()
      await editor.getByRole('button', { name: W.cancel }).click()
      await expect(editor).toBeHidden()
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gg-look')!))).toEqual(kept)

      // and photo mode, which shows the street as it is, still works with the new look on
      await page.locator('.photo-button').click()
      await expect(page.locator('.photo-frame')).toBeVisible()
      await page.screenshot({ path: info.outputPath(`dress-photo-${lang}.png`) })
    })
  }

  test("a resident's look is saved to their profile and others can see it", async ({ browser }, info) => {
    const phone = { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    const asha = await resident(browser, 'Asha', phone)
    const { page } = asha
    // a resident dresses up in the profile sheet: the guest's chip is gone
    await expect(page.locator('.hud .look-button')).toHaveCount(0)
    await page.getByRole('button', { name: 'Profile' }).click()
    const sheet = page.getByRole('dialog', { name: 'Apni pehchaan banao' })
    await sheet.getByRole('button', { name: 'Kapde badlo' }).click()
    const editor = page.getByRole('dialog', { name: 'Apna roop' })
    await expect(editor).toBeVisible()
    await fits(page, editor, 'Save karo', 'Rehne do')
    await editor.getByRole('radio', { name: 'Rang 7' }).check()
    await editor.getByRole('radio', { name: 'Safa', exact: true }).check()
    await editor
      .getByRole('group', { name: 'Safa, pagdi ya topi ka rang' })
      .getByRole('radio', { name: 'Gulabi' })
      .check()
    await editor.getByRole('radio', { name: 'Kandhon pe' }).check()
    await editor.getByRole('radio', { name: 'Lambe' }).check()
    await page.screenshot({ path: info.outputPath('dress-resident-360.png') })
    await editor.getByRole('button', { name: 'Save karo' }).click()
    await expect(editor).toBeHidden()
    // the profile sheet stays open, the look saved
    await expect(sheet).toBeVisible()

    // the server has it, and a verified resident sees it on their profile (the map carries the same look)
    const ravi = await resident(browser, 'Ravi')
    const token = await ravi.page.evaluate(() => sessionStorage.getItem('gg-dev-token')!)
    const res = await ravi.page.request.get(`${API}/api/profiles/${encodeURIComponent(asha.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status()).toBe(200)
    const { look } = (await res.json()) as { look: Record<string, unknown> }
    // tone 6 (the seventh), a pink safa, a stole round the shoulders, long hair; the older fields to match
    expect(look).toMatchObject({ tone: 6, hat: 1, hatC: 0, dup: 2, hair: 3, head: 'safa', skin: 4 })
  })
})

test('the guest chip opens the dressing room on a wide screen too, and Escape closes it', async ({
  page,
}) => {
  await enterCity(page)
  await page.getByRole('button', { name: 'Apna roop badlo' }).click()
  const editor = page.getByRole('dialog', { name: 'Apna roop' })
  await expect(editor).toBeVisible()
  await expect(editor.locator('canvas.look-preview')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
})

test('signed in without a finished profile, the walker wears this device look, and the chip dresses it', async ({
  page,
}) => {
  await enterCity(page)
  await page.getByRole('button', { name: 'Dikhna hai? Login karo' }).click()
  await page.getByLabel('Aapka naam').fill(`Adha${Date.now() % 100000}`)
  await page.getByRole('button', { name: 'Andar aao' }).click()
  const sheet = page.getByRole('dialog', { name: 'Apni pehchaan banao' })
  await sheet.getByRole('button', { name: 'Baad mein' }).click()
  await expect(sheet).toBeHidden()
  await page.getByRole('button', { name: 'Apna roop badlo' }).click()
  const editor = page.getByRole('dialog', { name: 'Apna roop' })
  await editor.getByRole('radio', { name: 'Choti' }).check()
  await editor.getByRole('button', { name: 'Save karo' }).click()
  await expect(editor).toBeHidden()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gg-look')!))).toMatchObject({ hair: 4 })
})
