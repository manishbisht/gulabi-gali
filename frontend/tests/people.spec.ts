import { expect, test } from '@playwright/test'
import { closePeople, ghost as visitor, seen, twoPeople, walk } from './support/people'

test.afterEach(closePeople)

test('two residents see each other move', async ({ browser }) => {
  const [a, b] = await twoPeople(browser)
  await expect.poll(() => seen(b.page)).toContain(a.id)
  await expect.poll(() => seen(a.page)).toContain(b.id)

  // A walks (a teleport after the socket's first point would be refused as too fast)
  const from = await a.page.evaluate(() => window.__gg.position())
  await walk(a.page, 'w', 1500)
  const to = await a.page.evaluate(() => window.__gg.position())
  expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeGreaterThan(3)

  await expect
    .poll(async () => {
      const there = (await b.page.evaluate(() => window.__gg.people())).find((p) => p.id === a.id)
      return there ? Math.hypot(there.x - to.x, there.z - to.z) : Infinity
    })
    .toBeLessThan(0.5)
  // and A stands where B's screen would have them: in front of B's camera, on the page
  const there = (await b.page.evaluate(() => window.__gg.people())).find((p) => p.id === a.id)!
  const { width, height } = b.page.viewportSize()!
  expect(there.sx).toBeGreaterThan(0)
  expect(there.sx).toBeLessThan(width)
  expect(there.sy).toBeGreaterThan(0)
  expect(there.sy).toBeLessThan(height)
  expect(await b.page.evaluate(() => window.__gg.liveState())).toBe('open')
})

test('a ghost sees residents but residents never see the ghost', async ({ browser }) => {
  const [a, b] = await twoPeople(browser)
  const ghost = await visitor(browser)
  await expect(ghost.getByText('Abhi koi tumhe dekh nahi sakta')).toBeVisible()
  await expect.poll(() => ghost.evaluate(() => window.__gg.liveState())).toBe('open')
  await expect.poll(() => seen(ghost)).toEqual(expect.arrayContaining([a.id, b.id]))

  // the ghost walks about; the residents still only ever see each other
  await walk(ghost, 'w', 800)
  await walk(ghost, 'a', 500)
  await expect.poll(() => seen(a.page)).toContain(b.id)
  for (let i = 0; i < 5; i++) {
    expect(await seen(a.page)).toEqual([b.id])
    expect(await seen(b.page)).toEqual([a.id])
    await a.page.waitForTimeout(200)
  }
})

test('signing out leaves the street without a reload', async ({ browser }) => {
  const [a, b] = await twoPeople(browser)
  await expect.poll(() => seen(b.page)).toContain(a.id)
  await a.page.getByRole('button', { name: 'Profile' }).click()
  await a.page.getByRole('button', { name: 'Logout karo' }).click()
  await expect(a.page.getByText('Abhi koi tumhe dekh nahi sakta')).toBeVisible()
  await expect.poll(() => seen(b.page)).not.toContain(a.id)
})
