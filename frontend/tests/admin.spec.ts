import { expect, test, type Page } from '@playwright/test'
import { closePeople, ghost, resident } from './support/people'

test.afterEach(closePeople)

const API = 'http://127.0.0.1:8787'

/** The dev token a signed-in page holds for its tab. */
const tokenOf = (page: Page) => page.evaluate(() => sessionStorage.getItem('gg-dev-token')!)

test('the owner sees a report another person filed, and bans the person it is about', async ({ browser }) => {
  const reporter = await resident(browser, 'Asha')
  const target = await resident(browser, 'Ravi')
  // Filed the way the report sheet files it: the server gathers the profile snapshot itself.
  const filed = await reporter.page.request.post(`${API}/api/reports`, {
    headers: { Authorization: `Bearer ${await tokenOf(reporter.page)}` },
    data: { kind: 'person', targetId: target.id, reason: 'harassment', note: 'e2e: baar baar message' },
  })
  expect(filed.status()).toBe(201)

  // Someone who is not the owner finds nothing at #/admin.
  await reporter.page.goto('/#/admin')
  await expect(reporter.page.getByText('Yahan kuch nahi hai.')).toBeVisible()

  // The owner signs in on the city page, as anyone does, then opens the console: on a phone.
  const owner = await ghost(browser, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  await owner.getByRole('button', { name: 'Dikhna hai? Login karo' }).click()
  await owner.getByLabel('Aapka naam').fill('Owner')
  await owner.getByRole('button', { name: 'Andar aao' }).click()
  // Signed in (no profile yet, so the sheet to make one opens): the tab holds a token now.
  await expect(owner.getByRole('dialog', { name: 'Apni pehchaan banao' })).toBeVisible()
  await owner.goto('/#/admin')
  await expect(owner.getByRole('heading', { name: 'Auto-hidden' })).toBeVisible()

  // The local D1 outlives a run, so older open reports may come first: page on until this one shows.
  const card = owner.locator('[data-report]').filter({ hasText: target.name })
  const more = owner.getByRole('button', { name: 'Aur dikhao' })
  await expect(owner.getByRole('heading', { name: 'Reports' })).toBeVisible()
  await expect(async () => {
    if (await more.isVisible()) await more.click()
    await expect(card).toBeVisible({ timeout: 1000 })
  }).toPass()
  await expect(card).toContainText('e2e: baar baar message')
  await expect(card).toContainText(reporter.name)
  await expect(card).toContainText('Report ke waqt ki profile')
  // One column on a phone: nothing runs off the side.
  expect(await owner.evaluate(() => document.querySelector('.admin')!.scrollWidth)).toBeLessThanOrEqual(390)
  if (process.env.GG_SHOT) await owner.screenshot({ path: process.env.GG_SHOT, fullPage: true })

  // A ban never happens on one tap: the sheet asks first.
  await card.getByRole('button', { name: 'Band + ban' }).click()
  await card.getByRole('alertdialog').getByRole('button', { name: 'Haan, ban karo' }).click()
  await expect(card).toHaveCount(0)

  // The banned person is told plainly, at once: their sockets closed with the ban, so the page asked again.
  await expect(target.page.getByText('Ye account band hai')).toBeVisible()
  // And after a reload too.
  await target.page.reload()
  await expect(target.page.getByText('Ye account band hai')).toBeVisible()
})
