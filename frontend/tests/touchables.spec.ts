import { expect, test, type Locator, type Page } from '@playwright/test'

/*
 * Things you can touch: the bell, the hand pump, the pigeons and the diyas, and the two kindnesses for a street
 * animal. The city is offline here (a live district would pull a teleported player back), the weather and the
 * sun's times are fixed (never the live ones), and the clock is the test's (`setNow`).
 */

/** The Walled City's touchables (districts/walledCity.ts). */
const PUMP = { x: 5.5, z: 46 }
const BELL = { x: -5.5, z: -28 }
const DIYAS = { x: 16, z: -23.5 }
const PIGEONS = { x: 36, z: 16 }
const SUN = { sunrise: '2026-11-20T01:15:00Z', sunset: '2026-11-20T12:05:00Z' }
const NOON = '2026-11-20T06:30:00Z'
const NIGHT = '2026-11-20T16:30:00Z'

async function enter(page: Page, opts: { district?: string; lang?: 'hi' | 'en' } = {}) {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.route('**/api/city*', (route) =>
    route.fulfill({
      json: {
        fetchedAt: NOON,
        tempC: 24,
        condition: 'clear',
        aqi: 60,
        aqiBand: 'moderate',
        ...SUN,
        festival: null,
        stale: false,
      },
    }),
  )
  await page.addInitScript(
    ({ district, lang }) => {
      // the monkey stays out of it
      localStorage.setItem('gg-no-bandar', '1')
      if (district) localStorage.setItem('gg-district', district)
      if (lang) localStorage.setItem('gg-lang', lang)
    },
    { district: opts.district, lang: opts.lang },
  )
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: opts.lang === 'en' ? 'Come in' : 'Padharo!' }).click()
  await page.waitForFunction(
    () => (window as { __gg?: { touchables?: unknown } }).__gg?.touchables !== undefined,
  )
  await page.evaluate((s) => window.__gg.setSnapshot(s), SUN)
  await page.evaluate((at) => window.__gg.setNow(at), NOON)
  await page.evaluate(() => window.__gg.freezeAnimals(true))
}

const thing = (page: Page, kind: string) =>
  page.evaluate((k) => window.__gg.touchables().find((t) => t.kind === k)!, kind)
const standBy = (page: Page, at: { x: number; z: number }, dx = 0, dz = 0) =>
  page.evaluate(({ x, z }) => window.__gg.teleport(x, z), { x: at.x + dx, z: at.z + dz })

test('the hand pump runs for a moment, and the bell rings once', async ({ page }) => {
  await enter(page)
  expect((await page.evaluate(() => window.__gg.touchables())).map((t) => t.kind).sort()).toEqual([
    'bell',
    'diyas',
    'pigeons',
    'pump',
  ])

  // the pump, a few steps from where the walk starts
  await standBy(page, PUMP, -1.6)
  await page.getByRole('button', { name: 'Paani chalao' }).click()
  await expect.poll(async () => (await thing(page, 'pump')).active).toBe(true)
  // the water stops by itself
  await expect.poll(async () => (await thing(page, 'pump')).active, { timeout: 20000 }).toBe(false)

  // the bell up Sireh Deori bazaar
  await standBy(page, BELL, 1.6)
  const ring = page.getByRole('button', { name: 'Ghanti bajao' })
  await ring.click()
  await expect.poll(async () => (await thing(page, 'bell')).active).toBe(true)
  // no count, no toast, no joke: the button is all there is
  await expect(page.locator('.toast')).toHaveCount(0)
  await ring.click() // a second press straight after is not an error, and not a second ring
  // walking away takes the prompt with it
  await standBy(page, BELL, 12)
  await expect(ring).toHaveCount(0)
})

test('E rings the bell', async ({ page }) => {
  await enter(page)
  await standBy(page, BELL, 1.6)
  await expect(page.getByRole('button', { name: 'Ghanti bajao' })).toBeVisible()
  await page.keyboard.press('e')
  await expect.poll(async () => (await thing(page, 'bell')).active).toBe(true)
})

test('the diyas can be lit only after sunset, and stay lit', async ({ page }) => {
  await enter(page)
  await standBy(page, DIYAS, 0, 1.6)
  const light = page.getByRole('button', { name: 'Diya jalao' })
  // by day there is nothing to press
  await expect(page.locator('.hud-actions button')).toHaveCount(0)
  await expect(light).toHaveCount(0)
  await page.evaluate((at) => window.__gg.setNow(at), NIGHT)
  await light.click()
  await expect.poll(async () => (await thing(page, 'diyas')).lit).toBe(1)
  await light.click()
  await expect.poll(async () => (await thing(page, 'diyas')).lit).toBe(2)
  // morning: the two burn on, and the prompt is gone
  await page.evaluate((at) => window.__gg.setNow(at), NOON)
  await expect(light).toHaveCount(0)
  expect((await thing(page, 'diyas')).lit).toBe(2)
})

