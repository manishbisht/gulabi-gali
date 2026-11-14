import { expect, test, type Locator } from '@playwright/test'
import { closePeople, hopTo, resident, verify, walk } from './support/people'

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
  await expect(atB).toContainText(
    'Jo is bench pe baithe hain wahi padh sakte hain. Report hone par moderator haal ki baatein dekh sakta hai.',
  )
  await expect(b.page.getByRole('group', { name: 'Chalne ka joystick' })).toBeVisible()
  expect(await apart(atB, b.page.getByRole('group', { name: 'Chalne ka joystick' }))).toBe(true)

  await atA.getByRole('textbox', { name: 'Bench pe kuch kaho' }).fill('chai peeoge?')
  await atA.getByRole('textbox', { name: 'Bench pe kuch kaho' }).press('Enter')
  await expect(atB).toContainText(`${a.name} chai peeoge?`)
  await expect(atA).toContainText('Tum chai peeoge?')

  // B reports A's line, in the panel: the server takes the bench's last minutes from its own memory
  await atB.getByRole('button', { name: `Report karo: ${a.name}` }).click()
  const form = atB.getByRole('dialog', { name: `${a.name} ki report` })
  await form.getByRole('button', { name: 'Spam' }).click()
  await form.getByRole('button', { name: 'Report bhejo' }).click()
  await expect(form).toContainText('Shukriya! Moderator isse khud dekhenge.')
  await form.getByRole('button', { name: 'Theek hai' }).click()
  await expect(form).toBeHidden()

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
  // not verified yet: "Milna hai" is off, and the card points at the invite code
  await expect(card.getByRole('button', { name: 'Milna hai' })).toBeDisabled()
  await expect(card.getByRole('button', { name: 'Invite code se verified bano' })).toBeVisible()
  await a.page.keyboard.press('e') // close the card
  await verify(a.page)
  await a.page.keyboard.press('e')
  await expect(card.getByRole('button', { name: 'Milna hai' })).toBeEnabled()
  await expect(card.getByRole('button', { name: 'Invite code se verified bano' })).toBeHidden()
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

  // A unmatches (in the sheet, not a native dialog); B's open chat says it has ended (and can still be
  // reported), then is gone from the chats, kept only under "Khatam baat-cheet"
  await sheetA.getByRole('button', { name: 'Aur', exact: true }).click()
  await sheetA.getByRole('button', { name: 'Unmatch' }).click()
  await sheetA.getByRole('button', { name: 'Haan, unmatch karo' }).click()
  await expect(sheetA.getByText('Abhi koi baat nahi')).toBeVisible()
  await expect(sheetA.locator('.conn-chat', { hasText: b.name })).toBeHidden()
  await expect(sheetA.getByRole('region', { name: 'Khatam baat-cheet' })).toContainText(b.name)
  await expect(sheetB.getByText('Ye baat-cheet khatam ho gayi')).toBeVisible()
  await expect(sheetB.getByRole('button', { name: 'Report karo', exact: true })).toBeVisible()
  await expect(sheetB.getByRole('textbox', { name: 'Chat mein likho' })).toBeHidden()
  await sheetB.getByRole('button', { name: 'Wapas' }).click()
  await expect(sheetB.getByText('Abhi koi baat nahi')).toBeVisible()
  await expect(sheetB.locator('.conn-chat', { hasText: a.name })).toBeHidden()
  await expect(sheetB.getByRole('region', { name: 'Khatam baat-cheet' })).toContainText(a.name)
})

test('B blocks A mid-chat, and A still reports the chat from "Ended chats"', async ({ browser }) => {
  const a = await resident(browser, 'Asha')
  const b = await resident(browser, 'Ravi')

  // A asks, B says yes, and B writes something A will want to report
  await verify(a.page)
  await walk(a.page, 'd', 300)
  await a.page.keyboard.press('e')
  const card = a.page.getByRole('region', { name: b.name })
  await card.getByRole('button', { name: 'Milna hai' }).click()
  await a.page.getByRole('textbox', { name: 'Aapki baat' }).fill('Chai pe chalein? JKK open mic ke baad')
  await a.page.getByRole('button', { name: 'Bhejo' }).click()
  await expect(a.page.getByText('Bhej diya!')).toBeVisible()
  await b.page.getByRole('button', { name: /Mulaqaatein/ }).click()
  const sheetB = b.page.getByRole('dialog', { name: 'Aapki mulaqaatein' })
  await sheetB.getByRole('button', { name: 'Haan' }).click()
  await sheetB.getByRole('button', { name: new RegExp(a.name) }).click()
  await sheetB.getByRole('textbox', { name: 'Chat mein likho' }).fill('tum kahan rehti ho? batao')
  await sheetB.getByRole('button', { name: 'Bhejo' }).click()
  await expect(sheetB.getByText('tum kahan rehti ho? batao')).toBeVisible()

  // B blocks A from the chat: A is told nothing, and the chat is gone from A's list
  await sheetB.getByRole('button', { name: 'Aur', exact: true }).click()
  await sheetB.getByRole('button', { name: 'Block karo' }).click()
  await sheetB.getByRole('button', { name: 'Haan, block karo' }).click()
  await expect(sheetB.getByText('Abhi koi baat nahi')).toBeVisible()

  // A opens Mulaqaatein: the chat is under "Khatam baat-cheet", and can be reported from there
  await a.page.getByRole('button', { name: /Mulaqaatein/ }).click()
  const sheetA = a.page.getByRole('dialog', { name: 'Aapki mulaqaatein' })
  await sheetA.getByRole('tab', { name: /Baatein/ }).click()
  const endedA = sheetA.getByRole('region', { name: 'Khatam baat-cheet' })
  await expect(endedA).toContainText(b.name)
  await endedA.getByRole('button', { name: `Report karo: ${b.name}` }).click()
  const form = sheetA.getByRole('dialog', { name: `${b.name} ki report` })
  await form.getByRole('button', { name: 'Pareshan kar raha/rahi hai' }).click()
  await form.getByRole('button', { name: 'Report bhejo' }).click()
  await expect(form).toContainText('Shukriya! Moderator isse khud dekhenge.')
})
