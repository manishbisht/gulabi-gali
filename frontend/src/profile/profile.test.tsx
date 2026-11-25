// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookFromWire, lookToWire } from '../player/avatar'
import type { AvatarLook } from '../world/types'
import { ProfileSheet } from './ProfileSheet'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const save = () => host.querySelector('button[type="submit"]') as HTMLButtonElement
const field = (name: string) => host.querySelector(`[data-field="${name}"]`) as HTMLElement

async function type(el: HTMLElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const click = (el: HTMLElement) => act(async () => el.click())

type Save = Parameters<typeof ProfileSheet>[0]['onSave']
async function mount(onSave: Save = vi.fn(async () => ({ ok: true }) as const)) {
  await act(async () =>
    root.render(
      <ProfileSheet
        me={{ id: 'u', profile: null, complete: false, verified: false }}
        lang="en"
        onSave={onSave}
        onClose={() => {}}
        onSignOut={() => {}}
      />,
    ),
  )
  return onSave
}

it('save is disabled until required fields and both checkboxes', async () => {
  await mount()
  expect(save().disabled).toBe(true)
  await type(field('name'), 'Asha')
  expect(save().disabled).toBe(true)
  const area = field('homeArea') as HTMLSelectElement
  await act(async () => {
    area.value = 'Raja Park'
    area.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(save().disabled).toBe(true)
  await click(field('adult'))
  expect(save().disabled).toBe(true)
  await click(field('pledge'))
  expect(save().disabled).toBe(false)
  await click(field('adult'))
  expect(save().disabled).toBe(true)
})

it('server field errors highlight those fields', async () => {
  const onSave = vi.fn<Save>(async () => ({ ok: false, fields: ['name', 'about'] }))
  await mount(onSave)
  await type(field('name'), 'Asha')
  const area = field('homeArea') as HTMLSelectElement
  await act(async () => {
    area.value = 'Raja Park'
    area.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click(field('adult'))
  await click(field('pledge'))
  await act(async () => save().click())
  expect(onSave).toHaveBeenCalledOnce()
  expect(field('name').getAttribute('aria-invalid')).toBe('true')
  expect(field('about').getAttribute('aria-invalid')).toBe('true')
  expect(field('status').getAttribute('aria-invalid')).not.toBe('true')
  await type(field('name'), 'Asha K')
  expect(field('name').getAttribute('aria-invalid')).not.toBe('true')
})

it('a field the word filter refused is marked, with the respectful hint instead of the generic one', async () => {
  const onSave = vi.fn<Save>(async () => ({ ok: false, fields: ['about'], words: true }))
  await mount(onSave)
  await type(field('name'), 'Asha')
  const area = field('homeArea') as HTMLSelectElement
  await act(async () => {
    area.value = 'Raja Park'
    area.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click(field('adult'))
  await click(field('pledge'))
  await act(async () => save().click())
  expect(field('about').getAttribute('aria-invalid')).toBe('true')
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('respectful')
  await type(field('about'), 'kinder words')
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('counters use the server limits', async () => {
  await mount()
  expect(host.textContent).toContain('0/24')
  expect(host.textContent).toContain('0/80')
  expect(host.textContent).toContain('0/200')
})

it('look round-trips wire format', () => {
  const look: AvatarLook = { skin: 3, outfit: 'teal', head: 'safa' }
  const wire = lookToWire(look)
  expect(wire).toEqual({ skin: 3, outfit: 'teal', head: 'safa' })
  expect(lookFromWire(wire)).toEqual(look)
  expect(lookFromWire({ skin: 9, outfit: 'nope', head: 'x' } as never)).toBeNull()
})

it('shows your own Jaipur Darshan stamps: the count, and the landmarks by name', async () => {
  const sheet = (stamps: string[]) =>
    act(async () =>
      root.render(
        <ProfileSheet
          me={{ id: 'u', profile: null, complete: false, verified: false }}
          lang="en"
          stamps={stamps}
          onSave={vi.fn()}
          onClose={() => {}}
          onSignOut={() => {}}
        />,
      ),
    )
  await sheet(['jkk', 'hawa-mahal'])
  const line = host.querySelector('.person-stamps')!
  expect(line.textContent).toContain('Jaipur Darshan · 2/14')
  expect([...line.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
    'Jawahar Kala Kendra',
    'Hawa Mahal',
  ])
  expect(line.querySelector('ul')!.getAttribute('aria-label')).toBe('Jaipur Darshan stamps')
  // none yet: the count, and where to find them
  await sheet([])
  expect(host.querySelector('.person-stamps')!.textContent).toContain('Jaipur Darshan · 0/14')
  expect(host.querySelector('.person-stamps li')).toBeNull()
})

it('a resident can pause requests, and un-pause them, with the rest of the profile', async () => {
  const onSave = vi.fn<Save>(async () => ({ ok: true }) as const)
  const profile = {
    id: 'u',
    name: 'Asha',
    look: { skin: 1, outfit: 'teal', head: 'none' },
    status: '',
    homeArea: 'Raja Park',
    hereFor: null,
    about: '',
    pauseRequests: false,
    stamps: [] as string[],
  } as const
  const render = (pauseRequests: boolean) =>
    act(async () =>
      root.render(
        <ProfileSheet
          key={String(pauseRequests)}
          me={{ id: 'u', profile: { ...profile, pauseRequests }, complete: true, verified: false }}
          lang="en"
          onSave={onSave}
          onClose={() => {}}
          onSignOut={() => {}}
        />,
      ),
    )
  await render(false)
  const pause = field('pauseRequests') as HTMLInputElement
  expect(pause.checked).toBe(false)
  expect(pause.closest('label')!.textContent).toContain('Pause requests')
  await click(pause)
  await act(async () => save().click())
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ pauseRequests: true }))

  await render(true)
  expect((field('pauseRequests') as HTMLInputElement).checked).toBe(true)
  await click(field('pauseRequests'))
  await act(async () => save().click())
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ pauseRequests: false }))
})

describe('push notifications in the sheet', () => {
  const profile = {
    id: 'u',
    name: 'Asha',
    look: { skin: 1, outfit: 'teal', head: 'none' },
    status: '',
    homeArea: 'Raja Park',
    hereFor: null,
    about: '',
    pauseRequests: false,
    stamps: [] as string[],
  } as const
  const render = (complete: boolean) =>
    act(async () =>
      root.render(
        <ProfileSheet
          me={{ id: 'u', profile, complete, verified: false }}
          lang="hi"
          token={async () => 'tok'}
          onSave={vi.fn()}
          onClose={() => {}}
          onSignOut={() => {}}
        />,
      ),
    )
  afterEach(() => vi.unstubAllEnvs())

  it('a resident finds "Naye messages pe batao" (here, a browser without push says so)', async () => {
    vi.stubEnv(
      'VITE_VAPID_PUBLIC_KEY',
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
    )
    await render(true)
    expect(host.querySelector('.push-setting')!.textContent).toContain('Naye messages pe batao')
  })

  it('not before the profile is complete (nobody can ask a ghost), nor in a build without a key', async () => {
    vi.stubEnv(
      'VITE_VAPID_PUBLIC_KEY',
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
    )
    await render(false)
    expect(host.querySelector('.push-setting')).toBeNull()
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '')
    await act(async () => root.unmount())
    root = createRoot(host)
    await render(true)
    expect(host.querySelector('.push-setting')).toBeNull()
  })
})

describe('the profile link', () => {
  const stored = {
    id: 'u',
    name: 'Asha',
    look: { skin: 1, outfit: 'teal', head: 'none' },
    status: '',
    homeArea: 'Raja Park',
    hereFor: null,
    about: '',
    pauseRequests: false,
    stamps: [] as string[],
    link: 'https://example.com/asha',
  } as const
  const open = async (onSave: Save) =>
    act(async () =>
      root.render(
        <ProfileSheet
          me={{ id: 'u', profile: stored, complete: true, verified: true }}
          lang="en"
          onSave={onSave}
          onClose={() => {}}
          onSignOut={() => {}}
        />,
      ),
    )

  it('shows the stored link, and saving without touching it leaves link out so the server keeps it', async () => {
    const onSave = vi.fn<Save>(async () => ({ ok: true }) as const)
    await open(onSave)
    expect((field('link') as HTMLInputElement).value).toBe('https://example.com/asha')
    await act(async () => save().click())
    const sent = onSave.mock.calls[0]![0]
    expect('link' in sent).toBe(false)
  })

  it('sends a changed link trimmed, and null when it is cleared', async () => {
    const onSave = vi.fn<Save>(async () => ({ ok: true }) as const)
    await open(onSave)
    await type(field('link'), '  https://example.org/me  ')
    await act(async () => save().click())
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ link: 'https://example.org/me' }))
    await type(field('link'), '')
    await act(async () => save().click())
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ link: null }))
  })

  it('refuses a link that is not https, before it is sent', async () => {
    const onSave = vi.fn<Save>(async () => ({ ok: true }) as const)
    await open(onSave)
    await type(field('link'), 'http://example.com')
    expect(save().disabled).toBe(true)
    expect(field('link').getAttribute('aria-invalid')).toBe('true')
    await type(field('link'), 'https://example.com')
    expect(save().disabled).toBe(false)
  })
})
