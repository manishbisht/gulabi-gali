import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator } from '@playwright/test'

test.beforeEach(({ page }) => page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {}))

const box = async (l: Locator) => (await l.boundingBox())!
const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

test('every page a spec opens starts with the hint seen, however its context was made', async ({
  browser,
}) => {
  const other = await browser.newContext()
  const page = await other.newPage()
  await page.goto('/')
  expect(await page.evaluate(() => localStorage.getItem('gg-hinted'))).toBe('1')
  await other.close()
})

test.describe('a first visit', () => {
  // every other spec starts with `gg-hinted` seeded (playwright.config.ts); these are a true first visit
  test.use({ storageState: { cookies: [], origins: [] } })

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true })

    test('sees the three-step hint once: it clears the HUD at 360 px, closes, and stays closed', async ({
      page,
    }) => {
      await page.goto('/?gg-test=1')
      await page.getByRole('button', { name: 'Padharo!' }).click()
      const hint = page.getByRole('dialog', { name: /Pehli baar gali mein/ })
      await expect(hint).toBeVisible()
      await expect(hint.getByRole('listitem')).toHaveCount(3)
      const close = hint.getByRole('button', { name: 'Samajh gaye, chalo!' })
      await expect(close).toBeFocused()
      await expect(hint).toContainText('joystick') // a touch screen gets the touch wording
      await expect(hint).toContainText('chai chakho, ghanti bajao, cricket khelo') // and one line of things to do

      // nothing of the HUD's is under it: not a chip at the top, not a button or the joystick at the bottom
      const card = await box(hint)
      for (const l of await page.locator('.hud-head .hud-chip, .hud-head p, .hud-bottom > *').all()) {
        if (!(await l.isVisible())) continue
        expect(overlaps(card, await box(l)), await l.evaluate((n) => n.outerHTML.slice(0, 80))).toBe(false)
      }
      await page.waitForTimeout(400) // the card's slide-in, for the picture
      await page.screenshot({ path: '../.superpowers/sdd/2026-11-14-phase-4-extras/launch-b-hint-360.png' })

      // the street still walks under it
      const before = await page.evaluate(() => window.__gg.position())
      await page.keyboard.down('w')
      await expect
        .poll(async () => {
          const p = await page.evaluate(() => window.__gg.position())
          return Math.hypot(p.x - before.x, p.z - before.z)
        })
        .toBeGreaterThan(0.5)
      await page.keyboard.up('w')

      await close.click()
      await expect(hint).toHaveCount(0)
      expect(await page.evaluate(() => localStorage.getItem('gg-hinted'))).toBe('1')
      await page.reload()
      await page.getByRole('button', { name: 'Padharo!' }).click()
      await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
      await expect(page.locator('.hud-chip').first()).toBeVisible()
      await page.waitForTimeout(500)
      await expect(page.getByRole('dialog', { name: /Pehli baar gali mein/ })).toHaveCount(0)
    })
  })

  test('its text has the contrast of the cream on plum it is drawn in, from the first frame (axe)', async ({
    page,
  }) => {
    await page.goto('/?gg-test=1')
    await page.getByRole('button', { name: 'Padharo!' }).click()
    const hint = page.getByRole('dialog', { name: /Pehli baar gali mein/ })
    await expect(hint).toBeVisible()
    // no wait for the slide-in: the card must not be part-transparent while it arrives
    expect(await hint.evaluate((n) => getComputedStyle(n).animationName)).toBe('hint-up')
    const { violations } = await new AxeBuilder({ page })
      .include('.first-hint')
      .withRules(['color-contrast'])
      .analyze()
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 60)).join(' | ')}`)).toEqual(
      [],
    )
  })

  test('with a keyboard it names the keys, and Escape closes it', async ({ page }) => {
    await page.goto('/?gg-test=1')
    await page.getByRole('button', { name: 'Padharo!' }).click()
    const hint = page.getByRole('dialog', { name: /Pehli baar gali mein/ })
    await expect(hint).toContainText('W A S D')
    await page.keyboard.press('Escape')
    await expect(hint).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('gg-hinted'))).toBe('1')
  })
})
