import { expect, test, type Page } from '@playwright/test'
import { closePeople, ghost, hopTo, resident, verify } from './support/people'

test.afterEach(closePeople)

/** The Pink City's poster wall on Johari Bazaar, at (-6, 48), its face to +x: 1.5 m in front of it. */
const BY_WALL = { x: -4.5, z: 48 }

/** The texts a page has up on its walls. */
const onWalls = (page: Page) => page.evaluate(() => window.__gg.posters().map((p) => p.text))

test('a verified member pins a plan, and another page sees it on the wall', async ({ browser }) => {
  const a = await resident(browser, 'Asha')
  await verify(a.page)
  // Someone just looking: a ghost, already in the district when the poster goes up.
  const b = await ghost(browser)
  await expect.poll(() => b.evaluate(() => window.__gg.liveState())).toBe('open')

  await hopTo(a.page, BY_WALL.x, BY_WALL.z)
  await a.page.getByRole('button', { name: 'Deewar pe chipkao' }).click()
  const composer = a.page.getByRole('region', { name: 'Deewar pe kya chipkana hai?' })
  const plan = `Chess at the Chaupar, Sunday ${Date.now() % 100000}`
  await composer.getByRole('textbox', { name: 'Tumhara plan' }).fill(plan)
  await composer.getByRole('button', { name: 'Chipkao' }).click()
  await expect(composer).toBeHidden()

  // Up on A's own wall at once, and on B's from the district's word, without a reload.
  await expect.poll(() => onWalls(a.page)).toContain(plan)
  await expect.poll(() => onWalls(b)).toContain(plan)
  const [poster] = await b.evaluate((text) => window.__gg.posters().filter((p) => p.text === text), plan)
  expect(poster).toMatchObject({ wall: 0 })

  // A fresh page fetches it with the walls: the list is public.
  const c = await ghost(browser)
  await expect.poll(() => onWalls(c)).toContain(plan)
})

test('Milte hain: a verified member says "Main aaunga"; everyone sees the count, only the owner the name', async ({
  browser,
}) => {
  const a = await resident(browser, 'Asha')
  await verify(a.page)
  const b = await resident(browser, 'Bina')
  await verify(b.page)

  await hopTo(a.page, BY_WALL.x, BY_WALL.z)
  await a.page.getByRole('button', { name: 'Deewar pe chipkao' }).click()
  const composer = a.page.getByRole('region', { name: 'Deewar pe kya chipkana hai?' })
  const plan = `Kite flying on the roof, Sunday ${Date.now() % 100000}`
  await composer.getByRole('textbox', { name: 'Tumhara plan' }).fill(plan)
  await composer.getByRole('button', { name: 'Chipkao' }).click()
  await expect(composer).toBeHidden()

  /** Taps the plan where it hangs on `page`'s screen, and answers its card. */
  const tapPlan = async (page: Page) => {
    await hopTo(page, BY_WALL.x, BY_WALL.z)
    await expect.poll(() => onWalls(page)).toContain(plan)
    const [at] = await page.evaluate((text) => window.__gg.posters().filter((p) => p.text === text), plan)
    await page.mouse.click(at!.sx, at!.sy)
    const card = page.getByRole('region', { name: 'Deewar ka poster' })
    await expect(card).toBeVisible()
    return card
  }

  const card = await tapPlan(b.page)
  await card.getByRole('button', { name: 'Main aaunga' }).click()
  await expect(card.getByText('Aane wale: 1')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Nahi aa paunga' })).toBeVisible()
  await expect(card).not.toContainText('Kaun aa raha hai')

  // A fresh signed-out page gets the count with the walls, never a name.
  const c = await ghost(browser)
  await expect
    .poll(() =>
      c.evaluate(async (text) => {
        const res = await fetch('http://127.0.0.1:8787/api/districts/walled-city/posters')
        const list = (await res.json()) as { text: string; going?: number }[]
        return list.find((p) => p.text === text)?.going ?? 0
      }, plan),
    )
    .toBe(1)

  // The owner alone sees who, by first name.
  const own = await tapPlan(a.page)
  await expect(own.getByText(`Kaun aa raha hai: ${b.name}`)).toBeVisible()
  await expect(own.getByText('Aane wale: 1')).toBeVisible()
  await expect(own.getByRole('button', { name: 'Main aaunga' })).toBeHidden()
})
