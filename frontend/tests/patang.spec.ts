import { expect, test } from '@playwright/test'

/** Opens the city on Sankranti (the override only works in test mode), past the intro. */
async function enterSankranti(page: import('@playwright/test').Page, festival = 'sankranti') {
  await page.goto(`/?gg-test=1&gg-festival=${festival}`)
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
}

test('the kite button is there on Sankranti and on no other festival', async ({ page }) => {
  await enterSankranti(page, 'holi')
  await expect(page.getByRole('button', { name: 'Patang udao' })).toHaveCount(0)
  await enterSankranti(page)
  await expect(page.getByRole('button', { name: 'Patang udao' })).toBeVisible()
})

test('a kite round: cross strings, pull, "Wo kaata!", and the score', async ({ page }) => {
  await enterSankranti(page)
  const before = await page.evaluate(() => window.__gg.position())
  await page.getByRole('button', { name: 'Patang udao' }).click()
  const game = page.getByRole('dialog', { name: 'Patang-baazi' })
  await expect(game).toBeVisible()
  // From here only the test moves the round on (`step`), so neither a slow frame rate nor a rival's chance
  // pull can decide it: a rival's string is tied across ours, and the others keep their hands to themselves.
  await page.evaluate(() => {
    window.__gg.patang().forceCross()
    window.__gg.patang().pause(true)
  })
  expect(await page.evaluate(() => window.__gg.patang().active)).toBe(true)
  expect(await page.evaluate(() => window.__gg.patang().rivals())).toBe(6)

  // the player cannot walk while the game has the keys
  await page.keyboard.down('w')
  await page.waitForTimeout(400)
  await page.keyboard.up('w')
  expect(await page.evaluate(() => window.__gg.position())).toEqual(before)

  // hold pull with the tied rival across ours: it is cut after 0.6 s of game time. Each frame counts for at
  // most 0.25 s, so a starved software-WebGL frame rate could take longer than any wait to get there; the
  // step hook plays 0.7 s at once, with the pull the button holds.
  const pull = page.getByRole('button', { name: 'Kheencho' })
  const box = (await pull.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(200)
  await page.evaluate(() => window.__gg.patang().step(0.7))
  expect(await page.evaluate(() => window.__gg.patang().score())).toBeGreaterThanOrEqual(1)
  await expect(page.getByText(/Wo kaata/)).toBeVisible()
  await page.mouse.up()

  // play the rest of the round out: the score screen shows the cuts and the best
  await page.evaluate(() => window.__gg.patang().finish())
  const score = page.locator('.patang-score')
  await expect(score).toBeVisible()
  await expect(score).toContainText(/Kaate: [1-9]/)
  await expect(score).toContainText(/Sabse zyada: [1-9]/)
  await expect(score.getByRole('button', { name: 'Phir se' })).toBeVisible()

  // Escape (or Stop) leaves: the street is walkable again
  await page.keyboard.press('Escape')
  await expect(game).toHaveCount(0)
  expect(await page.evaluate(() => window.__gg.patang().active)).toBe(false)
  await page.keyboard.down('w')
  await expect
    .poll(async () => {
      const p = await page.evaluate(() => window.__gg.position())
      return Math.hypot(p.x - before.x, p.z - before.z)
    })
    .toBeGreaterThan(1)
  await page.keyboard.up('w')
})
