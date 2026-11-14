// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.innerHTML = ''
})

it('shows the intro, then the HUD over a canvas after Padharo, and persists the language', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<App />))

  const enter = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Padharo!')
  expect(enter).toBeTruthy()
  expect(host.querySelector('canvas')).toBeNull()

  await act(async () => enter!.click())
  expect(host.querySelector('canvas')).not.toBeNull()
  expect(host.textContent).toContain('Walled City')

  const toggle = host.querySelector<HTMLButtonElement>('.lang-toggle')!
  await act(async () => toggle.click())
  expect(localStorage.getItem('gg-lang')).toBe('en')
  await act(async () => root.unmount())
})
