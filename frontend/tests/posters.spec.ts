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
