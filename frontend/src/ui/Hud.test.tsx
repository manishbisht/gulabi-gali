// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Hud } from './Hud'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ''
})

async function mount(onMap?: () => void) {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () =>
    createRoot(host).render(
      <Hud place="Gulabi Shahar" snapshot={null} stamps="0/9" lang="hi" onLang={() => {}} onMap={onMap} />,
    ),
  )
  return host
}

it('the place chip is the map button: named for the map and the place, M, and it opens a dialog', async () => {
  const onMap = vi.fn()
  const host = await mount(onMap)
  const chip = host.querySelector('.hud-top .hud-chip')!
  expect(chip.tagName).toBe('BUTTON')
  expect(chip.classList.contains('place-button')).toBe(true)
  expect(chip.getAttribute('aria-label')).toBe('Naksha · Gulabi Shahar')
  expect(chip.getAttribute('aria-keyshortcuts')).toBe('M')
  expect(chip.getAttribute('aria-haspopup')).toBe('dialog')
  expect(chip.textContent).toContain('Gulabi Shahar')
  await act(async () => (chip as HTMLButtonElement).click())
  expect(onMap).toHaveBeenCalledOnce()
  // no second map control anywhere
  expect(host.querySelector('.map-button')).toBeNull()
})

it('a short place name shows on the chip while the full name stays its accessible name', async () => {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () =>
    createRoot(host).render(
      <Hud
        place="MI Road–Raja Park"
        placeShort="MI Road"
        snapshot={null}
        stamps="0/9"
        lang="hi"
        onLang={() => {}}
        onMap={() => {}}
      />,
    ),
  )
  const chip = host.querySelector('.hud-top .hud-chip')!
  expect(chip.textContent).toBe('MI Road')
  // label in name: the visible text is part of the accessible name
  expect(chip.getAttribute('aria-label')).toBe('Naksha · MI Road–Raja Park')
  expect(chip.getAttribute('aria-label')).toContain(chip.textContent!)
})

it('before a district is in (no onMap) the place is plain text', async () => {
  const host = await mount()
  const chip = host.querySelector('.hud-top .hud-chip')!
  expect(chip.tagName).toBe('SPAN')
})
