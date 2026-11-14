import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test'
import { enterCity } from './city'

/** A signed-in visitor with a finished profile, and the id the live socket knows them by. */
export interface Resident {
  page: Page
  id: string
  name: string
}

let made = 0
/** Contexts made here outlive a test unless closed: their sockets would keep people in the districts. */
const open: BrowserContext[] = []

async function newPage(browser: Browser, options?: BrowserContextOptions): Promise<Page> {
  const context = await browser.newContext(options)
  open.push(context)
  return context.newPage()
}

/** Closes every context these helpers opened: call it after each test. */
export async function closePeople() {
  await Promise.all(open.splice(0).map((c) => c.close()))
}

/** A visitor who never signs in, in the city. */
export async function ghost(browser: Browser, options?: BrowserContextOptions): Promise<Page> {
  const page = await newPage(browser, options)
  await enterCity(page)
  return page
}

/** The dev login's id for a name: `dev:` and the name's slug. */
const devId = (name: string) => `dev:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

/**
 * A new browser context, dev-logged in under a fresh name, profile finished: visible to everyone, unless
 * `visible` is false (a full city puts them in line instead, and this waits only for the profile to save).
 */
export async function resident(
  browser: Browser,
  first: string,
  options?: BrowserContextOptions,
  { visible = true }: { visible?: boolean } = {},
): Promise<Resident> {
  // Unique per run: the local D1 outlives the test run, and the live districts outlive a test.
  const name = `${first}${Date.now() % 100000}${made++}`
  const page = await ghost(browser, options)
  await page.getByRole('button', { name: 'Dikhna hai? Login karo' }).click()
  await page.getByLabel('Aapka naam').fill(name)
  await page.getByRole('button', { name: 'Andar aao' }).click()
  const sheet = page.getByRole('dialog', { name: 'Apni pehchaan banao' })
  await sheet.getByLabel('Naam').fill(name)
  await sheet.getByLabel('Kaun si jagah se ho?').selectOption('Raja Park')
  await sheet.getByLabel('Main 18 saal ya usse bada/badi hoon').check()
  await sheet.getByLabel('Sab ki izzat karunga/karungi. Koi harassment, hate ya spam nahi.').check()
  await sheet.getByRole('button', { name: 'Save karo' }).click()
  if (visible) await expect(page.getByText('Jaipur tumhe dekh sakta hai')).toBeVisible()
  else await expect(sheet).toBeHidden()
  return { page, id: devId(name), name }
}

/** Two residents in two browser contexts, both in the city and both visible. */
export async function twoPeople(browser: Browser): Promise<[Resident, Resident]> {
  return [await resident(browser, 'Asha'), await resident(browser, 'Ravi')]
}

/** The ids a page currently draws, sorted. */
export const seen = (page: Page) =>
  page.evaluate(() =>
    window.__gg
      .people()
      .map((p) => p.id)
      .sort(),
  )

/** Holds a movement key for `ms`: a real walk, which the server's speed check accepts. */
export async function walk(page: Page, key: string, ms: number) {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
}

/**
 * Moves the player to (x, z) in hops of at most 6 m, a little over a second apart: the server's speed check
 * lets a standing player cover 8 m at once, so each hop is accepted where one long teleport would be refused.
 */
export async function hopTo(page: Page, x: number, z: number) {
  for (;;) {
    const at = await page.evaluate(() => window.__gg.position())
    const d = Math.hypot(x - at.x, z - at.z)
    if (d < 0.01) return
    const k = Math.min(1, 6 / d)
    const to = { x: at.x + (x - at.x) * k, z: at.z + (z - at.z) * k }
    await page.evaluate(({ x, z }) => window.__gg.teleport(x, z), to)
    await page.waitForTimeout(1100)
  }
}

/**
 * Verifies a resident the way a person does: with an invite code, typed into the Invite sheet. A founder (and
 * their codes) comes from the Worker's DEV_AUTH-only `/api/dev/verify`, so no database is touched from here.
 */
export async function verify(page: Page): Promise<void> {
  const res = await page.request.post('http://127.0.0.1:8787/api/dev/verify', {
    data: { userId: `dev:founder-${Date.now() % 100000}-${made++}` },
  })
  expect(res.status()).toBe(200)
  const [code] = ((await res.json()) as { codes: string[] }).codes
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Invite code' })
  await sheet.getByLabel('Code (8 akshar)').fill(`${code!.slice(0, 4)}-${code!.slice(4).toLowerCase()}`)
  await sheet.getByRole('button', { name: 'Code lagao' }).click()
  await expect(sheet.getByText('Ho gaya, tum verified ho!')).toBeVisible()
  await expect(sheet.getByText('Tumhare codes')).toBeVisible()
  await sheet.getByRole('button', { name: 'Band karo' }).click()
}
