// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { goalById } from '../world/today'
import { Hud } from './Hud'
import { Intro } from './Intro'
import { TodayChip, TodaySheet } from './Today'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function render(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(node))
  return host
}

it("the chip is an icon with a short, steady name and the day's goal as its description; done, it says so and wears a tick", async () => {
  const onOpen = vi.fn()
  const goal = goalById('darshan:hawa-mahal')!
  let host = await render(<TodayChip goal={goal} done={false} lang="hi" onOpen={onOpen} />)
  let chip = host.querySelector<HTMLButtonElement>('.today-chip')!
  expect(chip.getAttribute('aria-label')).toBe('Aaj ka Darshan')
  expect(chip.getAttribute('title')).toBe('Aaj ka Darshan: Hawa Mahal ke darshan karo')
  expect(chip.getAttribute('aria-haspopup')).toBe('dialog')
  expect(host.querySelector('.today-tick')).toBeNull()
  await act(async () => chip.click())
  expect(onOpen).toHaveBeenCalledOnce()
  host = await render(<TodayChip goal={goalById('photo')!} done lang="en" onOpen={onOpen} />)
  chip = host.querySelector<HTMLButtonElement>('.today-chip')!
  expect(chip.getAttribute('aria-label')).toBe("Today's Darshan, done")
  expect(chip.getAttribute('title')).toBe("Today's Darshan, done: Take a photo in photo mode")
  expect(chip.hasAttribute('data-done')).toBe(true)
  expect(host.querySelector('.today-tick')).not.toBeNull()
})

it("the sheet says the goal, a hint, whether it is done and the run; a ghost hears the count is this phone's", async () => {
  const host = await render(
    <TodaySheet
      goal={goalById('darshan:jal-mahal')!}
      done={false}
      streak={4}
      best={9}
      local
      lang="en"
      onClose={() => {}}
    />,
  )
  const sheet = host.querySelector('[role="dialog"]')!
  expect(sheet.getAttribute('aria-label')).toBe("Today's Darshan")
  expect(sheet.textContent).toContain('Go and see Jal Mahal')
  expect(sheet.textContent).toContain("It's in Amer.")
  expect(sheet.textContent).toContain('Still to do')
  expect(sheet.textContent).toContain('4 days in a row · longest 9')
  expect(sheet.textContent).toContain('This count lives on this phone only')
  const resident = await render(
    <TodaySheet
      goal={goalById('roof')!}
      done
      streak={1}
      best={1}
      local={false}
      lang="hi"
      onClose={() => {}}
    />,
  )
  expect(resident.textContent).toContain('Aaj ka ho gaya ✓')
  expect(resident.textContent).toContain('Abhi tak 1 din')
  expect(resident.textContent).not.toContain('sirf is phone pe')
})

const hud = (streak: number, extra: Partial<Parameters<typeof Hud>[0]> = {}) => (
  <Hud
    place="Gulabi Shahar"
    snapshot={null}
    stamps="2/13"
    onStamps={() => {}}
    lang="en"
    onLang={() => {}}
    streak={streak}
    today={<TodayChip goal={goalById('map')!} done={false} lang="en" onOpen={() => {}} />}
    {...extra}
  />
)

it('the chip ends the identity row, which shows for it even with no sign-in at all', async () => {
  const host = await render(hud(0))
  const row = host.querySelector('.hud-identity')!
  expect(row.lastElementChild?.classList.contains('today-chip')).toBe(true)
})

it('from three days in a row the stamps chip wears the accent and says so in its tooltip; its name stays the count', async () => {
  let host = await render(hud(2))
  let stamps = host.querySelector('.stamp-count')!
  expect(stamps.hasAttribute('data-streak')).toBe(false)
  host = await render(hud(3))
  stamps = host.querySelector('.stamp-count')!
  expect(stamps.hasAttribute('data-streak')).toBe(true)
  expect(stamps.getAttribute('title')).toBe('Jaipur Darshan stamps · 3-day Darshan run')
  expect(stamps.getAttribute('aria-label')).toBe('Open the Jaipur Darshan list (2/13)')
})

it("the welcome screen names the day's goal in one quiet line", async () => {
  vi.stubGlobal('fetch', async () => Response.json({ people: 0 }))
  const host = await render(
    <Intro lang="hi" onLang={() => {}} onEnter={() => {}} today="Kisi chhat pe chadh ke shahar dekho" />,
  )
  expect(host.querySelector('.intro-today')?.textContent).toBe(
    'Aaj ka Darshan: Kisi chhat pe chadh ke shahar dekho',
  )
})
