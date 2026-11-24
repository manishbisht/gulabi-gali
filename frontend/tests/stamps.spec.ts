import { expect, test } from '@playwright/test'
import { closePeople, hopTo, resident } from './support/people'

test.afterEach(closePeople)

/** In front of Hawa Mahal, inside its stamp ring; and a spot down the road, outside it. */
const HAWA = { x: 36, z: -8 }
const OUTSIDE = { x: 36, z: 0 }

test("a stamp collected signed in shows on that person's card in another browser", async ({ browser }) => {
  // two people each walking ~10 hops of 1.1 s: the long budget is for the walking, not for any wait below
  test.setTimeout(150_000)
  const a = await resident(browser, 'Asha')
  const b = await resident(browser, 'Ravi')

  // B walks (hop by hop: the server refuses a teleport) to Hawa Mahal and collects its stamp
  await hopTo(b.page, HAWA.x, HAWA.z)
  // the stamp reaches the server in a PUT: wait for its answer, so A reads a card that is already up to date
  const saved = b.page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/me/stamps' && r.request().method() === 'PUT',
  )
  await b.page.getByRole('button', { name: 'Stamp lo' }).click()
  await expect(b.page.locator('.stamp-count')).toHaveText('1/11')
  expect((await saved).status()).toBe(200)

  // both step out of the ring (a landmark card outranks a person's), side by side, and A opens B's card
  await Promise.all([hopTo(b.page, OUTSIDE.x, OUTSIDE.z), hopTo(a.page, OUTSIDE.x - 1.5, OUTSIDE.z)])
  await a.page.keyboard.press('e')
  const card = a.page.getByRole('region', { name: b.name })
  await expect(card.getByText('Jaipur Darshan · 1/11')).toBeVisible()
  await expect(card.getByRole('list', { name: 'Jaipur Darshan ke stamps' })).toHaveText('Hawa Mahal')
})
