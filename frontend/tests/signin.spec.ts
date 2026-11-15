import { expect, test } from '@playwright/test'
import { enterCity } from './support/city'

test('signs in by name against the dev login and keeps the token for the tab', async ({ page }) => {
  await enterCity(page)
  await page.getByRole('button', { name: 'Dikhna hai? Login karo' }).click()
  await page.getByLabel('Aapka naam').fill('Asha')
  await page.getByRole('button', { name: 'Andar aao' }).click()
  await expect(page.getByRole('dialog', { name: 'Gali mein apni jagah banao' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Dikhna hai? Login karo' })).toBeHidden()
  expect(await page.evaluate(() => sessionStorage.getItem('gg-dev-token'))).toBeTruthy()
})

test('the sign-in sheet keeps Tab inside, closes on Escape, and returns focus to the button that opened it', async ({
  page,
}) => {
  await enterCity(page)
  const opener = page.getByRole('button', { name: 'Dikhna hai? Login karo' })
  await opener.click()
  const sheet = page.getByRole('dialog', { name: 'Gali mein apni jagah banao' })
  await expect(sheet).toBeFocused()
  // more Tabs than the sheet has controls: focus never leaves it
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    expect(await sheet.evaluate((s) => s.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(opener).toBeFocused()
})
