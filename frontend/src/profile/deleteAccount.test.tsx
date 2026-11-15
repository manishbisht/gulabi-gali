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
    stamps: [] as string[],
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
    expect(text).toContain(STRINGS.privacyContact[lang])
    expect(text).toMatch(/30/)
  }
  expect(STRINGS.profilePrivacy.en).toBe(
    'If someone reports a conversation, the moderator can read its recent messages.',
  )
})

it('the privacy note says everything that is kept, and how long', async () => {
  await act(async () => root.render(<PrivacySheet lang="en" onClose={() => {}} />))
  const en = host.textContent!
  for (const kept of [
    // waitlist emails, and when they go
    'waitlist',
    '90 days',
    // chats held after an unmatch or a block
    'after an unmatch or a block',
    // rate counters keyed by address
    'IP address',
    'up to 2 days',
    // who invited whom
    'Who invited whom',
    // the tombstone a delete leaves
    'account id',
    // ignored requests are not erased at once
    'up to 14 days with their message blanked',
    // your own blocks go
    'the blocks you made',
    // the sign-in email, honestly
    'Your sign-in email stays with Clerk',
    // (the contact itself is the owner's to fill in: the tests never name it)
    'to have it removed',
  ])
    expect(en, kept).toContain(kept)
  expect(en).not.toContain('is deleted from Clerk')
  expect(en).not.toContain('requests and invite codes are erased')
  await act(async () => root.render(<PrivacySheet lang="hi" onClose={() => {}} />))
  const hi = host.textContent!
  for (const kept of ['waitlist', '90 din', '2 din', '14 din', 'Clerk', 'hatwane'])
    expect(hi, kept).toContain(kept)
})

it('the delete step says your own blocks go and where your sign-in email stays', () => {
  expect(STRINGS.deleteWhat.en).toContain('the blocks you made')
  expect(STRINGS.deleteWhat.en).toContain('Your sign-in email stays with Clerk; write to ')
  expect(STRINGS.deleteWhat.en).toContain(' to remove it.')
  expect(STRINGS.deleteWhat.hi).toContain('hatwane')
  expect(STRINGS.deleteWhat.hi).toContain('block')
})

it('the delete step names the Jaipur Darshan stamps the server keeps, in both languages', () => {
  expect(STRINGS.deleteWhat.en).toContain('Jaipur Darshan stamps')
  expect(STRINGS.deleteWhat.hi).toContain('Jaipur Darshan ke stamps')
})

it('the link field warns that every verified member can see it', () => {
  expect(STRINGS.profileLinkHint.en).toContain('Every verified member can see it')
  expect(STRINGS.profileLinkHint.hi).toContain('Har verified member')
})

it('Escape in the delete step backs out of it, and only then closes the profile sheet', async () => {
  const onClose = vi.fn()
  const me = {
    id: 'u',
    complete: true,
    verified: false,
    profile: {
      id: 'u',
      name: 'Asha',
      look: { skin: 1, outfit: 'sandstone', head: 'none' },
      status: '',
      homeArea: 'Raja Park',
      hereFor: null,
      about: '',
      pauseRequests: false,
      stamps: [] as string[],
    },
  } as Parameters<typeof ProfileSheet>[0]['me']
  await act(async () =>
    root.render(
      <ProfileSheet
        me={me}
        lang="en"
        onSave={vi.fn()}
        onClose={onClose}
        onSignOut={() => {}}
        onPrivacy={() => {}}
        onDelete={async () => true}
      />,
    ),
  )
  await click(button('Delete my account'))
  const field = host.querySelector<HTMLInputElement>('[data-field="deleteConfirm"]')!
  const escape = () =>
    act(async () => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await escape()
  expect(onClose).not.toHaveBeenCalled()
  expect(host.querySelector('[data-field="deleteConfirm"]')).toBeNull() // the step is closed
  await act(
    async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  expect(onClose).toHaveBeenCalledTimes(1)
})
