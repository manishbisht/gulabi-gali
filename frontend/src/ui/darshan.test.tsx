// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { STAMPS } from '../world/stamps'
import { STAMP_DISTRICT, STAMP_RIDDLE } from '../world/darshan'
import { DISTRICT_NAMES } from '../world/districtNames'
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

it('the list has all 13 landmarks: the collected with name and district, the rest with a riddle and district', async () => {
  const host = await mount(<DarshanList ids={['hawa-mahal', 'wtp']} lang="en" onClose={() => {}} />)
  expect(host.querySelectorAll('li')).toHaveLength(13)
  const hawa = host.querySelector('li[data-id="hawa-mahal"]')!
  expect(hawa.getAttribute('data-got')).toBe('true')
  expect(hawa.textContent).toContain('Hawa Mahal')
  expect(hawa.textContent).toContain('Pink City')
  const jkk = host.querySelector('li[data-id="jkk"]')!
  expect(jkk.getAttribute('data-got')).toBe('false')
  expect(jkk.textContent).not.toContain('Jawahar')
  expect(jkk.textContent).toContain(STAMP_RIDDLE.jkk.en)
  expect(jkk.textContent).toContain('University & JKK')
  expect(host.textContent).toContain('2/13')
  expect(host.querySelector('.darshan-badge')).toBeNull()
})

/** Letters only, doubled letters folded: "baagh" and "bagh" are the same word to a reader. */
const fold = (w: string) =>
  w
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1')

it('no riddle gives its landmark away, even in part, and every one is bilingual', () => {
  for (const s of STAMPS) {
    // every distinctive word (4+ letters) of the landmark's name, in either language
    const tokens = new Set(
      [s.hi, s.en].flatMap((n) => n.split(/[^A-Za-z]+/).filter((w) => w.length >= 4)).map(fold),
    )
    for (const lang of ['hi', 'en'] as const) {
      const riddle = STAMP_RIDDLE[s.id][lang]
      expect(riddle.length).toBeGreaterThan(10)
      expect(riddle.length).toBeLessThan(110)
      const words = riddle.split(/[^A-Za-z]+/).map(fold)
      for (const token of tokens) {
        expect(
          words.some((w) => w.includes(token)),
          `${s.id} ${lang} riddle uses "${token}"`,
        ).toBe(false)
      }
    }
  }
})

it('every stamp has a district and a riddle in both languages', () => {
  for (const s of STAMPS) {
    expect(STAMP_DISTRICT[s.id], s.id).toBeTruthy()
    expect(Object.keys(DISTRICT_NAMES)).toContain(STAMP_DISTRICT[s.id])
    expect(STAMP_RIDDLE[s.id]?.hi.trim(), `${s.id} hi`).toBeTruthy()
    expect(STAMP_RIDDLE[s.id]?.en.trim(), `${s.id} en`).toBeTruthy()
  }
})

it('the close control is in the header, so a phone needs no scrolling to reach it', async () => {
  const onClose = vi.fn()
  const host = await mount(<DarshanList ids={[]} lang="en" onClose={onClose} />)
  const x = host.querySelector<HTMLButtonElement>('.darshan-head .darshan-x')!
  await act(async () => x.click())
  expect(onClose).toHaveBeenCalled()
})

it('the list speaks Hinglish and closes', async () => {
  const onClose = vi.fn()
  const host = await mount(<DarshanList ids={[]} lang="hi" onClose={onClose} />)
  expect(host.querySelector('li[data-id="wtp"]')!.textContent).toContain('Malviya Nagar')
  expect(host.querySelector('li[data-id="wtp"]')!.textContent).toContain(STAMP_RIDDLE.wtp.hi)
  expect(host.querySelector('li[data-id="amer-fort"]')!.textContent).toContain('Amer')
  expect(host.querySelector('li[data-id="amer-fort"]')!.textContent).toContain(STAMP_RIDDLE['amer-fort'].hi)
  expect(host.querySelector('li[data-id="nahargarh-fort"]')!.textContent).toContain('Nahargarh')
  expect(host.querySelector('li[data-id="nahargarh-fort"]')!.textContent).toContain(
    STAMP_RIDDLE['nahargarh-fort'].hi,
  )
  expect(host.querySelector('li[data-id="jal-mahal"]')!.textContent).toContain('Amer')
  expect(host.querySelector('li[data-id="jal-mahal"]')!.textContent).toContain(STAMP_RIDDLE['jal-mahal'].hi)
  expect(host.querySelector('li[data-id="city-palace"]')!.textContent).toContain('Gulabi Shahar')
  expect(host.querySelector('li[data-id="city-palace"]')!.textContent).toContain(
    STAMP_RIDDLE['city-palace'].hi,
  )
  await act(async () => host.querySelector<HTMLButtonElement>('.auth-close')!.click())
  expect(onClose).toHaveBeenCalled()
})

it('the badge shows at 13/13 and not at 12/13', async () => {
  const eight = await mount(<StampsLine ids={ALL.slice(1)} lang="en" />)
  expect(eight.querySelector('.darshan-badge')).toBeNull()
  const ten = await mount(<StampsLine ids={ALL} lang="en" />)
  expect(ten.querySelector('.darshan-badge')!.textContent).toBe('Jaipur Darshan complete')
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
    <Hud place="x" snapshot={null} stamps="1/13" lang="en" onLang={() => {}} onStamps={onStamps} />,
  )
  const chip = host.querySelector<HTMLButtonElement>('button.stamp-count')!
  expect(chip.textContent).toBe('1/13')
  await act(async () => chip.click())
  expect(onStamps).toHaveBeenCalled()
})

it('at every stamp the chip says a short "✓ 13", so the top row keeps its room; its name still has 13/13', async () => {
  const host = await mount(
    <Hud place="x" snapshot={null} stamps="13/13" lang="hi" onLang={() => {}} onStamps={() => {}} />,
  )
  const chip = host.querySelector<HTMLButtonElement>('button.stamp-count')!
  expect(chip.textContent).toBe('✓ 13')
  expect(chip.getAttribute('aria-label')).toBe('Jaipur Darshan ki list kholo (13/13)')
  expect(chip.getAttribute('data-done')).toBe('')
  const ten = await mount(
    <Hud place="x" snapshot={null} stamps="12/13" lang="hi" onLang={() => {}} onStamps={() => {}} />,
  )
  expect(ten.querySelector('button.stamp-count')!.textContent).toBe('12/13')
  expect(ten.querySelector('button.stamp-count')!.hasAttribute('data-done')).toBe(false)
})
