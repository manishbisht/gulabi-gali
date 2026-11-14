import { devices, expect, test } from '@playwright/test'
import { enterCity } from './support/city'

test('shows the no-3D screen without WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      return type.startsWith('webgl') ? null : orig.call(this, type, ...rest)
    } as typeof orig
  })
  await page.goto('/?gg-test=1')
  await expect(page.getByText('Is phone/browser pe 3D nahi chal raha')).toBeVisible()
})

test('enters the city and renders', async ({ page }) => {
  await enterCity(page)
  expect(await page.evaluate(() => window.__gg.quality())).toBeGreaterThanOrEqual(0)
})

test('recovers after the WebGL context is lost', async ({ page }) => {
  await enterCity(page)
  await page.evaluate(async () => {
    const ext = document.querySelector('canvas')!.getContext('webgl2')!.getExtension('WEBGL_lose_context')!
    ext.loseContext()
    await new Promise((r) => setTimeout(r, 300))
    ext.restoreContext()
  })
  await expect.poll(() => page.evaluate(() => window.__gg.framesSinceRestore())).toBeGreaterThan(5)
})

const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z)

test('walks with the keyboard', async ({ page }) => {
  await enterCity(page)
  const spawn = await page.evaluate(() => window.__gg.position())
  await page.keyboard.down('w')
  await page.waitForTimeout(800)
  await page.keyboard.up('w')
  expect(distance(spawn, await page.evaluate(() => window.__gg.position()))).toBeGreaterThan(2)
})

test.describe('on a phone', () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['Pixel 7']
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent })

  test('joystick walks on a phone', async ({ page }) => {
    await enterCity(page)
    const spawn = await page.evaluate(() => window.__gg.position())
    const box = (await page.getByRole('group', { name: 'Chalne ka joystick' }).boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const cdp = await page.context().newCDPSession(page)
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', py: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y: py, id: 1 }],
      })
    await touch('touchStart', y)
    await touch('touchMove', y - 40)
    await page.waitForTimeout(800)
    const moving = await page.evaluate(() => window.__gg.position())
    await touch('touchEnd', y - 40)
    expect(distance(spawn, moving)).toBeGreaterThan(1)
  })
})
