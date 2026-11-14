import { expect, test, type Locator } from '@playwright/test'
import { closePeople, hopTo, resident } from './support/people'

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
