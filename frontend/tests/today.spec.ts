import { expect, test, type Page } from '@playwright/test'
import { closePeople, resident } from './support/people'

/** A small phone, held upright. */
const PHONE = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
test.use(PHONE)
test.afterEach(closePeople)

const API = 'http://127.0.0.1:8787'
/** Today and yesterday on the IST calendar, as the page and the Worker reckon them. */
const istDay = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10)
const today = () => istDay(Date.now())
const yesterday = () => istDay(Date.now() - 24 * 3600_000)

/** In the city with `goal` standing in for the day's own (the test-only `gg-today`), offline or not. */
async function enter(page: Page, goal: string, extra = '') {
  await page.goto(`/?gg-test=1&gg-today=${goal}${extra}`)
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
}

/** Takes a photo in photo mode (saved as a download: this browser cannot share files) and comes back. */
async function photo(page: Page) {
  await page.locator('.photo-button').click()
  await Promise.all([page.waitForEvent('download'), page.locator('.photo-shutter').click()])
  await page.locator('.photo-exit').click()
}

test("a ghost's goal of the day: the chip and its sheet say it, a photo does it, the toast and the chip say so", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }),
  )
  // two days running already, so today's makes three: the stamps chip's accent comes on
  await page.addInitScript(
    (y) => localStorage.setItem('gg-today', JSON.stringify({ last: y, streak: 2, best: 2 })),
    yesterday(),
  )
  await page.goto('/?gg-test=1&gg-today=photo')
  // the welcome screen's one line, and Padharo still on the phone's screen below it
  await expect(page.locator('.intro-today')).toHaveText('Aaj ka Darshan: Photo mode mein ek photo khincho')
  await expect(page.getByRole('button', { name: 'Padharo!' })).toBeInViewport()
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)

  const chip = page.locator('.today-chip')
  await expect(chip).toHaveAccessibleName('Aaj ka Darshan')
  await expect(chip).toHaveAttribute('title', 'Aaj ka Darshan: Photo mode mein ek photo khincho')
  await expect(page.locator('.stamp-count')).not.toHaveAttribute('data-streak')
  await chip.click()
  const sheet = page.getByRole('dialog', { name: 'Aaj ka Darshan' })
  await expect(sheet).toContainText('Abhi baaki hai')
  await expect(sheet).toContainText('Lagataar 2 din · sabse lamba 2')
  await expect(sheet).toContainText('sirf is phone pe') // a ghost's count is this device's
  await sheet.getByRole('button', { name: 'Band karo' }).click()
  await expect(sheet).toBeHidden()

  await photo(page)
  await expect(page.locator('.today-toast')).toHaveText('Aaj ka Darshan ho gaya! Lagataar 3 din')
  await expect(chip).toHaveAccessibleName('Aaj ka Darshan ho gaya')
  await expect(chip).toHaveAttribute('title', 'Aaj ka Darshan ho gaya: Photo mode mein ek photo khincho')
  await expect(chip.locator('.today-tick')).toBeVisible()
  await expect(page.locator('.stamp-count')).toHaveAttribute('data-streak', '')
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('gg-today')))!)).toEqual({
    last: today(),
    streak: 3,
    best: 3,
  })
  // the toast goes by itself; a second photo is no second celebration
  await expect(page.locator('.today-toast')).toBeHidden({ timeout: 8000 })
  await photo(page)
  await expect(page.locator('.today-toast')).toHaveCount(0)

  // English, from the sheet
  await page.getByRole('button', { name: 'English: bhasha badlo' }).click()
  await chip.click()
  const en = page.getByRole('dialog', { name: "Today's Darshan" })
  await expect(en).toContainText('Done for today ✓')
  await expect(en).toContainText('3 days in a row · longest 3')
})

