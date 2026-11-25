// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FullProfile, LivePerson } from '../net/protocol'
import { PersonCard, type Viewer } from '../ui/PersonCard'
import type { People } from './people'
import { usePersonCard } from './usePersonCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const asha: LivePerson = {
  id: 'p1',
  name: 'Asha',
  look: { skin: 2, outfit: 'sandstone', head: 'none' },
  status: 'chai pe aao',
  x: 1,
  z: 0,
  ry: 0,
}
const full: FullProfile = {
  id: 'p1',
  name: 'Asha Sharma',
  look: asha.look,
  status: 'chai pe aao',
  homeArea: 'Bani Park',
  hereFor: 'art',
  about: 'Paints walls',
  pauseRequests: false,
  stamps: [],
}

const crowd = (list: { person: LivePerson; x: number; z: number; ver?: number }[]) =>
  ({
    entries: () =>
      list.map((e) => ({ person: e.person, body: { position: { x: e.x, z: e.z } }, ver: e.ver ?? 0 })),
  }) as unknown as Pick<People, 'entries'>

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function mountHook() {
  const out = {} as ReturnType<typeof usePersonCard>
  function Probe() {
    Object.assign(out, usePersonCard())
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe />))
  return out
}

it('landmark card outranks a person card: taps and E both yield', () => {
  const card = mountHook()
  const people = crowd([{ person: asha, x: 1, z: 0 }])
  act(() => card.tap(asha, true)) // a landmark (or character) card is up
  expect(card.open).toBeNull()
  act(() => card.step({ x: 0, z: 0 }, people, true, true)) // E with a landmark near
  expect(card.open).toBeNull()
  act(() => card.step({ x: 0, z: 0 }, people, true, false))
  expect(card.open?.person.id).toBe('p1')
  act(() => card.step({ x: 0, z: 0 }, people, false, true)) // walking into a landmark ring closes it
  expect(card.open).toBeNull()
})

it('E opens the nearest person within 3 m, and again closes it', () => {
  const card = mountHook()
  const bo = { ...asha, id: 'p2', name: 'Bo' }
  const people = crowd([
    { person: asha, x: 2.5, z: 0 },
    { person: bo, x: 1, z: 0 },
  ])
  act(() => card.step({ x: 0, z: 0 }, crowd([{ person: asha, x: 4, z: 0 }]), true, false))
  expect(card.open).toBeNull() // out of reach
  act(() => card.step({ x: 0, z: 0 }, people, true, false))
  expect(card.open?.person.id).toBe('p2')
  act(() => card.step({ x: 0, z: 0 }, people, true, false))
  expect(card.open).toBeNull()
})

it('keeps the last data and flags the card when the person leaves, and follows a status change', () => {
  const card = mountHook()
  act(() => card.tap(asha, false))
  act(() =>
    card.step(
      { x: 0, z: 0 },
      crowd([{ person: { ...asha, status: 'new' }, x: 1, z: 0, ver: 1 }]),
      false,
      false,
    ),
  )
  expect(card.open?.person.status).toBe('new')
  act(() => card.step({ x: 0, z: 0 }, crowd([]), false, false))
  expect(card.open).toEqual({ person: expect.objectContaining({ id: 'p1', status: 'new' }), gone: true })
})

