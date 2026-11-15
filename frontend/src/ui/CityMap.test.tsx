// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { benchesOf } from '../world/benches'
import walledCity from '../world/districts/walledCity'
import amer from '../world/districts/amer'
import { wallsOf } from '../world/posters'
import { CityMap, type MapView } from './CityMap'
import { Compass } from './Compass'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ''
})

const VIEW: MapView = { you: { x: 1.5, z: 44 }, heading: Math.PI, people: [{ x: 4, z: 40 }] }

async function mount(over: Partial<Parameters<typeof CityMap>[0]> = {}) {
  const host = document.body.appendChild(document.createElement('div'))
  const props = {
    def: walledCity,
    stamped: ['hawa-mahal'],
    read: () => VIEW,
    lang: 'en' as const,
    onPick: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  const root = createRoot(host)
  await act(async () => root.render(<CityMap {...props} />))
  const buttons = () => [...host.querySelectorAll('button')]
  const named = (name: string) =>
    buttons().filter((b) => b.getAttribute('aria-label') === name || b.textContent === name)
  return { host, props, buttons, named, root }
}

it('is a modal dialog named "Map", drawn from the district: its paving, every building, every place', async () => {
  const { host, buttons } = await mount()
  const dialog = host.querySelector('[role="dialog"]')!
  expect(dialog.getAttribute('aria-modal')).toBe('true')
  expect(dialog.getAttribute('aria-label')).toBe('Map · Pink City')
  expect(host.querySelectorAll('.map-block')).toHaveLength(walledCity.buildings.length)
  expect(host.querySelectorAll('.map-paving')).toHaveLength(walledCity.paving.length)
  // every place on it is a button with a name
  const places = buttons().filter((b) => b.classList.contains('map-item'))
  expect(places).toHaveLength(
    walledCity.landmarks.length + 1 + benchesOf(walledCity).length + wallsOf(walledCity).length,
  )
  for (const b of places) expect(b.getAttribute('aria-label')).toBeTruthy()
  const label = (b: HTMLButtonElement) => b.getAttribute('aria-label')!
  // landmarks say whether they are stamped
  expect(places.map(label)).toContain('Hawa Mahal (stamp collected)')
  expect(places.map(label)).toContain('Jantar Mantar')
  expect(places.map(label)).toContain('Metro station')
  expect(places.some((b) => label(b).startsWith('Chai stall'))).toBe(true)
  expect(places.some((b) => label(b).startsWith('Poster wall'))).toBe(true)
  expect(host.querySelector('.map-item[data-stamped]')!.getAttribute('aria-label')).toBe(
    'Hawa Mahal (stamp collected)',
  )
})

it('shows you, with your heading, and the people drawn on the street as plain dots (no names)', async () => {
  const { host } = await mount()
  const you = host.querySelector('.map-you')!
  expect(you).not.toBeNull()
  // facing north (heading π, since 0 faces +z): the arrow, drawn pointing north, turns by 180 - 180 = 0
  expect(you.getAttribute('transform')).toContain('rotate(0')
  expect(host.querySelectorAll('.map-person')).toHaveLength(1)
  expect(host.querySelector('.map-people')!.textContent).not.toContain('asha')
})

it('privacy: with nobody drawn on the street, no dot at all', async () => {
  const { host } = await mount({ read: () => ({ ...VIEW, people: [] }) })
  expect(host.querySelectorAll('.map-person')).toHaveLength(0)
})

it('tapping a place picks it as the target; Escape and the close button close', async () => {
  const { props, named } = await mount()
  await act(async () => named('Hawa Mahal (stamp collected)')[0]!.click())
  expect(props.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'hawa-mahal', kind: 'landmark' }))
  await act(async () => named('Metro station')[0]!.click())
  expect(props.onPick).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'metro' }))
  await act(async () => named('Close')[0]!.click())
  expect(props.onClose).toHaveBeenCalledOnce()
  await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(props.onClose).toHaveBeenCalledTimes(2)
})

it('the list under the map names the landmarks and the metro with how far each is', async () => {
  const { host } = await mount()
  const list = [...host.querySelectorAll('.map-list button[data-id]')].map((b) => b.textContent)
  // from (1.5, 44): Badi Chaupar's 8.4 m fountain is 39.8 m north
  expect(list).toContain('Badi Chaupar · 40 m')
  expect(list.some((s) => s?.startsWith('Metro station · '))).toBe(true)
})

/** The metres at the end of a list row. */
const metresOf = (b: Element) => Number(/· (\d+) m$/.exec(b.textContent ?? '')![1])

