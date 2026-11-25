// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DISHES, type Serving } from '../world/swaad'
import { DISH_TEXT } from '../world/swaadText'
import { useSwaad } from '../world/useSwaad'
import { storage } from '../storage'
import { DarshanList } from './DarshanList'
import { SwaadCard } from './SwaadCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ''
  storage.clear()
})

async function mount(node: React.ReactElement) {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(node))
  return host
}

const tab = (host: HTMLElement, n: number) => host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[n]!

it('the Darshan sheet has a second tab: all eight dishes, where each is served, a note for the tasted', async () => {
  const host = await mount(
    <DarshanList ids={['hawa-mahal']} dishes={['lassi', 'ghewar']} lang="en" onClose={() => {}} />,
  )
  // it opens on Darshan, as before, with both counts on the tabs
  expect(host.querySelectorAll('li')).toHaveLength(14)
  expect(tab(host, 0).textContent).toBe('Darshan 1/14')
  expect(tab(host, 0).getAttribute('aria-selected')).toBe('true')
  expect(tab(host, 1).textContent).toBe('Swaad 2/8')

  await act(async () => tab(host, 1).click())
  expect(tab(host, 1).getAttribute('aria-selected')).toBe('true')
  expect(host.querySelector('h2')!.textContent).toBe('Jaipur ka Swaad · 2/8')
  expect(host.querySelectorAll('li')).toHaveLength(8)
  expect(host.querySelector('.darshan-card-make')).toBeNull() // "Card banao" is the Darshan tab's
  const lassi = host.querySelector('li[data-id="lassi"]')!
  expect(lassi.getAttribute('data-got')).toBe('true')
  expect(lassi.textContent).toContain(DISH_TEXT.lassi.where.en)
  expect(lassi.textContent).toContain('MI Road & Raja Park · Galta Ji')
  const baati = host.querySelector('li[data-id="dal-baati"]')!
  expect(baati.getAttribute('data-got')).toBe('false')
  expect(baati.textContent).toContain('Dal baati churma')
  expect(baati.textContent).toContain('Nahargarh')
  expect(baati.textContent).not.toContain(DISH_TEXT['dal-baati'].what.en)
  expect(host.querySelector('.swaad-done')).toBeNull()

  await act(async () => tab(host, 0).click())
  expect(host.querySelectorAll('li')).toHaveLength(14)
})

it('a finished list gets a warm line, in Hinglish by default', async () => {
  const host = await mount(<DarshanList ids={[]} dishes={[...DISHES]} lang="hi" onClose={() => {}} />)
  await act(async () => tab(host, 1).click())
  expect(host.querySelector('h2')!.textContent).toBe('Jaipur ka Swaad · 8/8')
  expect(host.querySelector('.swaad-done')!.textContent).toContain('Aathon swaad')
  expect(host.querySelectorAll('li[data-got="true"]')).toHaveLength(8)
})

it('without a tasting list the sheet is the Darshan list alone', async () => {
  const host = await mount(<DarshanList ids={[]} lang="en" onClose={() => {}} />)
  expect(host.querySelector('[role="tablist"]')).toBeNull()
  expect(host.querySelectorAll('li')).toHaveLength(14)
})

it("the card: the dish, the vendor's line, what it is and where it is loved, and a way to close", async () => {
  const onClose = vi.fn()
  const host = await mount(<SwaadCard dish="ghewar" lang="en" onClose={onClose} />)
  const card = host.querySelector('section')!
  expect(card.getAttribute('aria-label')).toBe('Ghewar')
  expect(card.textContent).toContain(DISH_TEXT.ghewar.vendor.en)
  expect(card.textContent).toContain(DISH_TEXT.ghewar.what.en)
  expect(card.textContent).toContain('Johari Bazaar')
  await act(async () => card.querySelector('button')!.click())
  expect(onClose).toHaveBeenCalled()
})

it('useSwaad: a taste opens the card and grows the list; walking off, or to another stall, puts the card away', async () => {
  let swaad!: ReturnType<typeof useSwaad>
  function Probe() {
    swaad = useSwaad()
    return null
  }
  await mount(<Probe />)
  const kulfi: Serving = { district: 'walled-city', x: 56, z: -7.4, dish: 'kulfi' }
  const chai: Serving = { district: 'walled-city', x: 46, z: 19, dish: 'chai' }
  const taste = vi.fn()
  swaad.bind({ taste })
  swaad.taste()
  expect(taste).toHaveBeenCalled()

  await act(async () => swaad.hooks.near(kulfi))
  expect(swaad.near).toBe(kulfi)
  expect(swaad.card).toBeNull()
  storage.set('gg-tasted', '["kulfi"]')
  await act(async () => swaad.hooks.tasted(kulfi, true))
  expect(swaad.card).toBe(kulfi)
  expect(swaad.have).toEqual(['kulfi'])
  await act(async () => swaad.hooks.near(kulfi)) // still there
  expect(swaad.card).toBe(kulfi)
  await act(async () => swaad.hooks.near(chai))
  expect(swaad.card).toBeNull()
  await act(async () => swaad.hooks.tasted(chai, false))
  await act(async () => swaad.close())
  expect(swaad.card).toBeNull()
  await act(async () => swaad.hooks.tasted(chai, false))
  await act(async () => swaad.hooks.near(null))
  expect(swaad.card).toBeNull()
  expect(swaad.near).toBeNull()
})
