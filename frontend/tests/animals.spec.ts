import { expect, test } from '@playwright/test'
import { enterCity } from './support/city'

/** The Pink City's street dog that lives at (2, 38), a few steps from where the walk starts. */
const DOG = 'walled-city-dog-0'

test('call a street dog and it trails you as you walk', async ({ page }) => {
  await enterCity(page)
  await page.evaluate(() => window.__gg.freezeAnimals(true)) // it stays put until called
  const dog = () => page.evaluate((id) => window.__gg.animals().find((a) => a.id === id)!, DOG)
  const gap = async () => {
    const [d, me] = await Promise.all([dog(), page.evaluate(() => window.__gg.position())])
    return { d, me, apart: Math.hypot(d.x - me.x, d.z - me.z) }
  }

  const home = await dog()
  await page.evaluate(({ x, z }) => window.__gg.teleport(x, z + 1.6), home)
  await page.getByRole('button', { name: 'Saath chalo' }).click()
  await expect.poll(async () => (await dog()).following).toBe(true)

  const start = (await gap()).me
  await page.keyboard.down('w')
  await page.waitForTimeout(2500)
  await page.keyboard.up('w')
  await page.waitForTimeout(800) // it catches up and settles behind

  const { me, apart } = await gap()
  expect(Math.hypot(me.x - start.x, me.z - start.z)).toBeGreaterThan(4) // we really walked
  expect(apart).toBeGreaterThan(0.8) // beside or behind us, not on top of us
  expect(apart).toBeLessThan(2.5)

  // "Ghar jao" sends it back where it lives
  await page.getByRole('button', { name: 'Ghar jao' }).click()
  await expect.poll(async () => (await dog()).following).toBe(false)
})
