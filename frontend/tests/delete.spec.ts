import { expect, test } from '@playwright/test'
import { enterCity } from './support/city'

test('deleting your account signs you out, and the old profile is gone when you come back', async ({
  page,
}) => {
  const name = `Dina${Date.now() % 100000}`
  await enterCity(page)
  const signIn = async () => {
    await page.getByRole('button', { name: 'Dikhna hai? Login karo' }).click()
    await page.getByLabel('Aapka naam').fill(name)
    await page.getByRole('button', { name: 'Andar aao' }).click()
  }
  await signIn()
  const sheet = page.getByRole('dialog', { name: 'Apni pehchaan banao' })
  await sheet.getByLabel('Naam').fill(name)
  await sheet.getByLabel('Kaun si jagah se ho?').selectOption('Raja Park')
  await sheet.getByLabel('Main 18 saal ya usse bada/badi hoon').check()
  await sheet.getByLabel('Sab ki izzat karunga/karungi. Koi harassment, hate ya spam nahi.').check()
  await sheet.getByRole('button', { name: 'Save karo' }).click()
  await expect(page.getByText('Jaipur tumhe dekh sakta hai')).toBeVisible()

  // Open the profile again and delete: the button waits for DELETE, typed exactly.
  await page.locator('.profile-button').first().click()
  await sheet.getByRole('button', { name: 'Account delete karo' }).click()
  const go = sheet.getByRole('button', { name: 'Hamesha ke liye delete karo' })
  await expect(go).toBeDisabled()
  await sheet.getByLabel('Confirm karne ke liye DELETE likho').fill('delete')
  await expect(go).toBeDisabled()
  await sheet.getByLabel('Confirm karne ke liye DELETE likho').fill('DELETE')
  await go.click()

  // Back to a ghost, signed out.
  await expect(page.getByRole('button', { name: 'Dikhna hai? Login karo' })).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()

  // The same name signs in to a blank profile: the old one is gone.
  await signIn()
  const fresh = page.getByRole('dialog', { name: 'Apni pehchaan banao' })
  await expect(fresh).toBeVisible()
  await expect(fresh.getByLabel('Naam')).toHaveValue('')
})
