// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The build flag `__GG_ANALYTICS__` stands behind, switched per test (the sheet reads it when it loads). */
const flags = vi.hoisted(() => ({ analytics: false }))
vi.mock('../buildFlags', () => ({
  get ANALYTICS_ON() {
    return flags.analytics
  },
}))

afterEach(() => {
  document.body.innerHTML = ''
})

async function sheet(analytics: boolean, lang: 'hi' | 'en') {
  flags.analytics = analytics
  vi.resetModules()
  const { PrivacySheet } = await import('./PrivacySheet')
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<PrivacySheet lang={lang} onClose={() => {}} />))
  const text = host.textContent ?? ''
  await act(async () => root.unmount())
  return text
}

it('a build without the Web Analytics token says nothing about it', async () => {
  for (const lang of ['hi', 'en'] as const) {
    const text = await sheet(false, lang)
    expect(text).not.toMatch(/Cloudflare|Analytics/)
    // the error reports are still described
    expect(text).toMatch(
      lang === 'en' ? /When something breaks on the page/ : /Jab page pe kuch toot jaata hai/,
    )
  }
})

it('a build with it says plainly that Cloudflare, an outside company, counts the visits, without cookies', async () => {
  const en = await sheet(true, 'en')
  expect(en).toContain('Cloudflare, an outside company, counts the visits to this site')
  expect(en).toMatch(/no cookies/)
  const hi = await sheet(true, 'hi')
  expect(hi).toMatch(/Cloudflare \(ek bahar ki company\) ginta hai/)
  expect(hi).toMatch(/koi cookie nahi/)
  expect(hi).toMatch(/aapka naam/)
  expect(hi).not.toMatch(/\btum(hara|hare|he)?\b/)
})
