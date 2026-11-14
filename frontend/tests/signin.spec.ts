import { expect, test } from '@playwright/test'
import { enterCity } from './support/city'

test('signs in by name against the dev login and keeps the token for the tab', async ({ page }) => {
  await enterCity(page)
  await page.getByRole('button', { name: 'Dikhna hai? Login karo' }).click()
  await page.getByLabel('Aapka naam').fill('Asha')
  await page.getByRole('button', { name: 'Andar aao' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Dikhna hai? Login karo' })).toBeHidden()
  expect(await page.evaluate(() => sessionStorage.getItem('gg-dev-token'))).toBeTruthy()
})
