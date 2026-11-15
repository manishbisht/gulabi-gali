// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PosterView } from '../net/protocol'
import { PosterCard } from './PosterCard'
import { PosterComposer } from './PosterComposer'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const button = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

/** What the page sent, by call: the method, the path and the parsed body. */
const calls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([url, init]) => ({
    method: (init as RequestInit | undefined)?.method ?? 'GET',
    path: new URL(String(url)).pathname,
    body: (init as RequestInit | undefined)?.body
      ? JSON.parse(String((init as RequestInit).body))
      : undefined,
  }))

const set = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('PosterComposer', () => {
  function mount(over: Partial<Parameters<typeof PosterComposer>[0]> = {}) {
    const host = document.body.appendChild(document.createElement('div'))
    const props = {
      district: 'walled-city' as const,
      wall: 2,
      viewer: 'verified' as const,
      empty: false,
      lang: 'en' as const,
      token: async () => 'tok',
      onPinned: vi.fn(),
      onVisible: vi.fn(),
      onGetVerified: vi.fn(),
      onClose: vi.fn(),
      ...over,
    }
    act(() => createRoot(host).render(<PosterComposer {...props} />))
    const area = () => host.querySelector('textarea')!
    const when = () => host.querySelector<HTMLInputElement>('input[type="datetime-local"]')!
    const submit = async () => {
      await act(async () => button(host, 'Pin it')!.click())
      await settle()
    }
    return { host, props, area, when, submit }
  }

  it('pins the cleaned plan, its time read as Jaipur time, and hands the poster back', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-15T10:00:00+05:30'), toFake: ['Date'] })
    const made: PosterView = {
      id: 'p1',
      wall: 2,
      slot: 0,
      text: 'Chai at six, Raja Park',
      when: 1,
      name: 'Asha',
      mine: true,
    }
    const fetchMock = vi.fn(async () => json(made, 201))
    vi.stubGlobal('fetch', fetchMock)
    const { host, props, area, when, submit } = mount()
    expect(host.textContent).toContain('Anyone can read it, ghosts too')
    expect(button(host, 'Pin it')!.disabled).toBe(true)
    await set(area(), '  Chai at six,\n Raja Park ')
    // The picker runs from now to 30 days on, in Jaipur's own clock.
    expect(when().min).toBe('2026-11-15T10:00')
    expect(when().max).toBe('2026-12-15T10:00')
    await set(when(), '2026-11-20T18:00')
    await submit()
    expect(calls(fetchMock)).toEqual([
      {
        method: 'POST',
        path: '/api/posters',
        body: {
          district: 'walled-city',
          wall: 2,
          text: 'Chai at six, Raja Park',
          when: Date.parse('2026-11-20T18:00:00+05:30'),
        },
      },
    ])
    expect(props.onPinned).toHaveBeenCalledWith(made)
  })

  it('turns down a time in the past without asking the server', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { host, area, when, submit } = mount()
    await set(area(), 'Board games tonight, all welcome')
    await set(when(), '2020-01-01T10:00')
    await submit()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'Pick a time that is still to come, within the next 30 days.',
    )
  })

  it('says why the server said no', async () => {
    for (const [answer, line] of [
      [
        { error: 'limit' },
        'You already have 2 posters up (hidden ones count too). Take one down to pin another.',
      ],
      [{ error: 'words', field: 'text' }, "Some of these words aren't okay here."],
      [{ error: 'rate' }, "That's 5 posters today. Pin again tomorrow."],
      [{ error: 'invalid', field: 'when' }, 'Pick a time that is still to come'],
    ] as const) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => json(answer, answer.error === 'limit' ? 409 : 400)),
      )
      const { host, area, submit, props } = mount()
      await set(area(), 'Board games tonight, all welcome')
      await submit()
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(line)
      expect(props.onPinned).not.toHaveBeenCalled()
      document.body.innerHTML = ''
    }
  })

  it('a wall with nothing on it says so', () => {
    const { host } = mount({ empty: true })
    expect(host.textContent).toContain('No plans on this wall yet. Want to pin the first one?')
  })

  it('anyone not verified gets the way in instead of the form', async () => {
    for (const [viewer, label, call] of [
      ['resident', 'Enter an invite code', 'onGetVerified'],
      ['ghost', 'Want to be seen? Sign in', 'onVisible'],
      ['incomplete', 'Finish your profile', 'onVisible'],
    ] as const) {
      const { host, props } = mount({ viewer })
      expect(host.querySelector('textarea')).toBeNull()
      expect(host.textContent).toContain('Only verified members can pin on the walls.')
      await act(async () => button(host, label)!.click())
      expect(props[call]).toHaveBeenCalled()
      document.body.innerHTML = ''
    }
  })
})

