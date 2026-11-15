import { expect, test } from '@playwright/test'
import { enterCity } from './support/city'

test('a new resident fills the profile, becomes visible, and the sheet stays shut on reload', async ({
  page,
}) => {
  // Unique per run: the local D1 outlives the test run.
  const name = `Asha${Date.now() % 100000}`
  await enterCity(page)
  await page.getByRole('button', { name: 'Dikhna hai? Login karo' }).click()
  await page.getByLabel('Aapka naam').fill(name)
  await page.getByRole('button', { name: 'Andar aao' }).click()

  const sheet = page.getByRole('dialog', { name: 'Apni pehchaan banao' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Save karo' })).toBeDisabled()
  await sheet.getByLabel('Naam').fill(name)
  await sheet.getByLabel('Kaun si jagah se ho?').selectOption('Raja Park')
  await sheet.getByLabel('Main 18 saal ya usse bada/badi hoon').check()
  await sheet.getByLabel('Sab ki izzat karunga/karungi. Koi harassment, hate ya spam nahi.').check()
  await sheet.getByRole('button', { name: 'Save karo' }).click()

  await expect(sheet).toBeHidden()
  await expect(page.getByText('Jaipur tumhe dekh sakta hai')).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await expect(page.getByText('Jaipur tumhe dekh sakta hai')).toBeVisible()
  await expect(page.getByRole('dialog')).toBeHidden()
  // Leave the city now: an open page would keep its resident's slot in the gate for the specs that follow.
  await page.close()
})