test('an emote day is done by any emote, alone and as a ghost; a taste day at a stall', async ({ page }) => {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await enter(page, 'emote')
  const chip = page.locator('.today-chip')
  await expect(chip).toHaveAttribute(
    'title',
    'Aaj ka Darshan: Mood dikhao: naacho, taali bajao ya haath hilao',
  )
  await page.getByRole('button', { name: 'Mood dikhao', exact: true }).click()
  await page.getByRole('group', { name: 'Mood dikhao' }).getByRole('button', { name: 'Haath hilao' }).click()
  await expect(page.locator('.today-toast')).toHaveText('Aaj ka Darshan ho gaya!')
  await expect(chip).toHaveAttribute('data-done', '')

  // another day, another goal: Johari Bazaar's tapri serves ghewar
  await page.evaluate(() => localStorage.removeItem('gg-today'))
  await enter(page, 'swaad')
  await expect(chip).toHaveAttribute('title', 'Aaj ka Darshan: Kisi tapri pe Jaipur ka koi swaad chakho')
  await expect(chip).not.toHaveAttribute('data-done')
  await page.evaluate(() => window.__gg.teleport(3.8, -40))
  await page.getByRole('button', { name: 'Chakho', exact: true }).click()
  await expect(page.locator('.today-toast')).toHaveText('Aaj ka Darshan ho gaya!')
  await expect(chip).toHaveAttribute('data-done', '')
})

for (const [lang, come, goal, line] of [
  [
    'hi',
    'Padharo!',
    'show',
    'Aaj ka Darshan: Gulabi Shahar, Amer, MI Road ya Nahargarh mein gali ka koi khel poora dekho',
  ],
  [
    'en',
    'Come in',
    'cricket',
    "Today's Darshan: Play an innings of gali cricket in Pink City, MI Road or Malviya Nagar",
  ],
] as const)
  test(`the longest goal (${lang}) says where on the welcome screen, and the way in is still on the phone's screen`, async ({
    page,
  }) => {
    await page.addInitScript((l) => localStorage.setItem('gg-lang', l), lang)
    await page.goto(`/?gg-test=1&gg-today=${goal}`)
    const intro = page.locator('.intro-today')
    await expect(intro).toHaveText(line)
    const box = (await intro.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(360)
    expect(await intro.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    await expect(page.getByRole('button', { name: come })).toBeInViewport({ ratio: 1 })
    // and the sheet says how
    await page.getByRole('button', { name: come }).click()
    await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
    await page.locator('.today-chip').click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toContainText(
      lang === 'hi' ? 'ravanhatta MI Road aur Nahargarh mein' : 'Any score counts',
    )
    const s = (await sheet.boundingBox())!
    expect(s.x + s.width).toBeLessThanOrEqual(360)
    expect(s.y + s.height).toBeLessThanOrEqual(740)
  })

test('a darshan day is done by reaching that landmark: a link straight to it does it, stamp or no stamp', async ({
  page,
}) => {
  // offline, as in welcome.spec.ts: a live district would pull the player back
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await enter(page, 'darshan:albert-hall', '&at=mi-road:albert-hall')
  await expect(page.locator('section.landmark-card[aria-label="Albert Hall"]')).toBeVisible()
  await expect(page.locator('.today-toast')).toHaveText('Aaj ka Darshan ho gaya!')
  await expect(page.locator('.today-chip')).toHaveAttribute('data-done', '')
})

test("a resident's day is the server's: it counts it, and another load (or phone) shows it done", async ({
  browser,
}) => {
  const asha = await resident(browser, 'Asha', PHONE)
  const { page } = asha
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }),
  )
  await enter(page, 'photo')
  const chip = page.locator('.today-chip')
  await expect(chip).toHaveAccessibleName('Aaj ka Darshan')
  await expect(chip).toHaveAttribute('title', 'Aaj ka Darshan: Photo mode mein ek photo khincho')
  await photo(page)
  await expect(page.locator('.today-toast')).toHaveText('Aaj ka Darshan ho gaya!')
  const token = await page.evaluate(() => sessionStorage.getItem('gg-dev-token')!)
  await expect
    .poll(async () => {
      const me = await page.request.get(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      return ((await me.json()) as { today?: unknown }).today
    })
    .toEqual({ last: today(), streak: 1, best: 1 })
  // nothing of hers is left as a ghost's record on the device
  expect(await page.evaluate(() => localStorage.getItem('gg-today'))).toBeNull()

  // the page cannot set its own count, nor mark another day
  const forged = await page.request.put(`${API}/api/me/today`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { day: istDay(Date.now() - 2 * 24 * 3600_000), streak: 40 },
  })
  expect(forged.status()).toBe(400)

  // a fresh load knows it from the server alone
  await page.evaluate(() => localStorage.clear())
  await enter(page, 'photo')
  await expect(chip).toHaveAttribute('data-done', '')
  await chip.click()
  await expect(page.getByRole('dialog', { name: 'Aaj ka Darshan' })).not.toContainText('sirf is phone pe')
})
