// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { STAMPS } from '../world/stamps'
import { STAMP_RIDDLE } from '../world/darshan'
import type { FullProfile, LivePerson } from '../net/protocol'
import { DarshanList } from './DarshanList'
import { Hud } from './Hud'
import { PersonCard } from './PersonCard'
import { StampsLine } from './StampsLine'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

const ALL = STAMPS.map((s) => s.id)

async function mount(node: React.ReactElement) {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(node))
  return host
}

it('the list has all 9 landmarks: the collected with name and district, the rest with a riddle and district', async () => {
  const host = await mount(<DarshanList ids={['hawa-mahal', 'wtp']} lang="en" onClose={() => {}} />)
  expect(host.querySelectorAll('li')).toHaveLength(9)
  const hawa = host.querySelector('li[data-id="hawa-mahal"]')!
  expect(hawa.getAttribute('data-got')).toBe('true')
  expect(hawa.textContent).toContain('Hawa Mahal')
  expect(hawa.textContent).toContain('Pink City')
  const jkk = host.querySelector('li[data-id="jkk"]')!
  expect(jkk.getAttribute('data-got')).toBe('false')
  expect(jkk.textContent).not.toContain('Jawahar')
  expect(jkk.textContent).toContain(STAMP_RIDDLE.jkk.en)
  expect(jkk.textContent).toContain('University & JKK')
  expect(host.textContent).toContain('2/9')
  expect(host.querySelector('.darshan-badge')).toBeNull()
})

it('no riddle gives its landmark away, and every one is bilingual', () => {
  for (const s of STAMPS) {
    for (const lang of ['hi', 'en'] as const) {
      const riddle = STAMP_RIDDLE[s.id][lang]
      expect(riddle.length).toBeGreaterThan(10)
      expect(riddle.length).toBeLessThan(110)
      expect(riddle.toLowerCase()).not.toContain(s[lang].toLowerCase())
    }
  }
})

it('the list speaks Hinglish and closes', async () => {
  const onClose = vi.fn()
  const host = await mount(<DarshanList ids={[]} lang="hi" onClose={onClose} />)
  expect(host.querySelector('li[data-id="wtp"]')!.textContent).toContain('Malviya Nagar')
  expect(host.querySelector('li[data-id="wtp"]')!.textContent).toContain(STAMP_RIDDLE.wtp.hi)
  await act(async () => host.querySelector<HTMLButtonElement>('.auth-close')!.click())
  expect(onClose).toHaveBeenCalled()
})

it('the badge shows at 9/9 and not at 8/9', async () => {
  const eight = await mount(<StampsLine ids={ALL.slice(1)} lang="en" />)
  expect(eight.querySelector('.darshan-badge')).toBeNull()
  const nine = await mount(<StampsLine ids={ALL} lang="en" />)
  expect(nine.querySelector('.darshan-badge')!.textContent).toBe('Jaipur Darshan complete')
  const hi = await mount(<StampsLine ids={ALL} lang="hi" />)
  expect(hi.querySelector('.darshan-badge')!.textContent).toBe('Jaipur Darshan poora')
  const list = await mount(<DarshanList ids={ALL} lang="en" onClose={() => {}} />)
  expect(list.querySelector('.darshan-badge')).not.toBeNull()
})

it("the person card shows a complete collector's badge", async () => {
  const person = { id: 'p1', name: 'Asha', look: { skin: 0, outfit: 'pink', head: 'none' }, status: '' }
  const profile = {
    id: 'p1',
    name: 'Asha',
    homeArea: 'Mansarovar',
    hereFor: null,
    about: '',
    stamps: ALL,
  } as unknown as FullProfile
  vi.stubGlobal('fetch', async () => Response.json(profile))
  const host = await mount(
    <PersonCard
      person={person as unknown as LivePerson}
      gone={false}
      viewer="resident"
      lang="en"
      token={async () => 'tok'}
      onVisible={() => {}}
      onGetVerified={() => {}}
      onRequest={() => {}}
      onClose={() => {}}
    />,
  )
  await vi.waitFor(() => expect(host.querySelector('.darshan-badge')).not.toBeNull())
})

it('the stamps chip in the HUD opens the list', async () => {
  const onStamps = vi.fn()
  const host = await mount(
    <Hud place="x" snapshot={null} stamps="1/9" lang="en" onLang={() => {}} onStamps={onStamps} />,
  )
  const chip = host.querySelector<HTMLButtonElement>('button.stamp-count')!
  expect(chip.textContent).toBe('1/9')
  await act(async () => chip.click())
  expect(onStamps).toHaveBeenCalled()
})
