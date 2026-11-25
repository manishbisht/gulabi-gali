// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const cards = vi.hoisted(() => ({ compose: vi.fn(), share: vi.fn() }))
vi.mock('./cards', () => ({ composeDarshanCard: cards.compose }))
vi.mock('./share', async (real) => ({ ...(await real<typeof import('./share')>()), shareImage: cards.share }))
import { DarshanList } from './DarshanList'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const card = new Blob(['c'], { type: 'image/png' })
beforeEach(() => {
  cards.compose.mockReset().mockResolvedValue(card)
  cards.share.mockReset().mockResolvedValue('downloaded')
  URL.createObjectURL = vi.fn(() => 'blob:card')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  document.body.innerHTML = ''
})

async function mount(node: React.ReactElement) {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(node))
  return host
}
const make = (host: HTMLElement) =>
  act(async () => host.querySelector<HTMLButtonElement>('.darshan-card-make')!.click())

it('"Card banao" makes the card of the stamps, with no name by default, and saves it', async () => {
  const host = await mount(
    <DarshanList ids={['hawa-mahal']} lang="hi" name="Aarav Sharma" streak={4} onClose={() => {}} />,
  )
  const button = host.querySelector<HTMLButtonElement>('.darshan-card-make')!
  expect(button.textContent).toBe('Card banao')
  const tick = host.querySelector<HTMLInputElement>('.darshan-card input[type="checkbox"]')!
  expect(tick.checked).toBe(false)
  expect(tick.closest('label')!.textContent).toBe('Naam dikhao')
  await make(host)
  expect(cards.compose).toHaveBeenCalledWith({ ids: ['hawa-mahal'], lang: 'hi', name: null, streak: 4 })
  expect(cards.share.mock.calls[0]![0]).toBe(card)
  expect(cards.share.mock.calls[0]![1]).toMatch(/^gulabi-gali-darshan-\d{8}-\d{6}\.png$/)
  expect(host.querySelector('.darshan-card-note')!.textContent).toBe('Card aapke phone mein save ho gaya.')
})

it('with "naam dikhao" ticked, only the first name goes on the card', async () => {
  const host = await mount(<DarshanList ids={[]} lang="en" name="Aarav Sharma" onClose={() => {}} />)
  await act(async () => host.querySelector<HTMLInputElement>('.darshan-card input[type="checkbox"]')!.click())
  await make(host)
  expect(cards.compose.mock.calls[0]![0]).toMatchObject({ name: 'Aarav' })
})

it('the tick is not remembered: the sheet opens with it off every time', async () => {
  const first = await mount(<DarshanList ids={[]} lang="en" name="Aarav" onClose={() => {}} />)
  await act(async () => first.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
  document.body.innerHTML = ''
  const again = await mount(<DarshanList ids={[]} lang="en" name="Aarav" onClose={() => {}} />)
  expect(again.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false)
})

it('a guest (no name) gets the card but no "naam dikhao", and no name on it', async () => {
  const host = await mount(<DarshanList ids={['jkk']} lang="en" onClose={() => {}} />)
  expect(host.querySelector('.darshan-card input')).toBeNull()
  await make(host)
  expect(cards.compose.mock.calls[0]![0]).toMatchObject({ name: null, streak: 0 })
})

it("in Instagram's browser the card opens alone to press and save; Escape closes it and keeps the sheet", async () => {
  cards.share.mockResolvedValue('hold')
  const onClose = vi.fn()
  const host = await mount(<DarshanList ids={[]} lang="hi" onClose={onClose} />)
  await make(host)
  const hold = document.querySelector<HTMLElement>('[aria-label="Tasveer save karo"]')!
  expect(hold.getAttribute('role')).toBe('dialog')
  expect(hold.textContent).toContain('Photo pe der tak dabao aur save karo')
  expect(hold.querySelector('img')!.getAttribute('src')).toBe('blob:card')
  expect(document.activeElement).toBe(hold) // focus moved into it
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  expect(document.querySelector('[aria-label="Tasveer save karo"]')).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:card')
  expect(onClose).not.toHaveBeenCalled()
  expect(host.querySelector('.darshan-sheet')).not.toBeNull()
})

it('a card that cannot be made says so, and can be tried again', async () => {
  cards.compose.mockRejectedValue(new Error('no 2d canvas'))
  const host = await mount(<DarshanList ids={[]} lang="en" onClose={() => {}} />)
  await make(host)
  expect(host.querySelector('.darshan-card-note')!.textContent).toBe("Couldn't make the card. Try again.")
  expect(host.querySelector<HTMLButtonElement>('.darshan-card-make')!.disabled).toBe(false)
  expect(cards.share).not.toHaveBeenCalled()
})
