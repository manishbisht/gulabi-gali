import { expect, test } from '@playwright/test'
import { closePeople, resident, walk } from './support/people'

test.afterEach(closePeople)

test('a namaste from the person card: no chat, an emote over both, a gentle toast for the one greeted', async ({
  browser,
}) => {
  const a = await resident(browser, 'Asha')
  const b = await resident(browser, 'Ravi')

  // A walks up to B (they spawn together) and opens B's card with E
  await walk(a.page, 'd', 300)
  await a.page.keyboard.press('e')
  const card = a.page.getByRole('region', { name: b.name })
  const greet = card.getByRole('group', { name: 'Door se hi salaam' })
  await greet.getByRole('button', { name: 'Namaste 🙏' }).click()
  // the emote shows over both of them, on both screens (for a couple of seconds)
  await expect(a.page.locator('.emote:not([hidden])')).toHaveCount(2)
  await expect(b.page.locator('.emote:not([hidden])')).toHaveCount(2)
  await expect(a.page.locator('.emote:not([hidden])').first()).toHaveText('🙏')

  // B is told, gently, and nothing else opens on either side
  await expect(b.page.getByText(`${a.name} ne aapko namaste kiya 🙏`)).toBeVisible()
  await expect(b.page.getByRole('button', { name: `${a.name} ko block karo` })).toBeHidden()
  await expect(card).toContainText(`${b.name} ko namaste pahunch gaya`)
  await expect(a.page.getByRole('textbox', { name: 'Aapki baat' })).toBeHidden()
  // once is enough for a while: both buttons rest
  await expect(greet.getByRole('button', { name: 'Haath hilao 👋' })).toBeDisabled()
  await expect(greet.getByRole('button', { name: 'Namaste 🙏' })).toBeDisabled()
})
