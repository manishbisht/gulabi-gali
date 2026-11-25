import { expect, test, type Page } from '@playwright/test'

const PHONE = { width: 360, height: 740 }

/**
 * Opens the city offline (as in rooftop.spec.ts: a live district would pull a teleported player back), in
 * `district` if given, on a fixed clear day whatever the weather. A run that takes pictures (`GG_CRICKET_SHOTS`,
 * a directory) asks for the full picture, at midday.
 */
async function enterOffline(page: Page, district?: string, lang?: 'en') {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.route('**/api/city*', (route) =>
    route.fulfill({
      json: {
        fetchedAt: new Date().toISOString(),
        tempC: 24,
        condition: 'clear',
        aqi: 80,
        aqiBand: 'moderate',
        sunrise: '2026-11-15T01:15:00Z',
        sunset: '2026-11-15T12:10:00Z',
        festival: null,
        stale: false,
      },
    }),
  )
  if (district) await page.addInitScript((d) => localStorage.setItem('gg-district', d), district)
  if (lang) await page.addInitScript((l) => localStorage.setItem('gg-lang', l), lang)
  const full = process.env.GG_CRICKET_SHOTS ? '&gg-full=1' : ''
  await page.goto(`/?gg-test=1${full}`)
  await page.getByRole('button', { name: lang === 'en' ? 'Come in' : 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  if (full) await page.evaluate(() => window.__gg.setNow('2026-11-15T06:30:00Z'))
}

const shot = (page: Page, name: string) =>
  process.env.GG_CRICKET_SHOTS
    ? page.screenshot({ path: `${process.env.GG_CRICKET_SHOTS}/${name}.png` })
    : undefined
const position = (page: Page) => page.evaluate(() => window.__gg.position())
/** Stands the player beside the district's pitch, a step off its middle. */
async function toPitch(page: Page) {
  const pitch = await page.evaluate(() => window.__gg.cricketPitch()!)
  expect(pitch).not.toBeNull()
  const at = { x: (pitch.stumps.x + pitch.bowler.x) / 2, z: (pitch.stumps.z + pitch.bowler.z) / 2 + 1.2 }
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), at)
  return { pitch, at }
}

