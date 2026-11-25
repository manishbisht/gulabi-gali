import { expect, test, type Page } from '@playwright/test'
import { closePeople, hopTo, resident, verify, type Resident } from './support/people'

test.afterEach(closePeople)

/** The Walled City's tapri by Johari Bazaar, at (-5.6, 36), its counter facing east. */
const TAPRI = { x: -5.6, z: 36 }

/** A call to the local Worker with `page`'s own sign-in: its status and body. */
const call = (page: Page, path: string, method: string, body?: unknown) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(`http://127.0.0.1:8787${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('gg-dev-token')}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      return { status: res.status, body: (await res.json().catch(() => null)) as unknown }
    },
    { path, method, body },
  )

/** `a` (verified) and `b` matched, over the API: a request and its yes. */
async function matched(a: Resident, b: Resident) {
  await verify(a.page)
  const sent = await call(a.page, '/api/requests', 'POST', { to: b.id, reason: 'Chai pe milte hain kabhi?' })
  expect(sent.status).toBe(201)
  const { id } = sent.body as { id: string }
  expect((await call(b.page, `/api/requests/${id}/accept`, 'POST')).status).toBe(200)
}

/** Opens `r`'s profile sheet, and its friends. */
async function friendsOf(r: Resident) {
  // its name carries the count of asks waiting, when there are any
  await r.page.getByRole('button', { name: /^Profile/ }).click()
  const sheet = r.page.getByRole('dialog', { name: 'Apni pehchaan banao' })
  return { sheet, panel: sheet.getByRole('region', { name: 'Dost' }) }
}

test('Dost banao from a chat, a yes from the profile, then Chai pe bulao from a tapri and Chalo', async ({
  browser,
}) => {
  const a = await resident(browser, 'Asha')
  const b = await resident(browser, 'Ravi')
  await matched(a, b)

  // A asks from their chat with B
  await a.page.getByRole('button', { name: /Mulaqaatein/ }).click()
  const sheetA = a.page.getByRole('dialog', { name: 'Aapki mulaqaatein' })
  await sheetA.getByRole('tab', { name: /Baatein/ }).click()
  await sheetA.getByRole('button', { name: new RegExp(b.name) }).click()
  await sheetA.getByRole('button', { name: 'Aur', exact: true }).click()
  await sheetA.getByRole('button', { name: 'Dost banao' }).click()
  await expect(sheetA.getByText('Dosti ki request bhej di.')).toBeVisible()
  await sheetA.getByRole('button', { name: 'Band karo' }).click()

  // B's Profile button counts the ask; B says yes there: A is a friend now, out on the street in the Pink City
  await expect(b.page.getByRole('button', { name: 'Profile 1 dosti ki request' })).toBeVisible()
  const { sheet: profileB, panel } = await friendsOf(b)
  await expect(panel.getByText('Dost banna chahte hain')).toBeVisible()
  await panel.getByRole('button', { name: 'Haan' }).click()
  await expect(panel.getByText(a.name)).toBeVisible()
  await expect(panel).toContainText('gali mein hai · Gulabi Shahar')
  // both switches on by default
  await expect(panel.getByLabel('Dosto ko dikhao ki main gali mein hoon')).toBeChecked()
  await expect(panel.getByLabel('Chai ke bulaave lo')).toBeChecked()
  await profileB.getByRole('button', { name: 'Baad mein' }).click()

  // A turns "dosto ko dikhao" off: B sees just the name, nothing about why
  const { sheet: profileA, panel: panelA } = await friendsOf(a)
  await expect(panelA.getByText(b.name)).toBeVisible()
  await panelA.getByLabel('Dosto ko dikhao ki main gali mein hoon').uncheck()
  await expect(panelA.getByLabel('Dosto ko dikhao ki main gali mein hoon')).not.toBeChecked()
  await profileA.getByRole('button', { name: 'Baad mein' }).click()
  const again = await friendsOf(b)
  await expect(again.panel.getByText(a.name)).toBeVisible()
  await expect(again.panel).not.toContainText('gali mein hai')
  await again.sheet.getByRole('button', { name: 'Baad mein' }).click()

  // A sits at the tapri and invites B
  await hopTo(a.page, TAPRI.x + 2.2, TAPRI.z + 0.5)
  await a.page.getByRole('button', { name: 'Baitho' }).click()
  const bench = a.page.getByRole('region', { name: 'Tapri pe' })
  await bench.getByRole('button', { name: 'Chai pe bulao' }).click()
  await bench.getByRole('button', { name: `${b.name} ko chai pe bulao` }).click()
  await expect(bench.getByText('Bulaava bhej diya')).toBeVisible()

  // B's inbox: who, and which tapri; Chalo points the compass at it (the same district)
  const open = b.page.getByRole('button', { name: /Mulaqaatein/ })
  // (the badge also still counts the meet request B said yes to over the API, behind the page's back)
  await expect(open.getByLabel(/^\d+ naye$/)).toBeVisible()
  await open.click()
  const sheetB = b.page.getByRole('dialog', { name: 'Aapki mulaqaatein' })
  await expect(sheetB).toContainText(`${a.name} ne chai pe bulaya · chai ki tapri, Gulabi Shahar`)
  await sheetB.getByRole('button', { name: 'Chalo' }).click()
  await expect(sheetB).toBeHidden()
  await expect(b.page.locator('.compass')).toBeVisible()
  // and it is done with: the inbox no longer lists it
  await open.click()
  await expect(sheetB).not.toContainText('chai pe bulaya')
})

test.describe('on a 360 px phone', () => {
  const PHONE = {
    viewport: { width: 360, height: 740 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  }

  /** Whole on the screen across, and inside its top-to-bottom too. */
  async function onScreen(what: string, box: { x: number; y: number; width: number; height: number } | null) {
    expect(box, what).not.toBeNull()
    expect.soft(box!.x, `${what} left`).toBeGreaterThanOrEqual(0)
    expect.soft(box!.x + box!.width, `${what} right`).toBeLessThanOrEqual(PHONE.viewport.width)
    expect.soft(box!.y + box!.height, `${what} bottom`).toBeLessThanOrEqual(PHONE.viewport.height)
  }

  test('the Profile count, the friends panel, the chai picker and the invite in the inbox all fit', async ({
    browser,
  }) => {
    const a = await resident(browser, 'Asha', PHONE)
    const b = await resident(browser, 'Ravi', PHONE)
    await matched(a, b)
    expect((await call(a.page, '/api/friends', 'POST', { to: b.id })).status).toBeLessThan(300)

    // the Profile button with its count sits in the top block, whole, the HUD's head no taller than a third
    const profile = b.page.getByRole('button', { name: 'Profile 1 dosti ki request' })
    await expect(profile).toBeVisible()
    await onScreen('profile button', await profile.boundingBox())
    const head = await b.page.locator('.hud-head').boundingBox()
    expect(head!.y + head!.height, 'HUD head bottom').toBeLessThanOrEqual(PHONE.viewport.height * 0.35)

    // the friends panel: the ask and its buttons on the screen, thumb-sized
    const { sheet, panel } = await friendsOf(b)
    const yes = panel.getByRole('button', { name: 'Haan' })
    await yes.scrollIntoViewIfNeeded()
    await onScreen('Haan', await yes.boundingBox())
    expect((await yes.boundingBox())!.height, 'Haan thumb-sized').toBeGreaterThanOrEqual(44)
    await yes.click()
    await expect(panel.getByText(a.name)).toBeVisible()
    await onScreen('friends panel', await panel.boundingBox())
    await sheet.getByRole('button', { name: 'Baad mein' }).click()

    // A at the tapri: the bench panel and its friend picker
    await hopTo(a.page, TAPRI.x + 2.2, TAPRI.z + 0.5)
    await a.page.getByRole('button', { name: 'Baitho' }).click()
    const bench = a.page.getByRole('region', { name: 'Tapri pe' })
    await bench.getByRole('button', { name: 'Chai pe bulao' }).click()
    const pick = bench.getByRole('button', { name: `${b.name} ko chai pe bulao` })
    await onScreen('bench panel', await bench.boundingBox())
    await onScreen('friend in the picker', await pick.boundingBox())
    expect((await pick.boundingBox())!.height, 'picker thumb-sized').toBeGreaterThanOrEqual(44)
    await pick.click()
    await expect(bench.getByText('Bulaava bhej diya')).toBeVisible()

    // B's inbox: the invite and both its buttons on the screen
    await b.page.getByRole('button', { name: /Mulaqaatein/ }).click()
    const inbox = b.page.getByRole('dialog', { name: 'Aapki mulaqaatein' })
    await expect(inbox).toContainText(`${a.name} ne chai pe bulaya`)
    for (const name of ['Chalo', 'Abhi nahi']) {
      const button = inbox.getByRole('button', { name, exact: true })
      await onScreen(name, await button.boundingBox())
      expect((await button.boundingBox())!.height, `${name} thumb-sized`).toBeGreaterThanOrEqual(44)
    }
  })
})
