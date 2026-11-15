import { expect, test } from '@playwright/test'
import { closePeople, hopTo, resident } from './support/people'

test.afterEach(closePeople)

/** In front of Hawa Mahal, inside its stamp ring; and a spot down the road, outside it. */
const HAWA = { x: 36, z: -8 }
const OUTSIDE = { x: 36, z: 0 }

test("a stamp collected signed in shows on that person's card in another browser", async ({ browser }) => {
  test.setTimeout(150_000)
  const a = await resident(browser, 'Asha')
  const b = await resident(browser, 'Ravi')

  // B walks (hop by hop: the server refuses a teleport) to Hawa Mahal and collects its stamp
  await hopTo(b.page, HAWA.x, HAWA.z)
  await b.page.getByRole('button', { name: 'Stamp lo' }).click()
  await expect(b.page.locator('.stamp-count')).toHaveText('1/9')

  // both step out of the ring (a landmark card outranks a person's), side by side, and A opens B's card
  await Promise.all([hopTo(b.page, OUTSIDE.x, OUTSIDE.z), hopTo(a.page, OUTSIDE.x - 1.5, OUTSIDE.z)])
  await a.page.keyboard.press('e')
  const card = a.page.getByRole('region', { name: b.name })
  await expect(card.getByText('Jaipur Darshan · 1/9')).toBeVisible()
  await expect(card.getByRole('list', { name: 'Jaipur Darshan ke stamps' })).toHaveText('Hawa Mahal')
})