test.describe('on a small phone', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  test('gali cricket: walk up to the pitch, one thumb plays an innings, and you are back where you stood', async ({
    page,
  }) => {
    await enterOffline(page)
    const play = page.getByRole('button', { name: 'Cricket khelo', exact: true })
    // nothing to play from where the city opens
    await expect(play).toHaveCount(0)
    const { pitch, at } = await toPitch(page)
    await expect(play).toBeVisible()
    await shot(page, 'pitch')

    // thumb-sized, on the screen, clear of the joystick
    const button = (await play.boundingBox())!
    const stick = (await page.getByRole('group', { name: 'Chalne ka joystick' }).boundingBox())!
    expect.soft(button.height).toBeGreaterThanOrEqual(44)
    expect.soft(button.x).toBeGreaterThanOrEqual(0)
    expect.soft(button.x + button.width).toBeLessThanOrEqual(PHONE.width - 10)
    expect.soft(button.y + button.height).toBeLessThanOrEqual(PHONE.height)
    expect
      .soft(
        button.x >= stick.x + stick.width ||
          button.x + button.width <= stick.x ||
          button.y + button.height <= stick.y ||
          button.y >= stick.y + stick.height,
        'clear of the joystick',
      )
      .toBe(true)

    await play.tap()
    const game = page.getByRole('dialog', { name: 'Gali cricket' })
    await expect(game).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.__gg.cricket().active)).toBe(true)
    // from here only the test moves the innings on, so a slow frame rate cannot decide a ball
    await page.evaluate(() => window.__gg.cricket().pause(true))
    await expect(game.getByText('Run: 0')).toBeVisible()
    await expect(game.getByText('Ball 1/18')).toBeVisible()
    await expect(game.getByText('Out 0/3')).toBeVisible()
    // the HUD is out of the way, and the game's view is the batter's: behind the stumps, looking at the bowler
    await expect(page.locator('.hud')).toBeHidden()
    await expect
      .poll(async () => {
        const eye = await page.evaluate(() => window.__gg.cricket().eye())
        return Math.hypot(eye.x - pitch.stumps.x, eye.z - pitch.stumps.z)
      })
      .toBeLessThan(2)
    const eye = await page.evaluate(() => window.__gg.cricket().eye())
    expect(eye.y).toBeGreaterThan(1.2)
    expect(eye.y).toBeLessThan(1.8)
    expect(await page.evaluate(() => window.__gg.cricket().fielders())).toBe(3)
    await shot(page, 'game')

    // the close button is a thumb's size, in the corner
    const close = game.getByRole('button', { name: 'Khel band karo' })
    const closeBox = (await close.boundingBox())!
    expect.soft(closeBox.width).toBeGreaterThanOrEqual(44)
    expect.soft(closeBox.height).toBeGreaterThanOrEqual(44)
    expect.soft(closeBox.x + closeBox.width).toBeLessThanOrEqual(PHONE.width)
    // the chips and the button sit on one row at 360 px, with room to spare for wider fonts
    const chips = await game.locator('.cricket-top .hud-chip').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { top: r.top, right: r.right }
      }),
    )
    expect.soft(new Set(chips.map((c) => Math.round(c.top))).size, 'chips on one row').toBe(1)
    expect.soft(Math.max(...chips.map((c) => c.right))).toBeLessThanOrEqual(closeBox.x - 10)

    // the ball is at the bat: a tap anywhere on the field is the swing, and this one is a six
    await page.evaluate(() => window.__gg.cricket().tapAtBat())
    await page.touchscreen.tap(120, 520)
    await expect.poll(() => page.evaluate(() => window.__gg.cricket().runs())).toBe(6)
    await expect(game.getByText('Run: 6')).toBeVisible()
    await expect(game.getByText(/Chhakka!/)).toBeVisible()
    await shot(page, 'six')
    // a little late is a four; no tap at all is a dot ball or the bricks going down
    await page.evaluate(() => window.__gg.cricket().ball(0.06))
    await expect(game.getByText('Run: 10')).toBeVisible()
    await expect(game.getByText('Chauka!')).toBeVisible()
    await page.evaluate(() => window.__gg.cricket().ball(null))
    await expect(game.getByText('Ball 4/18')).toBeVisible()
    expect(await page.evaluate(() => window.__gg.cricket().runs())).toBe(10)

    // the player cannot walk while the game has the screen
    await page.keyboard.down('w')
    await page.waitForTimeout(400)
    await page.keyboard.up('w')
    expect(await position(page)).toEqual(at)

    // the rest of the innings, nobody batting: the score, the best kept on this phone, and a share line
    await page.evaluate(() => window.__gg.cricket().finish())
    const score = page.locator('.cricket-score')
    await expect(score).toBeVisible()
    await expect(score).toContainText('Run: 10')
    await expect(score).toContainText('Sabse zyada: 10')
    await expect(score).toContainText('Naya record!')
    expect(await page.evaluate(() => localStorage.getItem('gg-cricket-best'))).toBe('10')
    await shot(page, 'score')
    for (const name of ['Ek aur baari', 'Share karo', 'Bas, ho gaya']) {
      const b = (await score.getByRole('button', { name, exact: true }).boundingBox())!
      expect.soft(b.height, name).toBeGreaterThanOrEqual(44)
      expect.soft(b.x, name).toBeGreaterThanOrEqual(0)
      expect.soft(b.x + b.width, name).toBeLessThanOrEqual(PHONE.width)
    }

    // another innings, then out by the close button: back exactly where you stood, the street yours again
    await score.getByRole('button', { name: 'Ek aur baari' }).tap()
    await expect(score).toHaveCount(0)
    await expect(game.getByText('Run: 0')).toBeVisible()
    await close.tap()
    await expect(game).toHaveCount(0)
    expect(await page.evaluate(() => window.__gg.cricket().active)).toBe(false)
    expect(await position(page)).toEqual(at)
    await expect(page.locator('.hud')).toBeVisible()
    await expect(play).toBeVisible()
    await page.keyboard.down('s')
    await expect
      .poll(async () => {
        const p = await position(page)
        return Math.hypot(p.x - at.x, p.z - at.z)
      })
      .toBeGreaterThan(1)
    await page.keyboard.up('s')
  })

  for (const district of ['mi-road', 'malviya-nagar'])
    test(`${district} has a pitch too: "Play cricket" by it in English, and the game opens`, async ({
      page,
    }) => {
      await enterOffline(page, district, 'en')
      await toPitch(page)
      const play = page.getByRole('button', { name: 'Play cricket', exact: true })
      await expect(play).toBeVisible()
      const b = (await play.boundingBox())!
      expect.soft(b.height).toBeGreaterThanOrEqual(44)
      expect.soft(b.x + b.width).toBeLessThanOrEqual(PHONE.width - 10)
      await play.tap()
      const game = page.getByRole('dialog', { name: 'Gali cricket' })
      await expect(game).toBeVisible()
      await expect.poll(() => page.evaluate(() => window.__gg.cricket().active)).toBe(true)
      await shot(page, district)
      await expect(game.getByText('Runs: 0')).toBeVisible()
      await game.getByRole('button', { name: 'Stop playing' }).tap()
      await expect(game).toHaveCount(0)
    })
})