it('every place on the map has a row in the list too, nearest first: benches and walls past the first few fold away', async () => {
  const { host, props } = await mount()
  const main = [...host.querySelectorAll('.map-list:not(.map-more-list) button[data-id]')]
  const more = [...host.querySelectorAll('.map-more .map-list button[data-id]')]
  // every target is reachable from a row (a 22 px dot is too small to tap among its neighbours)
  const ids = [...main, ...more].map((b) => b.getAttribute('data-id'))
  expect(new Set(ids)).toEqual(
    new Set([...host.querySelectorAll('.map-item')].map((b) => b.getAttribute('data-id'))),
  )
  // the landmarks, the metro and the three nearest seats, nearest first
  expect(
    main.map((b) => b.getAttribute('data-kind')).filter((k) => k === 'bench' || k === 'tapri'),
  ).toHaveLength(3)
  for (const k of ['landmark', 'metro'])
    expect(more.some((b) => b.getAttribute('data-kind') === k)).toBe(false)
  const sorted = (rows: Element[]) => rows.map(metresOf).every((m, i, all) => i === 0 || all[i - 1]! <= m)
  expect(sorted(main)).toBe(true)
  expect(sorted(more)).toBe(true)
  // the fold is a native disclosure, closed until opened
  expect(host.querySelector('details.map-more')!.hasAttribute('open')).toBe(false)
  await act(async () => (more[0] as HTMLButtonElement).click())
  expect(props.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: more[0]!.getAttribute('data-id') }))
})

it('landmarks come first in the map, so a screen reader meets them before forty benches', async () => {
  const { host } = await mount()
  const kinds = [...host.querySelectorAll('.map-item')].map((b) => b.getAttribute('data-kind'))
  expect(kinds.slice(0, walledCity.landmarks.length).every((k) => k === 'landmark')).toBe(true)
})

it('the compass names the target with its distance, turns its arrow, and a tap clears it', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  const onClear = vi.fn()
  let push: (r: { distance: number; angle: number } | null) => void = () => {}
  const watch = (cb: typeof push) => {
    push = cb
    return () => {}
  }
  await act(async () =>
    createRoot(host).render(<Compass name="Hawa Mahal" watch={watch} lang="en" onClear={onClear} />),
  )
  await act(async () => push({ distance: 120, angle: 30 }))
  const button = host.querySelector('button')!
  expect(button.textContent).toContain('Hawa Mahal · 120 m')
  expect((host.querySelector('.compass-arrow') as HTMLElement).style.transform).toBe('rotate(30deg)')
  await act(async () => button.click())
  expect(onClear).toHaveBeenCalledOnce()
})

it('every row in the list has "Bulao": the link to that place, without picking it', async () => {
  const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {})
  vi.stubGlobal('navigator', { share })
  try {
    const { host, props } = await mount()
    const rows = [...host.querySelectorAll('.map-list li')]
    expect(rows.length).toBe(host.querySelectorAll('.map-item').length)
    for (const li of rows) expect(li.querySelector('button.map-invite')!.textContent).toBe('Invite')
    const hawa = rows.find((li) => li.querySelector('[data-id="hawa-mahal"]'))!
    await act(async () => hawa.querySelector<HTMLButtonElement>('button.map-invite')!.click())
    expect(share).toHaveBeenCalledWith({
      text: "Come to Hawa Mahal in Gulabi Gali — let's meet there!",
      url: 'https://gulabi-gali.manishbisht.me/?at=walled-city:hawa-mahal',
    })
    const wall = rows.find((li) => li.querySelector('[data-kind="poster"]'))!
    await act(async () => wall.querySelector<HTMLButtonElement>('button.map-invite')!.click())
    expect(share.mock.lastCall![0].url).toMatch(/\?at=walled-city:poster-\d+$/)
    expect(props.onPick).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

it("Amer's stop is the bus stand: a B in the bus's marigold, not the metro's M; the metro's stays as it was", async () => {
  const bus = await mount({ def: amer, stamped: [], read: () => ({ ...VIEW, you: amer.spawn }) })
  const stop = bus.host.querySelector<HTMLButtonElement>('.map-item[data-kind="metro"]')!
  expect(stop.getAttribute('data-by')).toBe('bus')
  expect(stop.textContent).toBe('B')
  expect(stop.getAttribute('aria-label')).toBe('Bus stop')
  document.body.innerHTML = ''
  const metro = await mount()
  const m = metro.host.querySelector<HTMLButtonElement>('.map-item[data-kind="metro"]')!
  expect(m.getAttribute('data-by')).toBe('metro')
  expect(m.textContent).toBe('M')
})
