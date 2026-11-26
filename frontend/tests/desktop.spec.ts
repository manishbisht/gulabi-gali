import { expect, test } from '@playwright/test'

/*
 * With a mouse there is no joystick, so the emote chip has no stick to hang over: it stands in the bottom row by
 * itself, and neither it nor its open wheel may lie over the street's buttons there.
 */
test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false })

test('on a desktop the emote chip and its wheel stand clear of "Cricket khelo"', async ({ page }) => {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.addInitScript(() => localStorage.setItem('gg-hinted', '1'))
  await page.goto('/?gg-test=1&at=walled-city:cricket')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  const cricket = page.getByRole('button', { name: 'Cricket khelo' })
  const chip = page.getByRole('button', { name: 'Mood dikhao' })
  await expect(cricket).toBeVisible()
  await expect(chip).toBeVisible()
  await expect(page.locator('.joystick')).toHaveCount(0)
  const apart = async (what: string) => {
    const c = (await cricket.boundingBox())!
    for (const b of await page.locator('.emote-chip, .emote-kind').all()) {
      const e = (await b.boundingBox())!
      const overlap =
        e.x < c.x + c.width && c.x < e.x + e.width && e.y < c.y + c.height && c.y < e.y + e.height
      expect(overlap, `${what}: an emote button over "Cricket khelo"`).toBe(false)
      expect(e.x, what).toBeGreaterThanOrEqual(0)
      expect(e.x + e.width, what).toBeLessThanOrEqual(1280)
    }
  }
  await apart('wheel shut')
  await chip.click()
  await expect(page.locator('.emote-kind')).toHaveCount(5)
  await apart('wheel open')
  // and the button still works with the wheel beside it
  await page.keyboard.press('Escape')
  await cricket.click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
