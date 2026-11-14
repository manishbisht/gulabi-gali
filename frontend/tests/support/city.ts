import type { Page } from '@playwright/test'

/** Opens the city the way a player does: past the intro, with the test hooks installed. */
export async function enterCity(page: Page) {
  await page.goto('/?gg-test=1')
  await page.getByRole('button', { name: 'Padharo!' }).click()
  await page.waitForFunction(() => (window as { __gg?: unknown }).__gg !== undefined)
}
