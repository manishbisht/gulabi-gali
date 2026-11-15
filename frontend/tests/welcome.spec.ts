import { expect, test, type Page } from '@playwright/test'

/** A small phone, held upright. */
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

/** The welcome screen with `/api/count` saying `people` (a fixture: the real one depends on who is on). */
async function welcome(page: Page, people: number, path = '/?gg-test=1') {
  await page.route('**/api/count', (route) => route.fulfill({ json: { people } }))
  await page.goto(path)
}

/** In through a link, offline (as in city.spec.ts): a live district would pull a teleported player back. */
async function follow(page: Page, at: string) {
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await welcome(page, 0, `/?gg-test=1&at=${at}`)
  await page.getByRole('button', { name: 'Padharo!' }).tap()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
}

const district = (page: Page) =>
  page.evaluate(() => (window as unknown as { __gg: { district(): string } }).__gg.district())

test('the welcome screen says how many are in the lanes now, and when it is quiet', async ({ page }) => {
  await welcome(page, 25)
  const line = page.locator('.intro-count')
  await expect(line).toHaveText('25+ log abhi gali mein')
  await expect(line).toHaveAttribute('aria-live', 'polite')
  // it fits the small phone: no sideways scroll, and Padharo is still on screen below it
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  await expect(page.getByRole('button', { name: 'Padharo!' })).toBeInViewport()
  if (process.env.GG_WELCOME_SHOT) await page.screenshot({ path: process.env.GG_WELCOME_SHOT })
  await page.getByRole('button', { name: 'English: bhasha badlo' }).tap()
  await expect(line).toHaveText('25+ people in the lanes right now')

  await page.unrouteAll()
  await welcome(page, 0)
  // the language chosen above is kept across the reload
  await expect(line).toHaveText("It's quiet right now — be the first in")
  await page.getByRole('button', { name: 'हिन्दी: switch language' }).tap()
  await expect(line).toHaveText('Abhi shaant hai — pehle aao')
})

test('a link to a landmark opens its district there, after Padharo, with its card up; the link leaves the address bar', async ({
  page,
}) => {
  await follow(page, 'mi-road:albert-hall')
  expect(await district(page)).toBe('mi-road')
  const card = page.locator('section.landmark-card[aria-label="Albert Hall"]')
  await expect(card).toBeVisible()
  // and "Bulao" is on it, to send the link on
  await expect(card.getByRole('button', { name: 'Bulao: Albert Hall ka link bhejo' })).toBeVisible()
  expect(new URL(page.url()).searchParams.get('at')).toBeNull()
  expect(new URL(page.url()).searchParams.get('gg-test')).toBe('1')
})

for (const [kind, at, button] of [
  ['a tapri', 'walled-city:tapri-0', '.bench-button'],
  ['a poster wall', 'university:poster-0', '.poster-button'],
  ['the metro', 'malviya-nagar:metro', '.metro-button'],
] as const) {
  test(`a link to ${kind} stands you there, in reach`, async ({ page }) => {
    await follow(page, at)
    expect(await district(page)).toBe(at.split(':')[0])
    await expect(page.locator(button).first()).toBeVisible()
  })
}

test('a link to a place that is not there opens at the usual spawn', async ({ page }) => {
  await follow(page, 'walled-city:nowhere')
  expect(await district(page)).toBe('walled-city')
  const at = await page.evaluate(() =>
    (window as unknown as { __gg: { position(): { x: number; z: number } } }).__gg.position(),
  )
  // the Walled City's spawn, halfway up Johari Bazaar (see map.spec.ts)
  expect(at).toEqual({ x: 1.5, z: 44 })
})

test('"Bulao" on the map copies the link when there is no share sheet', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await follow(page, 'walled-city:nowhere')
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined }))
  await page.getByRole('button', { name: 'Naksha · Gulabi Shahar', exact: true }).tap()
  const map = page.getByRole('dialog', { name: 'Naksha · Gulabi Shahar' })
  await map.getByRole('button', { name: 'Bulao: Hawa Mahal ka link bhejo' }).tap()
  // every row's status line is there, empty; only the one pressed speaks
  await expect(map.getByRole('status').filter({ hasText: /\S/ })).toHaveText('Link copy ho gaya')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Gulabi Gali mein Hawa Mahal pe aao — yahin milte hain! https://gulabi-gali.manishbisht.me/?at=walled-city:hawa-mahal',
  )
})
