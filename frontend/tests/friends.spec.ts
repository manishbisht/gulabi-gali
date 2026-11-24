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
  await r.page.getByRole('button', { name: 'Profile', exact: true }).click()
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

  // B says yes in their profile: A is a friend now, out on the street in the Pink City
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
  await expect(open.getByLabel('1 naye')).toBeVisible()
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
