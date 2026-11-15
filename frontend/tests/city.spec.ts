import { devices, expect, test, type Page } from '@playwright/test'
import { enterCity } from './support/city'

// These specs are about the city itself, and they place the player with `__gg.teleport`. A live district
// rightly refuses a jump like that (the speed check) and pulls the player back, so here the district socket
// goes to a mock that never answers: the city runs as it does offline. tests/people.spec.ts covers the live part.
test.beforeEach(({ page }) => page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {}))

test('shows the no-3D screen without WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      return type.startsWith('webgl') ? null : orig.call(this, type, ...rest)
    } as typeof orig
  })
  await page.goto('/?gg-test=1')
  await expect(page.getByText('Is phone/browser pe 3D nahi chal raha')).toBeVisible()
})

test('shows the no-3D screen when only WebGL2 is missing', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      return type === 'webgl2' ? null : orig.call(this, type, ...rest)
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
  await page.getByRole('button', { name: 'English: bhasha badlo' }).click()
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
  await page.evaluate(() => window.__gg.freezeNpcs(true)) // a walker cannot leave the 3 m reach mid-test
  const npc = (await page.evaluate(() => window.__gg.npcs())).find((n) => n.id === id)!
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 2), npc)
  await expect(page.locator('.npc-bubble:not([hidden])').first()).toBeVisible()
  return (await page.evaluate(() => window.__gg.npcs())).find((n) => n.id === id)!
}

test('E opens the nearest character, who says they are not real', async ({ page }) => {
  await enterCity(page)
  await standBeside(page, 'ramesh')
  await page.keyboard.press('e')
  await expect(page.locator('.npc-bubble:not([hidden])')).toContainText('Ek lassi, aur saari thakaan gayab.')
  const card = page.getByRole('region', { name: 'Ramesh ji' })
  await expect(card).toContainText('Lassiwala')
  await expect(card).toContainText('Ye ek kirdaar hai, asli insaan nahi — asli log jald aa rahe hain.')
  await expect(card.getByRole('button')).toHaveCount(1) // Close only: there is no message button
  await page.getByRole('button', { name: 'English: bhasha badlo' }).click()
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
    // letting go stops the walk, and dragging the stick never scrolls or pans the page under it
    await page.waitForTimeout(300)
    const stopped = await page.evaluate(() => window.__gg.position())
    await page.waitForTimeout(600)
    expect(distance(stopped, await page.evaluate(() => window.__gg.position()))).toBeLessThan(0.05)
    expect(await page.evaluate(() => [window.scrollX, window.scrollY, window.visualViewport?.scale])).toEqual(
      [0, 0, 1],
    )
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

test('E by the station opens the metro on a desktop', async ({ page }) => {
  await enterCity(page)
  await page.evaluate(() => window.__gg.teleport(-7.2, 11))
  await expect(page.getByRole('button', { name: 'Metro' })).toBeVisible()
  await page.keyboard.press('e')
  const sheet = page.getByRole('region', { name: 'Kahan chalein?' })
  await expect(sheet).toContainText('University–JKK')
  await page.keyboard.press('e')
  await expect(sheet).toHaveCount(0)
})

test.describe('by metro', () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['Pixel 7']
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent })

  test('travels by metro', async ({ page }) => {
    await enterCity(page)
    await expect(page.getByRole('button', { name: 'Metro' })).toHaveCount(0) // the spawn is far from it
    await page.evaluate(() => window.__gg.teleport(-7.2, 11)) // the Walled City's station
    await page.getByRole('button', { name: 'Metro' }).tap()
    const sheet = page.getByRole('region', { name: 'Kahan chalein?' })
    await expect(sheet.getByRole('button')).toHaveText([
      'MI Road–Raja Park',
      'University–JKK',
      'Malviya Nagar–WTP',
      'Band karo',
    ])
    await sheet.getByRole('button', { name: 'MI Road–Raja Park' }).tap()
    await expect.poll(() => page.evaluate(() => window.__gg.district())).toBe('mi-road')
    await expect(page.locator('.hud-top')).toContainText('MI Road–Raja Park')
    // the coach is up (focused, tap to skip) until the ride is skipped
    const coach = page.getByRole('button', { name: 'Metro safar — chhodne ke liye tap karo' })
    await expect(coach).toBeFocused()
    await coach.tap()
    await expect(coach).toHaveCount(0)
    // arrived at MI Road's own station, with the metro right there to go back
    await expect(page.getByRole('button', { name: 'Metro', exact: true })).toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: 'Padharo!' }).click()
    await expect.poll(() => page.evaluate(() => window.__gg?.district())).toBe('mi-road')
    await expect(page.locator('.hud-top')).toContainText('MI Road–Raja Park')
  })
})

test('mounts a parked auto, drives it, and gets out', async ({ page }) => {
  await enterCity(page)
  // the walled city's auto at (24, -4.6), nose to +x; the player stands a couple of metres off its side
  await page.evaluate(() => window.__gg.teleport(24, -2.5))
  const mount = page.getByRole('button', { name: 'Auto chalao' })
  const exit = page.getByRole('button', { name: 'Utro' })
  await expect(mount).toBeVisible()
  await expect(exit).toBeHidden()

  await page.keyboard.press('e')
  await expect(exit).toBeVisible()
  await expect(mount).toBeHidden()
  await expect(page.getByRole('button', { name: 'Horn bajao' })).toBeVisible()

  // at the wheel a second of throttle covers far more than a walk's 4 m
  const from = await page.evaluate(() => window.__gg.position())
  await page.keyboard.down('w')
  await page.waitForTimeout(1200)
  await page.keyboard.up('w')
  const to = await page.evaluate(() => window.__gg.position())
  expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeGreaterThan(5)

  // E gets out, and the player is walking again, a little way from the auto they left
  await page.keyboard.press('e')
  await expect(exit).toBeHidden()
  const out = await page.evaluate(() => window.__gg.position())
  expect(Math.hypot(out.x - to.x, out.z - to.z)).toBeGreaterThan(1)
  expect(Math.hypot(out.x - to.x, out.z - to.z)).toBeLessThan(3.5)
  await page.keyboard.down('d')
  await page.waitForTimeout(500)
  await page.keyboard.up('d')
  const walked = await page.evaluate(() => window.__gg.position())
  expect(Math.hypot(walked.x - out.x, walked.z - out.z)).toBeLessThan(3)
})

test('the sound switch is remembered', async ({ page }) => {
  await enterCity(page)
  const sound = page.getByRole('button', { name: 'Awaaz chalu ya band karo' })
  await expect(sound).toHaveAttribute('aria-pressed', 'true')
  await sound.click()
  await expect(sound).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => localStorage.getItem('gg-sound'))).toBe('off')
})

test('a Gangaur procession walks the street, with its line on screen', async ({ page }) => {
  await page.goto('/?gg-test=1&gg-festival=gangaur')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  expect(await page.evaluate(() => window.__gg.festival())).toBe('gangaur')
  await expect.poll(() => page.evaluate(() => window.__gg.procession().count)).toBeGreaterThan(0)
  await expect(page.getByText('Gangaur ki sawari Tripolia se nikal rahi hai')).toBeVisible()
})

test('a Teej procession names the Teej swing cart', async ({ page }) => {
  await page.goto('/?gg-test=1&gg-festival=teej')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  await expect.poll(() => page.evaluate(() => window.__gg.procession().count)).toBeGreaterThan(0)
  await expect(page.getByText('Hari lehariya mein Teej ka jhoola gali-gali ghoom raha hai')).toBeVisible()
})
