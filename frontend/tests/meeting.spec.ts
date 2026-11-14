import { expect, test, type Locator } from '@playwright/test'
import { closePeople, hopTo, resident, walk } from './support/people'

test.afterEach(closePeople)

/** The Walled City's tapri by Johari Bazaar, at (-5.6, 36), its counter facing east. */
const TAPRI = { x: -5.6, z: 36 }

/** Two boxes on the page that do not overlap. */
async function apart(a: Locator, b: Locator) {
  const [p, q] = [(await a.boundingBox())!, (await b.boundingBox())!]
  return p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y
}

test('two residents sit at the same tapri, and what one says the other reads', async ({ browser }) => {
  const a = await resident(browser, 'Asha')
  // B is on a phone: the bench panel has to leave the joystick free
  const b = await resident(browser, 'Ravi', {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  await hopTo(a.page, TAPRI.x + 2.2, TAPRI.z + 0.5)
  await hopTo(b.page, TAPRI.x + 2.2, TAPRI.z - 0.5)

  await a.page.getByRole('button', { name: 'Baitho' }).click()
  const atA = a.page.getByRole('region', { name: 'Tapri pe' })
  await expect(atA).toContainText('Abhi yahan sirf tum ho.')
  await b.page.getByRole('button', { name: 'Baitho' }).click()
  const atB = b.page.getByRole('region', { name: 'Tapri pe' })
  await expect(atB).toContainText(`Saath mein: ${a.name}`)
  await expect(atA).toContainText(`Saath mein: ${b.name}`)
  await expect(atB).toContainText('Jo is bench pe baithe hain wahi padh sakte hain. Kuch save nahi hota.')
  await expect(b.page.getByRole('group', { name: 'Chalne ka joystick' })).toBeVisible()
  expect(await apart(atB, b.page.getByRole('group', { name: 'Chalne ka joystick' }))).toBe(true)

  await atA.getByRole('textbox', { name: 'Bench pe kuch kaho' }).fill('chai peeoge?')
  await atA.getByRole('textbox', { name: 'Bench pe kuch kaho' }).press('Enter')
  await expect(atB).toContainText(`${a.name} chai peeoge?`)
  await expect(atA).toContainText('Tum chai peeoge?')

  // Utho: B gets up, and A is alone on the bench again
  await atB.getByRole('button', { name: 'Utho' }).click()
  await expect(atB).toBeHidden()
  await expect(atA).toContainText('Abhi yahan sirf tum ho.')
})

test('request, accept, chat, unmatch', async ({ browser }) => {
  const a = await resident(browser, 'Asha')
  const b = await resident(browser, 'Ravi')
  const reason = 'Chai pe chalein? JKK open mic ke baad'

  // A walks up to B (they spawn together) and opens B's card with E
  await walk(a.page, 'd', 300)
  await a.page.keyboard.press('e')
  const card = a.page.getByRole('region', { name: b.name })
  await card.getByRole('button', { name: 'Milna hai' }).click()
  await a.page.getByRole('textbox', { name: 'Aapki baat' }).fill(reason)
  await a.page.getByRole('button', { name: 'Bhejo' }).click()
  await expect(a.page.getByText('Bhej diya!')).toBeVisible()

  // B sees the badge, reads the note, says yes
  const bOpen = b.page.getByRole('button', { name: /Mulaqaatein/ })
  await expect(bOpen.getByLabel('1 naye')).toBeVisible()
  await bOpen.click()
  const sheetB = b.page.getByRole('dialog', { name: 'Aapki mulaqaatein' })
  await expect(sheetB).toContainText(reason)
  await expect(bOpen.getByLabel('1 naye')).toBeHidden()
  await sheetB.getByRole('button', { name: 'Haan' }).click()
  await sheetB.getByRole('button', { name: new RegExp(a.name) }).click()

  // both exchange a message
  await sheetB.getByRole('textbox', { name: 'Chat mein likho' }).fill('Haan, chalo!')
  await sheetB.getByRole('button', { name: 'Bhejo' }).click()
  await expect(sheetB.getByText('Haan, chalo!')).toBeVisible()
  await a.page.getByRole('button', { name: /Mulaqaatein/ }).click()
  const sheetA = a.page.getByRole('dialog', { name: 'Aapki mulaqaatein' })
  await sheetA.getByRole('tab', { name: /Baatein/ }).click()
  await sheetA.getByRole('button', { name: new RegExp(b.name) }).click()
  await expect(sheetA.getByText('Haan, chalo!')).toBeVisible()
  await sheetA.getByRole('textbox', { name: 'Chat mein likho' }).fill('JKK ke gate pe milte hain')
  await sheetA.getByRole('button', { name: 'Bhejo' }).click()
  await expect(sheetB.getByText('JKK ke gate pe milte hain')).toBeVisible()

  // A unmatches (in the sheet, not a native dialog); B's chat disappears
  await sheetA.getByRole('button', { name: 'Unmatch' }).click()
  await sheetA.getByRole('button', { name: 'Haan, unmatch karo' }).click()
  await expect(sheetA.getByText('Abhi koi baat nahi')).toBeVisible()
  await expect(sheetA.getByText(b.name)).toBeHidden()
  await expect(sheetB.getByText('Abhi koi baat nahi')).toBeVisible()
  await expect(sheetB.getByText(a.name)).toBeHidden()
})
