// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { DistrictId } from '../net/protocol'
import { TravelSheet } from './TravelSheet'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ''
})

async function mount(here: DistrictId, lang: 'hi' | 'en' = 'hi') {
  const onPick = vi.fn()
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () =>
    root.render(<TravelSheet here={here} lang={lang} onPick={onPick} onClose={() => {}} />),
  )
  const stops = [...host.querySelectorAll<HTMLButtonElement>('.travel-stop')]
  return { host, onPick, stops }
}

it('lists the metro stops by name, then Amer and Nahargarh last, by bus, looking different', async () => {
  const { stops, onPick } = await mount('walled-city')
  expect(stops.map((b) => b.getAttribute('data-by'))).toEqual(['metro', 'metro', 'metro', 'bus', 'bus'])
  expect(stops.slice(0, 3).map((b) => b.textContent)).toEqual([
    'MI Road–Raja Park',
    'University–JKK',
    'Malviya Nagar–WTP',
  ])
  const amer = stops[3]!
  // its name is what it shows (label in name): the place, then "Bus", nothing hidden or added
  expect(amer.getAttribute('aria-label')).toBeNull()
  expect(amer.querySelector('[aria-hidden]')).toBeNull()
  expect(amer.textContent).toBe('Amer Bus')
  expect(amer.querySelector('.travel-by')!.textContent).toBe('Bus')
  await act(async () => amer.click())
  expect(onPick).toHaveBeenCalledWith('amer')
  const ridge = stops[4]!
  expect(ridge.getAttribute('aria-label')).toBeNull()
  expect(ridge.textContent).toBe('Nahargarh Bus')
  await act(async () => ridge.click())
  expect(onPick).toHaveBeenCalledWith('nahargarh')
})

it('from Amer, every stop is by bus', async () => {
  const { stops } = await mount('amer', 'en')
  expect(stops).toHaveLength(5)
  expect(stops.map((b) => b.getAttribute('data-by'))).toEqual(['bus', 'bus', 'bus', 'bus', 'bus'])
  expect(stops[0]!.textContent).toBe('Pink City Bus')
  expect(stops[0]!.getAttribute('aria-label')).toBeNull()
})

it('from Nahargarh, every stop is by bus, Amer too', async () => {
  const { stops } = await mount('nahargarh', 'en')
  expect(stops.map((b) => b.getAttribute('data-id'))).toEqual([
    'walled-city',
    'mi-road',
    'university',
    'malviya-nagar',
    'amer',
  ])
  expect(stops.every((b) => b.getAttribute('data-by') === 'bus')).toBe(true)
  expect(stops[4]!.textContent).toBe('Amer Bus')
})
