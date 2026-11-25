// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Lang } from '../i18n/strings'
import type { EmoteKind } from '../net/protocol'
import { useEmotes } from '../world/useEmotes'
import { EmoteWheel } from './EmoteWheel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>'
  host = document.getElementById('app')!
  root = createRoot(host)
})
afterEach(() => act(() => root.unmount()))

const play = vi.fn<(kind: EmoteKind) => boolean>(() => true)
beforeEach(() => play.mockClear())

function Wheel({ can, lang }: { can: boolean; lang: Lang }) {
  const emotes = useEmotes(can, play)
  return can ? (
    <EmoteWheel open={emotes.open} lang={lang} onToggle={emotes.toggle} onPick={emotes.pick} />
  ) : null
}
const show = (can = true, lang: Lang = 'hi') => act(() => root.render(<Wheel can={can} lang={lang} />))
const chip = () => host.querySelector<HTMLButtonElement>('.emote-chip')
const kinds = () => [...host.querySelectorAll<HTMLButtonElement>('.emote-kind')]
const key = (code: string, over: KeyboardEventInit = {}, target: EventTarget = window) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...over })))

it('one chip, shut until asked; open, it offers the five by name, in each language', () => {
  show()
  expect(host.querySelectorAll('button')).toHaveLength(1)
  expect(chip()!.getAttribute('aria-label')).toBe('Mood dikhao')
  expect(chip()!.getAttribute('aria-expanded')).toBe('false')
  act(() => chip()!.click())
  expect(chip()!.getAttribute('aria-expanded')).toBe('true')
  expect(host.querySelector('[role="group"]')!.getAttribute('aria-label')).toBe('Mood dikhao')
  expect(kinds().map((b) => b.getAttribute('aria-label'))).toEqual([
    'Naacho',
    'Taali',
    'Baith jao',
    'Selfie pose',
    'Haath hilao',
  ])
  // the marks are decoration: the name is the words
  for (const b of kinds()) expect(b.querySelector('[aria-hidden="true"]')!.textContent).toBe(b.textContent)
  show(true, 'en')
  expect(chip()!.getAttribute('aria-label')).toBe('Show a mood')
  expect(kinds().map((b) => b.getAttribute('aria-label'))).toEqual([
    'Dance',
    'Clap',
    'Sit down',
    'Selfie pose',
    'Wave',
  ])
})

it('picking one plays it and shuts the wheel; the chip shuts it too', () => {
  show()
  act(() => chip()!.click())
  act(() => kinds()[2]!.click())
  expect(play).toHaveBeenCalledExactlyOnceWith('sit')
  expect(kinds()).toHaveLength(0)
  act(() => chip()!.click())
  expect(kinds()).toHaveLength(5)
  act(() => chip()!.click())
  expect(kinds()).toHaveLength(0)
  expect(play).toHaveBeenCalledTimes(1)
})

it('G opens and shuts it, 1 to 5 pick while it is open, Escape shuts it', () => {
  show()
  key('Digit1') // shut: the digits are nobody's
  expect(play).not.toHaveBeenCalled()
  key('KeyG')
  expect(kinds()).toHaveLength(5)
  key('Digit1')
  expect(play).toHaveBeenCalledExactlyOnceWith('dance')
  expect(kinds()).toHaveLength(0)
  key('KeyG')
  key('Digit5')
  expect(play).toHaveBeenLastCalledWith('wave')
  key('KeyG')
  key('Digit6') // no sixth
  expect(play).toHaveBeenCalledTimes(2)
  expect(kinds()).toHaveLength(5)
  key('Escape')
  expect(kinds()).toHaveLength(0)
  key('KeyG')
  key('KeyG')
  expect(kinds()).toHaveLength(0)
})

it('the keys keep out of a text field, a shortcut with a modifier, a held key and an open dialog', () => {
  show()
  const input = document.body.appendChild(document.createElement('input'))
  key('KeyG', {}, input)
  key('KeyG', { ctrlKey: true })
  key('KeyG', { metaKey: true })
  key('KeyG', { repeat: true })
  expect(kinds()).toHaveLength(0)
  const dialog = document.body.appendChild(document.createElement('div'))
  dialog.setAttribute('role', 'dialog')
  key('KeyG')
  expect(kinds()).toHaveLength(0)
  dialog.remove()
  key('KeyG')
  expect(kinds()).toHaveLength(5)
})

it('where the player may not emote there is no chip, the keys do nothing, and an open wheel shuts', () => {
  show(true)
  key('KeyG')
  expect(kinds()).toHaveLength(5)
  show(false) // sat down at a bench, got into an auto
  expect(host.querySelectorAll('button')).toHaveLength(0)
  key('KeyG')
  key('Digit1')
  expect(play).not.toHaveBeenCalled()
  show(true)
  // back on foot: shut, as it starts
  expect(kinds()).toHaveLength(0)
})
