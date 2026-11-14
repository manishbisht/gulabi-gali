import { expect, test } from '@playwright/test'
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
