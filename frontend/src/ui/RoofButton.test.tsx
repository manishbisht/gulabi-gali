// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useRooftop } from '../world/useRooftop'
import { RoofButton, RoofNotice } from './RoofButton'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  host = document.getElementById('app')!
  root = createRoot(host)
})
afterEach(() => act(() => root.unmount()))

type State = { near: boolean; up: boolean; fading: boolean }
const show = (s: State) => act(() => root.render(<RoofButton {...s} lang="en" onClimb={() => {}} />))
const button = () => host.querySelector('button')

it('stays the focused button all the way up and back down, whatever the fade does in between', () => {
  show({ near: true, up: false, fading: false })
  button()!.focus()
  const steps: [State, string][] = [
    [{ near: true, up: false, fading: true }, 'Up to the roof'],
    [{ near: false, up: false, fading: true }, 'Up to the roof'],
    [{ near: false, up: true, fading: true }, 'Back down'],
    [{ near: false, up: true, fading: false }, 'Back down'],
    [{ near: false, up: true, fading: true }, 'Back down'],
    [{ near: false, up: false, fading: true }, 'Back down'],
    [{ near: true, up: false, fading: true }, 'Up to the roof'],
    [{ near: true, up: false, fading: false }, 'Up to the roof'],
  ]
  for (const [state, label] of steps) {
    show(state)
    expect(button()?.textContent).toBe(label)
    expect(document.activeElement).toBe(button())
  }
  show({ near: false, up: false, fading: false }) // walked off
  expect(button()).toBeNull()
})

/** The hook, and what a page shows for it. */
function Harness({ grab, lang }: { grab: (r: ReturnType<typeof useRooftop>) => void; lang: 'hi' | 'en' }) {
  const roof = useRooftop()
  grab(roof)
  return <RoofNotice notice={roof.notice} lang={lang} />
}

it('says politely, in the language on screen, when the player arrives up on the roof and back down', () => {
  let roof!: ReturnType<typeof useRooftop>
  const render = (lang: 'hi' | 'en') =>
    act(() => root.render(<Harness grab={(r) => (roof = r)} lang={lang} />))
  render('en')
  const region = host.querySelector('[aria-live]')!
  expect(region.getAttribute('aria-live')).toBe('polite')
  expect(region.textContent).toBe('')
  act(() => roof.hooks.up(true))
  expect(region.textContent).toBe("You're up on the roof.")
  render('hi')
  expect(region.textContent).toBe('Chhat pe aa gaye.')
  act(() => roof.hooks.up(false))
  expect(region.textContent).toBe('Neeche gali mein aa gaye.')
  // the region was there all along, so a screen reader hears the change
  expect(host.querySelector('[aria-live]')).toBe(region)
})
