import { devices, expect, test, type Page } from '@playwright/test'
import { enterCity } from './support/city'

// As in city.spec.ts: the district socket goes to a mock that never answers, so `__gg.teleport` is not pulled back.
// The server's side of a jog (never refused at 7.2 m/s) is in backend/test/district.test.ts.
test.beforeEach(({ page }) => page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {}))

const view = (page: Page) => page.evaluate(() => window.__gg.view())
const position = (page: Page) => page.evaluate(() => window.__gg.position())

/** Waits until the player is under way from where it stood. */
async function underWay(page: Page) {
  const from = await position(page)
  await expect
    .poll(async () => {
      const p = await position(page)
      return Math.hypot(p.x - from.x, p.z - from.z)
    })
    .toBeGreaterThan(0.2)
}

/** Metres a second over the next 400 ms, timed in the page. */
const pace = (page: Page) =>
  page.evaluate(async () => {
    const a = window.__gg.position()
    const t = performance.now()
    await new Promise((r) => setTimeout(r, 400))
    const b = window.__gg.position()
    return Math.hypot(b.x - a.x, b.z - a.z) / ((performance.now() - t) / 1000)
  })

/** Waits for the camera to finish easing into its zoom, and gives back where it settled. */
async function settledZoom(page: Page) {
  let last = NaN
  await expect
    .poll(async () => {
      const { zoom } = await view(page)
      const still = Math.abs(zoom - last) < 1e-3
      last = zoom
      return still
    })
    .toBe(true)
  return last
}

test('Shift jogs about 1.8x as fast as a walk, and the wheel zooms between 0.6x and 1.6x', async ({
  page,
}) => {
  await enterCity(page)
  const start = await position(page)
  await page.keyboard.down('w')
  await underWay(page)
  const walk = await pace(page)
  await page.keyboard.up('w')

  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), start)
  await page.keyboard.down('Shift')
  await page.keyboard.down('w')
  await underWay(page)
  const jog = await pace(page)
  await page.keyboard.up('w')
  await page.keyboard.up('Shift')
  expect(jog / walk).toBeGreaterThan(1.5)
  expect(jog / walk).toBeLessThan(2.1)

  expect((await view(page)).zoom).toBe(1)
  const { width, height } = page.viewportSize()!
  await page.mouse.move(width / 2, height / 2)
  await page.mouse.wheel(0, 200) // toward you: farther
  expect(await settledZoom(page)).toBeGreaterThan(1.2)
  await page.mouse.wheel(0, 5000)
  expect(await settledZoom(page)).toBeCloseTo(1.6, 2)
  await page.mouse.wheel(0, -10000)
  expect(await settledZoom(page)).toBeCloseTo(0.6, 2)
  expect((await view(page)).yaw).toBe(0) // zooming turned nothing
  expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0])
})

test.describe('on a phone', () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['Pixel 7']
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent })

  type Point = { x: number; y: number; id: number }
  async function touchscreen(page: Page) {
    const cdp = await page.context().newCDPSession(page)
    return (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Point[]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
  }

  test('the joystick pushed to its rim jogs; pushed part way it walks', async ({ page }) => {
    await enterCity(page)
    const touch = await touchscreen(page)
    const box = (await page.getByRole('group', { name: 'Chalne ka joystick' }).boundingBox())!
    const stick = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }
    const start = await position(page)
    const push = async (dy: number) => {
      await touch('touchStart', [stick])
      await touch('touchMove', [{ ...stick, y: stick.y - dy }])
      await underWay(page)
      const v = await pace(page)
      await touch('touchEnd', [])
      await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), start)
      return v
    }
    const part = await push(29) // 60% of the 48 px reach: a walk at 60%
    const rim = await push(80) // past the rim, held at it: a jog
    expect(rim / part).toBeGreaterThan(2.4) // 1.8 / 0.6 = 3
    expect(rim / part).toBeLessThan(3.6)
  })

  test('two fingers spreading on the street zoom in, without turning the view or zooming the page', async ({
    page,
  }) => {
    await enterCity(page)
    const touch = await touchscreen(page)
    const mid = { x: viewport.width / 2, y: viewport.height / 3 }
    const a = { x: mid.x - 30, y: mid.y, id: 1 }
    const b = { x: mid.x + 30, y: mid.y, id: 2 }
    await touch('touchStart', [a])
    await touch('touchStart', [a, b])
    for (let d = 10; d <= 60; d += 10)
      await touch('touchMove', [
        { ...a, x: a.x - d },
        { ...b, x: b.x + d },
      ])
    await touch('touchEnd', [])
    // 60 px apart to 180: a third of the distance, held at the nearest the camera goes
    expect(await settledZoom(page)).toBeCloseTo(0.6, 2)
    expect((await view(page)).yaw).toBe(0)
    // and back: pinching in zooms out, 180 px apart to 120, so 1.5x as far
    await touch('touchStart', [{ ...a, x: a.x - 60 }])
    await touch('touchStart', [
      { ...a, x: a.x - 60 },
      { ...b, x: b.x + 60 },
    ])
    await touch('touchMove', [
      { ...a, x: a.x - 30 },
      { ...b, x: b.x + 30 },
    ])
    await touch('touchEnd', [])
    expect(await settledZoom(page)).toBeCloseTo(0.9, 2)
    expect(await page.evaluate(() => [window.scrollX, window.scrollY, window.visualViewport?.scale])).toEqual(
      [0, 0, 1],
    )
  })
})
