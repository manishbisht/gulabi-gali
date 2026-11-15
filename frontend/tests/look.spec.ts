import { devices, expect, test, type Page } from '@playwright/test'
import { enterCity } from './support/city'

// As in city.spec.ts: the district socket goes to a mock that never answers, so `__gg.teleport` is not pulled back.
test.beforeEach(({ page }) => page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {}))

const view = (page: Page) => page.evaluate(() => window.__gg.view())
const position = (page: Page) => page.evaluate(() => window.__gg.position())

/** Waits until the camera has finished easing into its turn, and gives back where it settled. */
async function settledYaw(page: Page) {
  let last = NaN
  await expect
    .poll(async () => {
      const { yaw } = await view(page)
      const still = Math.abs(yaw - last) < 1e-3
      last = yaw
      return still
    })
    .toBe(true)
  return last
}

test('dragging the street turns the view, W walks the new forward, and a click on a character still opens it', async ({
  page,
}) => {
  await enterCity(page)
  await page.evaluate(() => window.__gg.freezeNpcs(true))
  expect((await view(page)).yaw).toBe(0) // today's view until someone drags
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveCSS('cursor', 'grab')

  // drag right a fifth of the screen: the view turns right (a negative yaw), about 45°
  const { width, height } = page.viewportSize()!
  await page.mouse.move(width / 2, height / 2)
  await page.mouse.down()
  await page.mouse.move(width / 2 + 100, height / 2, { steps: 4 })
  await expect(canvas).toHaveCSS('cursor', 'grabbing')
  await page.mouse.move(width / 2 + width / 5, height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(canvas).toHaveCSS('cursor', 'grab')
  const yaw = await settledYaw(page)
  expect(yaw).toBeLessThan(-0.5)
  expect(yaw).toBeGreaterThan(-1.2)

  // W walks where the camera now looks, not north
  const from = await position(page)
  await page.keyboard.down('w')
  await expect
    .poll(async () => {
      const p = await position(page)
      return Math.hypot(p.x - from.x, p.z - from.z)
    })
    .toBeGreaterThan(1.5)
  await page.keyboard.up('w')
  const to = await position(page)
  const len = Math.hypot(to.x - from.x, to.z - from.z)
  const along = ((to.x - from.x) * -Math.sin(yaw) + (to.z - from.z) * -Math.cos(yaw)) / len
  expect(along).toBeGreaterThan(0.9)

  // a click (a press that barely moves) on a character in the turned view still opens their card
  const ramesh = (await page.evaluate(() => window.__gg.npcs())).find((n) => n.id === 'ramesh')!
  // two metres from Ramesh, on the camera's side of him, so he stands dead ahead in this view
  await page.evaluate(({ x, z, yaw }) => window.__gg.teleport(x + 2 * Math.sin(yaw), z + 2 * Math.cos(yaw)), {
    x: ramesh.x,
    z: ramesh.z,
    yaw,
  })
  await expect(page.locator('.npc-bubble:not([hidden])').first()).toBeVisible()
  await settledYaw(page)
  const npc = (await page.evaluate(() => window.__gg.npcs())).find((n) => n.id === 'ramesh')!
  await page.mouse.click(npc.sx, npc.sy)
  await expect(page.getByRole('region', { name: 'Ramesh ji' })).toContainText('Lassiwala')
  expect((await view(page)).yaw).toBeCloseTo(yaw, 2) // the click turned nothing
})

test.describe('on a phone', () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['Pixel 7']
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent })

  test('one thumb holds the joystick while the other drags the street to look', async ({ page }) => {
    await enterCity(page)
    const box = (await page.getByRole('group', { name: 'Chalne ka joystick' }).boundingBox())!
    const stick = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }
    const look = { x: viewport.width / 2, y: viewport.height / 3, id: 2 }
    const cdp = await page.context().newCDPSession(page)
    const touch = (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: { x: number; y: number; id: number }[],
    ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
    const from = await position(page)
    await touch('touchStart', [stick])
    await touch('touchMove', [{ ...stick, y: stick.y - 40 }]) // walking
    await touch('touchStart', [{ ...stick, y: stick.y - 40 }, look])
    for (let dx = 20; dx <= 120; dx += 20)
      await touch('touchMove', [
        { ...stick, y: stick.y - 40 },
        { ...look, x: look.x - dx },
      ]) // left turns left
    await expect.poll(async () => (await view(page)).yaw).toBeGreaterThan(0.5)
    await touch('touchEnd', [{ ...stick, y: stick.y - 40 }]) // the look thumb lifts; the stick is still held
    const walking = await position(page)
    expect(Math.hypot(walking.x - from.x, walking.z - from.z)).toBeGreaterThan(0.3)
    await touch('touchEnd', [])
    // and the page never scrolled or zoomed under either thumb
    expect(await page.evaluate(() => [window.scrollX, window.scrollY, window.visualViewport?.scale])).toEqual(
      [0, 0, 1],
    )
  })
})
