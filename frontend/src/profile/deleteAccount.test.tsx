// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PrivacySheet } from '../ui/PrivacySheet'
import { STRINGS } from '../i18n/strings'
import { DeleteAccount } from './DeleteAccount'
import { ProfileSheet } from './ProfileSheet'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.stubGlobal(
    'confirm',
    vi.fn(() => {
      throw new Error('window.confirm must not be used')
    }),
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!
const click = (el: HTMLElement) => act(async () => el.click())
async function type(value: string) {
  const el = host.querySelector('[data-field="deleteConfirm"]') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('delete needs DELETE typed exactly, then calls onDelete once', async () => {
  const onDelete = vi.fn(async () => true)
  await act(async () => root.render(<DeleteAccount lang="en" onDelete={onDelete} />))
  await click(button('Delete my account'))
  const go = () => button('Delete forever') as HTMLButtonElement
  expect(go().disabled).toBe(true)
  for (const wrong of ['delete', 'Delete', 'DELET', 'DELETE ', ' DELETE']) {
    await type(wrong)
    expect(go().disabled, wrong).toBe(true)
  }
  await click(go())
  expect(onDelete).not.toHaveBeenCalled()
  await type('DELETE')
  expect(go().disabled).toBe(false)
  await click(go())
  expect(onDelete).toHaveBeenCalledTimes(1)
})

it('a failed delete says so and can be tried again', async () => {
  const onDelete = vi.fn(async () => false)
  await act(async () => root.render(<DeleteAccount lang="en" onDelete={onDelete} />))
  await click(button('Delete my account'))
  await type('DELETE')
  await click(button('Delete forever'))
  expect(host.querySelector('[role="alert"]')!.textContent).toBe(STRINGS.deleteFailed.en)
  expect((button('Delete forever') as HTMLButtonElement).disabled).toBe(false)
})

it('cancelling closes the confirm without deleting', async () => {
  const onDelete = vi.fn(async () => true)
  await act(async () => root.render(<DeleteAccount lang="en" onDelete={onDelete} />))
  await click(button('Delete my account'))
  await click(button('No, keep it'))
  expect(host.querySelector('input')).toBeNull()
  expect(onDelete).not.toHaveBeenCalled()
})

it('the profile sheet offers delete and privacy only for someone with a profile', async () => {
  const profile = {
    id: 'u',
    name: 'Asha',
    look: { skin: 1, outfit: 'pink', head: 'none' },
    status: '',
    homeArea: 'Raja Park',
    hereFor: null,
    about: '',
    pauseRequests: false,
  } as const
  const render = (me: Parameters<typeof ProfileSheet>[0]['me']) =>
    act(async () =>
      root.render(
        <ProfileSheet
          me={me}
          lang="en"
          onSave={vi.fn()}
          onClose={() => {}}
          onSignOut={() => {}}
          onPrivacy={() => {}}
          onDelete={async () => true}
        />,
      ),
    )
  await render({ id: 'u', profile: { ...profile }, complete: true, verified: false })
  expect(button('Delete my account')).toBeDefined()
  expect(button('Privacy')).toBeDefined()
  await render({ id: 'u', profile: null, complete: false, verified: false })
  expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Delete my account')).toBe(false)
})

it('the privacy note carries the report line word for word and the contact placeholder', async () => {
  for (const lang of ['hi', 'en'] as const) {
    await act(async () => root.render(<PrivacySheet lang={lang} onClose={() => {}} />))
    const text = host.textContent!
    expect(text).toContain(STRINGS.profilePrivacy[lang])
    expect(text).toContain('{OWNER_CONTACT}')
  }
  expect(STRINGS.profilePrivacy.en).toBe(
    'If someone reports a conversation, the moderator can read its recent messages.',
  )
})