test('the pigeons across from Hawa Mahal go up when walked into, and settle again', async ({ page }) => {
  await enter(page)
  expect((await thing(page, 'pigeons')).active).toBe(false)
  await standBy(page, PIGEONS, 1)
  await expect.poll(async () => (await thing(page, 'pigeons')).active).toBe(true)
  // nothing to press: they answer to being walked into
  await expect(page.locator('.hud-actions button')).toHaveCount(0)
  // one wheel round the square is seven seconds of play (slower where frames are clamped)
  await expect.poll(async () => (await thing(page, 'pigeons')).active, { timeout: 40000 }).toBe(false)
})

// ---- on a small phone ---------------------------------------------------------------------------------

const PHONE = { width: 360, height: 740 }
/** CI's fonts run a few px wider than macOS's: this much is kept free at the right edge. */
const SLACK = 10

/** Each item whole on the screen (with `SLACK` to spare on the right), a thumb's size, and none on another. */
async function fits(items: Record<string, Locator>) {
  for (const item of Object.values(items)) await expect(item).toBeVisible()
  const boxes = await Promise.all(
    Object.entries(items).map(async ([k, l]) => [k, (await l.boundingBox())!] as const),
  )
  for (const [k, b] of boxes) {
    expect.soft(b.x, `${k} left`).toBeGreaterThanOrEqual(0)
    expect.soft(b.x + b.width, `${k} right`).toBeLessThanOrEqual(PHONE.width - SLACK)
    expect.soft(b.y + b.height, `${k} bottom`).toBeLessThanOrEqual(PHONE.height)
    expect.soft(Math.min(b.width, b.height), `${k} is a thumb's size`).toBeGreaterThanOrEqual(44)
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [ka, a] = boxes[i]!
      const [kb, b] = boxes[j]!
      const apart =
        a.x + a.width <= b.x + 0.5 ||
        b.x + b.width <= a.x + 0.5 ||
        a.y + a.height <= b.y + 0.5 ||
        b.y + b.height <= a.y + 0.5
      expect.soft(apart, `${ka} overlaps ${kb}`).toBe(true)
    }
}

test.describe('on a small phone', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  const COPY = {
    hi: {
      call: 'Saath chalo',
      pet: 'Pyaar karo',
      greet: 'Gaay ko namaste',
      feed: 'Roti khilao',
      bell: 'Ghanti bajao',
    },
    en: {
      call: 'Come along',
      pet: 'Pet',
      greet: 'Greet the cow',
      feed: 'Feed a roti',
      bell: 'Ring the bell',
    },
  } as const

  for (const lang of ['hi', 'en'] as const) {
    test(`a dog's two buttons and the bell's one fit beside the joystick (${lang}); a pat puts an emote over it`, async ({
      page,
    }) => {
      await enter(page, { lang })
      const joystick = page.locator('.joystick')
      const dog = await page.evaluate(() => window.__gg.animals().find((a) => a.id === 'walled-city-dog-0')!)
      await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 1.6), dog)
      const call = page.getByRole('button', { name: COPY[lang].call, exact: true })
      const pet = page.getByRole('button', { name: COPY[lang].pet, exact: true })
      await fits({ joystick, call, pet })
      await pet.tap()
      await expect.poll(() => page.evaluate(() => window.__gg.petEmote())).toBe('walled-city-dog-0')
      await expect(page.locator('.pet-emote')).toHaveText('❤️')
      // petted, not called: it stays where it lives
      expect(
        await page.evaluate(() => window.__gg.animals().find((a) => a.id === 'walled-city-dog-0')!.following),
      ).toBe(false)
      // and "Saath chalo" still calls it
      await call.tap()
      await expect
        .poll(() =>
          page.evaluate(() => window.__gg.animals().find((a) => a.id === 'walled-city-dog-0')!.following),
        )
        .toBe(true)

      await standBy(page, BELL, 1.6)
      await fits({ joystick, bell: page.getByRole('button', { name: COPY[lang].bell, exact: true }) })
    })

    test(`the cow's two buttons fit beside the joystick (${lang}); a roti, and a line says she has it`, async ({
      page,
    }) => {
      // MI Road's cow stands on the walk before Albert Hall, outside every landmark's ring
      await enter(page, { district: 'mi-road', lang })
      const cow = await page.evaluate(() => window.__gg.animals().find((a) => a.kind === 'cow')!)
      await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 1.8), cow)
      const greet = page.getByRole('button', { name: COPY[lang].greet, exact: true })
      const feed = page.getByRole('button', { name: COPY[lang].feed, exact: true })
      await fits({ joystick: page.locator('.joystick'), greet, feed })
      await feed.tap()
      await expect(page.locator('.toast')).toHaveText(
        lang === 'hi'
          ? 'Gaay mata ne roti le li, ab aaraam se jugaali kar rahi hain'
          : 'The cow took the roti and is chewing it over, unhurried',
      )
    })
  }
})
