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

test.describe('on a small phone', () => {
  const PHONE = { width: 360, height: 740 }
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  test('on Sankranti the rooftop viewpoint offers the kite fight, flown from up there', async ({ page }) => {
    // offline, as in rooftop.spec.ts: a live district would pull a teleported player back
    await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
    await enterSankranti(page)
    // the greeting sends everyone up to the roof
    await expect(page.getByText('Chhat pe chalo, patang udao')).toBeVisible()
    const { stair } = await page.evaluate(() => window.__gg.roof()!)
    await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), stair)
    await page.getByRole('button', { name: 'Chhat pe chalo' }).click()
    await expect.poll(() => page.evaluate(() => window.__gg.roof()!.up)).toBe(true)
    await expect(page.locator('.fade')).not.toHaveAttribute('data-on')
    const roofY = (await page.evaluate(() => window.__gg.roof()!)).y
    expect(roofY).toBeGreaterThan(6)

    // up there both are offered, the way down and the kite: thumb-sized, apart, on the screen, off the joystick
    const down = page.getByRole('button', { name: 'Neeche chalo' })
    const kite = page.getByRole('button', { name: 'Patang udao' })
    await expect(down).toBeVisible()
    await expect(kite).toBeVisible()
    const boxes = {
      down: (await down.boundingBox())!,
      kite: (await kite.boundingBox())!,
      joystick: (await page.getByRole('group', { name: 'Chalne ka joystick' }).boundingBox())!,
    }
    type Box = typeof boxes.down
    const apart = (a: Box, b: Box) =>
      a.x + a.width <= b.x + 0.5 ||
      b.x + b.width <= a.x + 0.5 ||
      a.y + a.height <= b.y + 0.5 ||
      b.y + b.height <= a.y + 0.5
    for (const k of ['down', 'kite'] as const) {
      const b = boxes[k]
      expect.soft(b.height, `${k} height`).toBeGreaterThanOrEqual(44)
      expect.soft(b.x, `${k} left`).toBeGreaterThanOrEqual(0)
      expect.soft(b.y, `${k} top`).toBeGreaterThanOrEqual(0)
      expect.soft(b.x + b.width, `${k} right`).toBeLessThanOrEqual(PHONE.width)
      expect.soft(b.y + b.height, `${k} bottom`).toBeLessThanOrEqual(PHONE.height)
      expect.soft(apart(b, boxes.joystick), `${k} clear of the joystick`).toBe(true)
    }
    expect.soft(apart(boxes.down, boxes.kite), 'the two buttons apart').toBe(true)

    await kite.click()
    const game = page.getByRole('dialog', { name: 'Patang-baazi' })
    await expect(game).toBeVisible()
    expect(await page.evaluate(() => window.__gg.patang().active)).toBe(true)
    // the game looks up from the roof, not from the street under it
    await expect.poll(() => page.evaluate(() => window.__gg.patang().eyeY())).toBeGreaterThan(roofY + 1.5)
    // Escape leaves the game, and the player is still up on the roof
    await page.keyboard.press('Escape')
    await expect(game).toHaveCount(0)
    expect(await page.evaluate(() => window.__gg.roof()!.up)).toBe(true)
    await expect(kite).toBeVisible()
  })
})
