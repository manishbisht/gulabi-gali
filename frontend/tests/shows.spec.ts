import { expect, test, type Locator, type Page } from '@playwright/test'

/** A small phone, held upright. */
const PHONE = { width: 360, height: 740 }
test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

const SUNSET = '2026-11-15T12:10:00Z'

/**
 * Opens the city offline (a live district would pull a teleported player back), in `district` if given, on a
 * fixed clear day at noon: the dancers' hours must not depend on when the run happens.
 */
async function enterOffline(page: Page, district?: string, lang?: 'en', path = '/') {
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
        sunset: SUNSET,
        festival: null,
        stale: false,
      },
    }),
  )
  if (district) await page.addInitScript((d) => localStorage.setItem('gg-district', d), district)
  if (lang) await page.addInitScript((l) => localStorage.setItem('gg-lang', l), lang)
  // a run that takes pictures (`GG_SHOWS_SHOTS`, a directory) asks for the full picture
  await page.goto(`${path}?gg-test=1${process.env.GG_SHOWS_SHOTS ? '&gg-full=1' : ''}`)
  await page.getByRole('button', { name: lang ? 'Come in' : 'Padharo!' }).click()
  await page.waitForFunction(
    () => typeof (window as { __gg?: { shows?: unknown } }).__gg?.shows === 'function',
  )
  await page.evaluate(() => window.__gg.setNow('2026-11-15T06:30:00Z'))
}

const shot = (page: Page, name: string) =>
  process.env.GG_SHOWS_SHOTS
    ? page.screenshot({ path: `${process.env.GG_SHOWS_SHOTS}/${name}.png` })
    : undefined

const show = (page: Page, kind: string) =>
  page.evaluate((k) => window.__gg.shows().find((s) => s.kind === k), kind)

/** The whole of `what` is on the phone's screen, once it has come to rest (a card slides up into place). */
async function onScreen(what: Locator, name: string) {
  await what.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
  const box = (await what.boundingBox())!
  expect(box, name).not.toBeNull()
  expect.soft(box.x, `${name} left`).toBeGreaterThanOrEqual(0)
  expect.soft(box.y, `${name} top`).toBeGreaterThanOrEqual(0)
  expect.soft(box.x + box.width, `${name} right`).toBeLessThanOrEqual(PHONE.width)
  expect.soft(box.y + box.height, `${name} bottom`).toBeLessThanOrEqual(PHONE.height)
  return box
}

test('the kathputli stage by Hawa Mahal: walk up, it plays, its card once, clap, and it ends', async ({
  page,
}) => {
  await enterOffline(page)
  // the chunk arrives and the stage is out, idle, in three draw calls
  await expect.poll(() => show(page, 'kathputli')).toMatchObject({ out: true, phase: 'idle', calls: 3 })
  const stage = (await show(page, 'kathputli'))!
  // where the walk starts, nothing of it shows
  await expect(page.getByRole('button', { name: 'Taali bajao' })).toHaveCount(0)

  // in front of it, where its audience stands
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 4.2), stage)
  await expect.poll(async () => (await show(page, 'kathputli'))!.phase).toBe('playing')

  // the first time, a card about the craft, with the clap on it
  const card = page.getByRole('region', { name: 'Kathputli ka khel' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Bhat samaj')
  await onScreen(card, 'card')
  const clapOnCard = card.getByRole('button', { name: 'Taali bajao' })
  expect((await onScreen(clapOnCard, 'card clap')).height).toBeGreaterThanOrEqual(44)
  await shot(page, 'kathputli-card')
  await clapOnCard.tap()
  await card.getByRole('button', { name: 'Band karo' }).tap()
  await expect(card).toBeHidden()

  // without the card, the clap is one of the street's buttons, thumb-sized and on the screen
  const clap = page.getByRole('button', { name: 'Taali bajao' })
  await expect(clap).toBeVisible()
  const box = await onScreen(clap, 'clap')
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.width).toBeGreaterThanOrEqual(44)
  await clap.tap()
  await shot(page, 'kathputli-clap')

  // watched to its end (the hook moves it on: a slow machine need not sit through it)
  await page.evaluate(() => window.__gg.showSkip(60))
  await expect.poll(async () => (await show(page, 'kathputli'))!.phase).toBe('after')
  await expect(clap).toBeVisible() // the end is when people clap

  // walking off: the button goes, the stage settles back to idle
  await page.evaluate(() => window.__gg.teleport(1.5, 44))
  await expect(clap).toHaveCount(0)
  await expect.poll(async () => (await show(page, 'kathputli'))!.phase, { timeout: 30000 }).toBe('idle')

  // a second visit plays again, and the card does not come back
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 4.2), stage)
  await expect.poll(async () => (await show(page, 'kathputli'))!.phase).toBe('playing')
  await expect(clap).toBeVisible()
  await expect(card).toHaveCount(0)
})

test('the map lists the show with its mask, and picking it points the compass there', async ({ page }) => {
  await enterOffline(page, undefined, 'en')
  await page.getByRole('button', { name: 'Map · Pink City', exact: true }).tap()
  const map = page.getByRole('dialog', { name: 'Map · Pink City' })
  await expect(map.locator('.map-item[data-kind="show"]')).toHaveAccessibleName('Kathputli puppet show')
  const row = map.locator('.map-list:not(.map-more-list) button[data-kind="show"]')
  await expect(row).toContainText(/🎭 Kathputli puppet show · \d+ m/)
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await row.tap()
  await expect(map).toBeHidden()
  await expect(page.getByRole('button', { name: /^Kathputli puppet show · \d+ m/ })).toBeVisible()
})

test('a link to a show stands you before it, and it plays', async ({ page }) => {
  await enterOffline(page, undefined, undefined, '/p/nahargarh/show-ravanhatta/')
  expect(await page.evaluate(() => window.__gg.district())).toBe('nahargarh')
  await expect.poll(async () => (await show(page, 'ravanhatta'))?.phase).toBe('playing')
  const at = (await show(page, 'ravanhatta'))!
  const me = await page.evaluate(() => window.__gg.position())
  expect(Math.hypot(me.x - at.x, me.z - at.z)).toBeLessThan(4)
  await expect(page.getByRole('region', { name: 'Ravanhatta ki dhun' })).toBeVisible()
  await shot(page, 'ravanhatta')
})

test('the dancers at the arts centre come out only in the evening', async ({ page }) => {
  await enterOffline(page, 'university')
  await expect.poll(() => show(page, 'dancers')).toMatchObject({ out: false, phase: 'idle', calls: 0 })
  const at = (await show(page, 'dancers'))!
  // at noon their ground is empty: standing on it starts nothing
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 6), at)
  await expect(page.getByRole('button', { name: 'Taali bajao' })).toHaveCount(0)
  // half an hour before sunset they are there, in four draw calls at most, and dance for whoever is near
  await page.evaluate(() => window.__gg.setNow('2026-11-15T11:40:00Z'))
  await expect.poll(async () => (await show(page, 'dancers'))!.out, { timeout: 45000 }).toBe(true)
  expect((await show(page, 'dancers'))!.calls).toBeLessThanOrEqual(4)
  await expect.poll(async () => (await show(page, 'dancers'))!.phase).toBe('playing')
  const card = page.getByRole('region', { name: 'Kalbelia-style naach (shaam ko)' })
  await expect(card).toContainText('UNESCO')
  await onScreen(card, 'card')
  await card.getByRole('button', { name: 'Band karo' }).tap()
  await shot(page, 'dancers')
})