test('with keys: E by the pitch opens the game, Space swings, Escape leaves', async ({ page }) => {
  await enterOffline(page)
  const play = page.getByRole('button', { name: 'Cricket khelo', exact: true })
  const game = page.getByRole('dialog', { name: 'Gali cricket' })
  const { at } = await toPitch(page)
  await expect(play).toBeVisible()
  await expect(play).toHaveAttribute('aria-keyshortcuts', 'E')

  await page.keyboard.press('KeyE')
  await expect(game).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__gg.cricket().active)).toBe(true)
  await page.evaluate(() => {
    window.__gg.cricket().pause(true)
    window.__gg.cricket().tapAtBat()
  })
  await page.keyboard.press('Space')
  await expect.poll(() => page.evaluate(() => window.__gg.cricket().runs())).toBe(6)
  // E and M are the game's while it is up: no second game, no map
  await page.keyboard.press('KeyE')
  await page.keyboard.press('KeyM')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(game).toHaveCount(0)
  expect(await position(page)).toEqual(at)
  // the runs made before leaving are kept as the best
  expect(await page.evaluate(() => localStorage.getItem('gg-cricket-best'))).toBe('6')
  await expect(play).toBeVisible()

  // away from the pitch E opens nothing
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 8), at)
  await expect(play).toHaveCount(0)
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(300)
  await expect(game).toHaveCount(0)
})

test('reduced motion: the innings plays the same, with the flourish left out', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await enterOffline(page)
  await toPitch(page)
  await page.getByRole('button', { name: 'Cricket khelo', exact: true }).click()
  const game = page.getByRole('dialog', { name: 'Gali cricket' })
  await expect(game).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__gg.cricket().active)).toBe(true)
  await page.evaluate(() => {
    window.__gg.cricket().pause(true)
    window.__gg.cricket().ball(0)
  })
  const said = game.locator('.cricket-said')
  await expect(said).toContainText('Chhakka!')
  expect(await said.evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  // the view stays still on the six
  const a = await page.evaluate(() => window.__gg.cricket().eye())
  await page.waitForTimeout(150)
  expect(await page.evaluate(() => window.__gg.cricket().eye())).toEqual(a)
})
