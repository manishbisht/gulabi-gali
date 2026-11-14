import { expect, test, type APIRequestContext } from '@playwright/test'
import { closePeople, resident, seen, walk } from './support/people'

/**
 * The city's cap, through the Worker's DEV_AUTH-only `/api/dev/gate`: every other spec needs two residents at
 * once, so the cap is 1 only for this one, and the gate starts empty.
 */
const cap = async (request: APIRequestContext, maxLive: number | null) => {
  const res = await request.post('http://127.0.0.1:8787/api/dev/gate', { data: { maxLive, clear: true } })
  expect(res.status()).toBe(200)
}

test.afterEach(closePeople)

test('a full city: the next resident waits as a ghost, leaves an email, and gets in when someone leaves', async ({
  browser,
  request,
}) => {
  // The slot of someone who leaves is held 20 s (for a reload or a metro ride) before the line moves.
  test.setTimeout(120_000)
  await cap(request, 1)
  try {
    const a = await resident(browser, 'Asha')
    const b = await resident(browser, 'Ravi', undefined, { visible: false })
    await expect(b.page.getByText('Jaipur full hai! Tumhara number: 1')).toBeVisible()
    await expect(b.page.getByText('Abhi koi tumhe dekh nahi sakta', { exact: true })).toBeVisible()
    // Exploring meanwhile, unseen.
    await walk(b.page, 'w', 600)
    await a.page.waitForTimeout(1000)
    expect(await seen(a.page)).not.toContain(b.id)
    await expect.poll(() => seen(b.page)).toContain(a.id)

    await b.page.getByLabel('Email chhodo, jagah bante hi batayenge').fill(`ravi${Date.now()}@example.in`)
    await b.page.getByRole('button', { name: 'Batana' }).click()
    await expect(b.page.getByText('Jagah bante hi batayenge!', { exact: true })).toBeVisible()
    await expect(b.page.getByLabel('Email chhodo, jagah bante hi batayenge')).toHaveCount(0)

    // Asha leaves; once her slot is let go, Ravi's open socket becomes a resident.
    await a.page.context().close()
    await expect(b.page.getByText('Ab Jaipur tumhe dekh sakta hai!')).toBeVisible({ timeout: 60_000 })
    await expect(b.page.getByText('Jaipur tumhe dekh sakta hai', { exact: true })).toBeVisible()
    await expect(b.page.getByText('Jaipur full hai! Tumhara number: 1')).toHaveCount(0)
  } finally {
    await cap(request, null)
  }
})
