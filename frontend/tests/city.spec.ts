import { devices, expect, test, type Page } from '@playwright/test'
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

test('opens on the Pink City', async ({ page }) => {
  await enterCity(page)
  expect(await page.evaluate(() => window.__gg.district())).toBe('walled-city')
  await expect(page.locator('.hud-top')).toContainText('Gulabi Shahar')
  await page.getByRole('button', { name: 'Bhasha badlo: English' }).click()
  await expect(page.locator('.hud-top')).toContainText('Pink City')
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

test('collects a stamp at Hawa Mahal', async ({ page }) => {
  await enterCity(page)
  await expect(page.locator('.stamp-count')).toHaveText('0/9')
  await page.evaluate(() => window.__gg.teleport(36, -8))
  await page.getByRole('button', { name: 'Stamp lo' }).click()
  await expect(page.getByRole('status')).toContainText('stamp mila: Hawa Mahal')
  await expect(page.locator('.stamp-count')).toHaveText('1/9')
  await page.reload()
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await expect(page.locator('.stamp-count')).toHaveText('1/9')
})

/** Stands the player two metres south of a character, so the fixed camera has it dead ahead. */
async function standBeside(page: Page, id: string) {
  const npc = (await page.evaluate(() => window.__gg.npcs())).find((n) => n.id === id)!
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 2), npc)
  await expect(page.locator('.npc-bubble:not([hidden])').first()).toBeVisible()
  return (await page.evaluate(() => window.__gg.npcs())).find((n) => n.id === id)!
}

test('E opens the nearest character, who says they are not real', async ({ page }) => {
  await enterCity(page)
  await standBeside(page, 'ramesh')
  await page.keyboard.press('e') // before he has walked out of the 3 m reach
  await expect(page.locator('.npc-bubble:not([hidden])')).toContainText('Ek lassi, aur saari thakaan gayab.')
  const card = page.getByRole('region', { name: 'Ramesh ji' })
  await expect(card).toContainText('Lassiwala')
  await expect(card).toContainText('Ye ek kirdaar hai, asli insaan nahi — asli log jald aa rahe hain.')
  await expect(card.getByRole('button')).toHaveCount(1) // Close only: there is no message button
  await page.getByRole('button', { name: 'Bhasha badlo: English' }).click()
  await expect(card).toContainText('This is a character, not a real person. Real people are coming soon.')
  await page.keyboard.press('e') // E again closes it
  await expect(card).toHaveCount(0)
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

  test('tapping a character opens their card', async ({ page }) => {
    await enterCity(page)
    const npc = await standBeside(page, 'imran')
    await page.touchscreen.tap(npc.sx, npc.sy)
    const card = page.getByRole('region', { name: 'Imran' })
    await expect(card).toContainText('Blue pottery kaarigar')
    await expect(card).toContainText('Ye ek kirdaar hai, asli insaan nahi')
    await card.getByRole('button', { name: 'Band karo' }).click()
    await expect(card).toHaveCount(0)
  })
})

test('falls back when the weather API is down', async ({ page }) => {
  await page.route('**/api/city', (route) => route.abort())
  await enterCity(page)
  await expect.poll(() => page.evaluate(() => window.__gg.framesSinceRestore())).toBeGreaterThan(5)
  await expect(page.locator('.hud-top .hud-chip').nth(1)).toHaveText('—')
})

test('paints a hazy dusk with the lamps on', async ({ page }) => {
  await enterCity(page)
  await page.evaluate(() => {
    window.__gg.setSnapshot({ aqiBand: 'severe', condition: 'clear', stale: false, tempC: 31, aqi: 162 })
    window.__gg.setNow('2026-11-14T13:00:00Z')
  })
  const sky = await page.evaluate(() => window.__gg.sky())
  expect(sky.fogDensity).toBe(0.03)
  expect(sky.nightLights).toBe(true)
})

test('kite sky on Sankranti', async ({ page }) => {
  await page.goto('/?gg-test=1&gg-festival=sankranti')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  expect(await page.evaluate(() => window.__gg.festival())).toBe('sankranti')
  await expect(page.getByText('Makar Sankranti mubarak! Aasmaan dekho')).toBeVisible()
})