describe('PosterCard', () => {
  const poster: PosterView = {
    id: 'poster-1',
    wall: 0,
    slot: 3,
    text: '<img src=x onerror=alert(1)> Cricket at dawn',
    when: Date.parse('2026-11-16T07:00:00+05:30'),
    name: 'Ravi',
  }
  function mount(over: Partial<Parameters<typeof PosterCard>[0]> = {}) {
    const host = document.body.appendChild(document.createElement('div'))
    const props = {
      poster,
      viewer: 'resident' as const,
      lang: 'en' as const,
      token: async () => 'tok',
      onBlock: vi.fn(async () => true),
      onTakenDown: vi.fn(),
      onClose: vi.fn(),
      ...over,
    }
    act(() => createRoot(host).render(<PosterCard {...props} />))
    return { host, props }
  }

  it('shows the text as text, its time in Jaipur, and the first name', () => {
    const { host } = mount()
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain('<img src=x onerror=alert(1)> Cricket at dawn')
    expect(host.textContent).toContain('When: Mon, 16 Nov, 7:00 am')
    expect(host.textContent).toContain('Pinned by Ravi')
    expect(button(host, 'Report')).toBeDefined()
    expect(button(host, 'Block')).toBeDefined()
  })

  it('blocks first, then opens the report about the poster', async () => {
    const fetchMock = vi.fn(async () => json({ autoHidden: false }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const { host, props } = mount()
    await act(async () => button(host, 'Block')!.click())
    const ask = host.querySelector('[role="alertdialog"]')!
    expect(ask.textContent).toContain('Block Ravi?')
    await act(async () => ask.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
    await act(async () => button(host, 'Yes, block')!.click())
    await settle()
    expect(props.onBlock).toHaveBeenCalledWith(poster, true)
    // Blocked already: the form offers no "Also block?".
    const form = host.querySelector('[role="dialog"]')!
    expect(form.textContent).not.toContain('Also block?')
    await act(async () => button(host, 'Spam')!.click())
    await act(async () => button(host, 'Send report')!.click())
    await settle()
    expect(calls(fetchMock)).toEqual([
      {
        method: 'POST',
        path: '/api/reports',
        body: { kind: 'poster', targetId: 'poster-1', reason: 'spam' },
      },
    ])
  })

  it('your own poster: take it down, nothing to report or block', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const { host, props } = mount({ poster: { ...poster, mine: true } })
    expect(host.textContent).toContain('This one is yours.')
    expect(button(host, 'Report')).toBeUndefined()
    expect(button(host, 'Block')).toBeUndefined()
    await act(async () => button(host, 'Take it down')!.click())
    await settle()
    expect(calls(fetchMock)).toEqual([{ method: 'DELETE', path: '/api/posters/poster-1', body: undefined }])
    expect(props.onTakenDown).toHaveBeenCalledWith('poster-1')
  })

  it('your own hidden poster says only you see it for now, and can still come down', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const { host, props } = mount({ poster: { ...poster, mine: true, hidden: true } })
    expect(host.textContent).toContain('Only you can see this poster for now, while we take a look.')
    await act(async () => button(host, 'Take it down')!.click())
    await settle()
    expect(props.onTakenDown).toHaveBeenCalledWith('poster-1')
  })

  it('a block from a poster that has since come down says it did not happen, and why', async () => {
    const onBlock = vi.fn(async () => 'gone' as const)
    const { host, props } = mount({ onBlock })
    await act(async () => button(host, 'Block')!.click())
    await act(async () => button(host, 'Yes, block')!.click())
    await settle()
    expect(host.textContent).toContain("This poster isn't up any more, so the block didn't go through.")
    expect(host.textContent).not.toContain("Couldn't block. Try again.")
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('closes when its poster comes off the wall, but not under a report still being written', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    const onClose = vi.fn()
    const draw = (gone: boolean) =>
      act(() =>
        root.render(
          <PosterCard
            poster={poster}
            gone={gone}
            viewer="resident"
            lang="en"
            token={async () => 'tok'}
            onBlock={async () => true}
            onTakenDown={() => {}}
            onClose={onClose}
          />,
        ),
      )
    draw(false)
    await act(async () => button(host, 'Report')!.click())
    draw(true)
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => button(host, 'Never mind')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a ghost reads it, with no report or block', () => {
    const { host } = mount({ viewer: 'ghost', poster: { ...poster, when: null } })
    expect(host.textContent).not.toContain('When:')
    expect(button(host, 'Report')).toBeUndefined()
    expect(button(host, 'Block')).toBeUndefined()
    expect(button(host, 'Close')).toBeDefined()
  })
})
