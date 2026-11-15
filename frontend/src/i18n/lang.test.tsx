// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { storage } from '../storage'
import { useLang } from './lang'
import { t } from './strings'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  storage.clear()
  document.documentElement.lang = 'hi-Latn'
})

it("the language toggle's name starts with the words it shows (WCAG 2.5.3, label in name)", () => {
  for (const lang of ['hi', 'en'] as const)
    expect(t('langToggleLabel', lang).startsWith(t('langToggle', lang))).toBe(true)
})

it('<html lang> follows the language: Hinglish is hi-Latn, English is en', async () => {
  let setLang: (l: 'hi' | 'en') => void = () => {}
  function Probe() {
    setLang = useLang()[1]
    return null
  }
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root.render(<Probe />))
  expect(document.documentElement.lang).toBe('hi-Latn')
  await act(async () => setLang('en'))
  expect(document.documentElement.lang).toBe('en')
  await act(async () => setLang('hi'))
  expect(document.documentElement.lang).toBe('hi-Latn')
  await act(async () => root.unmount())
})

it('a saved English choice sets it on load', async () => {
  storage.set('gg-lang', 'en')
  function Probe() {
    useLang()
    return null
  }
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  await act(async () => root.render(<Probe />))
  expect(document.documentElement.lang).toBe('en')
  await act(async () => root.unmount())
})
