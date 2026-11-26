import { expect, test, type Page } from '@playwright/test'
import { closePeople, ghost, resident, walk } from './support/people'

test.afterEach(closePeople)

/** The emotes a page is playing: the player's own, and other people's by id. */
const playing = (page: Page) => page.evaluate(() => window.__gg.emoting())
const marks = (page: Page) => page.locator('.emote:not([hidden])')

/** Opens the wheel from its chip and picks the emote called `name`. */
async function emote(page: Page, name: string) {
  await page.getByRole('button', { name: 'Mood dikhao', exact: true }).click()
  await page
    .getByRole('group', { name: 'Mood dikhao' })
    .getByRole('button', { name, exact: true })
    .click()
}

test('one resident dances and the other sees it; sitting lasts until they walk on', async ({ browser }) => {
  const a = await resident(browser, 'Asha')
  const b = await resident(browser, 'Ravi')
  // they spawn together: A steps aside, and B's page sees her there
  await walk(a.page, 'd', 300)
  await expect.poll(() => b.page.evaluate((id) => window.__gg.people().some((p) => p.id === id), a.id)).toBe(true)
  await expect.poll(() => playing(b.page)).toEqual({ self: null, others: [] })

  // "Naacho": on her own avatar at once, and on B's screen over her
  await emote(a.page, 'Naacho')
  await expect.poll(() => playing(a.page)).toEqual({ self: 'dance', others: [] })
  await expect(marks(a.page)).toHaveText('✨')
  await expect.poll(() => playing(b.page)).toEqual({ self: null, others: [{ id: a.id, kind: 'dance' }] })
  await expect(marks(b.page)).toHaveText('✨')
  // the wheel shut itself, and nothing else opened on either side
  await expect(a.page.getByRole('group', { name: 'Mood dikhao' })).toBeHidden()
  await expect(b.page.locator('.reaction-toast')).toHaveCount(0)
  // it ends by itself, on both screens
  await expect.poll(() => playing(a.page), { timeout: 20_000 }).toEqual({ self: null, others: [] })
  await expect.poll(() => playing(b.page), { timeout: 20_000 }).toEqual({ self: null, others: [] })

  // "Baith jao" stays: seconds of play on, she is still sat on both screens
  await emote(a.page, 'Baith jao')
  await expect.poll(() => playing(b.page)).toEqual({ self: null, others: [{ id: a.id, kind: 'sit' }] })
  const from = await b.page.evaluate(() => window.__gg.gameTime())
  await expect.poll(() => b.page.evaluate(() => window.__gg.gameTime()), { timeout: 40_000 }).toBeGreaterThan(from + 5)
  expect(await playing(a.page)).toEqual({ self: 'sit', others: [] })
  expect(await playing(b.page)).toEqual({ self: null, others: [{ id: a.id, kind: 'sit' }] })
  // her next step stands her up everywhere: no other word is sent
  await walk(a.page, 'd', 300)
  await expect.poll(() => playing(a.page)).toEqual({ self: null, others: [] })
  await expect.poll(() => playing(b.page)).toEqual({ self: null, others: [] })
})

test("a ghost's emote is their own page's alone, and a ghost watching sees a resident's", async ({ browser }) => {
  const b = await resident(browser, 'Ravi')
  const watcher = await ghost(browser)
  // the ghost's page sees B on the street (B has stepped out, so the street lists him)
  await walk(b.page, 'd', 300)
  await expect.poll(() => watcher.evaluate((id) => window.__gg.people().some((p) => p.id === id), b.id)).toBe(true)

  // the ghost claps: it plays for them, and B is shown nothing
  await emote(watcher, 'Taali')
  await expect.poll(() => playing(watcher)).toEqual({ self: 'clap', others: [] })
  await expect(marks(watcher)).toHaveText('👏')
  // B waves next: once that has reached the ghost, the district has long since dealt with the clap
  await emote(b.page, 'Haath hilao')
  await expect.poll(() => playing(watcher).then((p) => p.others)).toEqual([{ id: b.id, kind: 'wave' }])
  expect((await playing(b.page)).others).toEqual([])
  await expect(marks(b.page)).toHaveCount(1) // his own wave, and nobody else's
  await expect(marks(b.page)).toHaveText('👋')
})

test('G opens the wheel and a number picks, a step ends the emote, and at the wheel of an auto there is no chip', async ({ page }) => {
  // offline, as in city.spec.ts: an emote needs no street
  await page.routeWebSocket(/\/api\/districts\/[^/]+\/live/, () => {})
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
  const chip = page.getByRole('button', { name: 'Mood dikhao', exact: true })
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('g')
  await expect(chip).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('4')
  await expect.poll(() => playing(page)).toEqual({ self: 'selfie', others: [] })
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await expect(marks(page)).toHaveText('🤳')
  // a step ends it
  await walk(page, 'w', 200)
  await expect.poll(() => playing(page)).toEqual({ self: null, others: [] })

  // at the wheel of the walled city's auto: the chip is gone, and G does nothing
  await page.evaluate(() => window.__gg.teleport(24, -2.5))
  await page.getByRole('button', { name: 'Auto chalao' }).click()
  await expect(page.getByRole('button', { name: 'Utro' })).toBeVisible()
  await expect(chip).toHaveCount(0)
  await page.keyboard.press('g')
  await expect(page.getByRole('group', { name: 'Mood dikhao' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Utro' }).click()
  await expect(chip).toBeVisible()
})