function show(viewer: Viewer, extra: Partial<Parameters<typeof PersonCard>[0]> = {}) {
  const host = document.body.appendChild(document.createElement('div'))
  const props = {
    person: asha,
    gone: false,
    viewer,
    lang: 'en' as const,
    token: async () => 'tok',
    onVisible: vi.fn(),
    onGetVerified: vi.fn(),
    onRequest: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  }
  const root = createRoot(host)
  const render = async (p = props) => {
    await act(async () => root.render(<PersonCard {...p} />))
  }
  return { host, props, render }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

it('ghost viewer sees only name/status and a sign-in CTA', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const { host, props, render } = show('ghost')
  await render()
  expect(host.textContent).toContain('Asha')
  expect(host.textContent).toContain('chai pe aao')
  expect(host.textContent).not.toContain('Say hello')
  const cta = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('need to be visible'))!
  act(() => cta.click())
  expect(props.onVisible).toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('an incomplete viewer never fetches either', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const { host, render } = show('incomplete')
  await render()
  expect(host.textContent).toContain('need to be visible')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('resident viewer loads full profile', async () => {
  const fetchMock = vi.fn(async () => json(full))
  vi.stubGlobal('fetch', fetchMock)
  const { host, props, render } = show('verified')
  await render()
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toContain('/api/profiles/p1')
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  expect(host.textContent).toContain('Asha Sharma')
  expect(host.textContent).toContain('Bani Park')
  expect(host.textContent).toContain('Paints walls')
  const meet = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Say hello')!
  act(() => meet.click())
  expect(props.onRequest).toHaveBeenCalledWith(asha)
})

it('a resident sees the Jaipur Darshan stamps the person has collected, by name', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ ...full, stamps: ['hawa-mahal', 'university-gate'] })),
  )
  const { host, render } = show('resident', { lang: 'hi' })
  await render()
  const line = host.querySelector('.person-stamps')!
  expect(line.textContent).toContain('Jaipur Darshan · 2/14')
  const names = [...line.querySelectorAll('li')].map((li) => li.textContent)
  expect(names).toEqual(['Hawa Mahal', 'Rajasthan University'])
  expect(line.querySelector('ul')!.getAttribute('aria-label')).toBe('Jaipur Darshan ke stamps')
})

it('no stamps yet: the card has no stamp line', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(full)),
  )
  const { host, render } = show('resident')
  await render()
  expect(host.textContent).toContain('Asha Sharma')
  expect(host.querySelector('.person-stamps')).toBeNull()
})

it.each([
  ['404', async () => json({}, 404)],
  ['network failure', async () => Promise.reject(new Error('offline'))],
])('a resident whose profile fetch fails (%s) still sees name, status and a note', async (_n, impl) => {
  vi.stubGlobal('fetch', vi.fn(impl))
  const { host, render } = show('verified')
  await render()
  expect(host.textContent).toContain('Asha')
  expect(host.textContent).toContain('chai pe aao')
  expect(host.textContent).toContain("Couldn't open the full profile")
})

it('when the person has left, the card stays and "Milna hai" is disabled', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(full)),
  )
  const { host, props, render } = show('verified')
  await render()
  await render({ ...props, gone: true })
  expect(host.textContent).toContain('Asha Sharma')
  expect(host.textContent).toContain('left this street')
  const meet = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Say hello')!
  expect(meet.disabled).toBe(true)
})

describe('reactions on the card', () => {
  const buttons = (host: HTMLElement) => {
    const group = host.querySelector('[role="group"][aria-label="Greet them from here"]')
    return group ? [...group.querySelectorAll('button')] : []
  }

  it('a resident greets from the card with a namaste or a wave, without opening any chat', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(full)),
    )
    const onReact = vi.fn()
    const { host, props, render } = show('resident', { onReact })
    await render()
    const [namaste, wave] = buttons(host)
    expect([namaste!.textContent, wave!.textContent]).toEqual(['Namaste 🙏', 'Wave 👋'])
    act(() => wave!.click())
    expect(onReact).toHaveBeenCalledWith(asha, 'wave')
    act(() => namaste!.click())
    expect(onReact).toHaveBeenLastCalledWith(asha, 'namaste')
    expect(props.onRequest).not.toHaveBeenCalled()
  })

  it('once it reached them the buttons rest and the card says so; gone, they rest too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(full)),
    )
    const { host, props, render } = show('verified', { onReact: vi.fn() })
    await render({ ...props, reacted: 'namaste' })
    expect(buttons(host)).toHaveLength(2)
    expect(buttons(host).every((b) => b.disabled)).toBe(true)
    expect(host.textContent).toContain('Your namaste reached Asha Sharma')
    await render({ ...props, gone: true })
    expect(buttons(host).every((b) => b.disabled)).toBe(true)
  })

  it('a ghost or someone without a finished profile gets no greeting buttons', async () => {
    vi.stubGlobal('fetch', vi.fn())
    for (const viewer of ['ghost', 'incomplete'] as const) {
      const { host, render } = show(viewer, { onReact: vi.fn() })
      await render()
      expect(buttons(host)).toEqual([])
    }
  })
})
