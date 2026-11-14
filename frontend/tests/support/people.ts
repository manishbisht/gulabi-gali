import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
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

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext()
  open.push(context)
  return context.newPage()
}

/** Closes every context these helpers opened: call it after each test. */
export async function closePeople() {
  await Promise.all(open.splice(0).map((c) => c.close()))
}

/** A visitor who never signs in, in the city. */
export async function ghost(browser: Browser): Promise<Page> {
  const page = await newPage(browser)
  await enterCity(page)
  return page
}

/** The dev login's id for a name: `dev:` and the name's slug. */
const devId = (name: string) => `dev:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

/** A new browser context, dev-logged in under a fresh name, profile finished: visible to everyone. */
export async function resident(browser: Browser, first: string): Promise<Resident> {
  // Unique per run: the local D1 outlives the test run, and the live districts outlive a test.
  const name = `${first}${Date.now() % 100000}${made++}`
  const page = await ghost(browser)
  await page.getByRole('button', { name: 'Dikhna hai? Login karo' }).click()
  await page.getByLabel('Aapka naam').fill(name)
  await page.getByRole('button', { name: 'Andar aao' }).click()
  const sheet = page.getByRole('dialog', { name: 'Apni pehchaan banao' })
  await sheet.getByLabel('Naam').fill(name)
  await sheet.getByLabel('Kaun si jagah se ho?').selectOption('Raja Park')
  await sheet.getByLabel('Main 18 saal ya usse bada/badi hoon').check()
  await sheet.getByLabel('Sab ki izzat karunga/karungi. Koi harassment, hate ya spam nahi.').check()
  await sheet.getByRole('button', { name: 'Save karo' }).click()
  await expect(page.getByText('Jaipur tumhe dekh sakta hai')).toBeVisible()
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
