// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Stage } from '../engine/stage'
import type { Controls } from '../player/controls'
import type { CricketProps } from './Cricket'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The chunk arrives: a stand-in game. */
const arrives = () =>
  vi.doMock('./Cricket', () => {
    return {
      default: ({ onExit }: CricketProps) => (
        <div className="cricket" role="dialog">
          <button type="button" onClick={onExit}>
            stop
          </button>
        </div>
      ),
    }
  })
/** The chunk cannot be had (a tab open across a deploy, a flaky network). */
const fails = () =>
  vi.doMock('./Cricket', () => {
    throw new Error('chunk gone')
  })

let root: Root
const props = (onExit: () => void): CricketProps => ({
  lang: 'hi',
  stage: {} as Stage,
  controls: {} as Controls,
  pitch: { stumps: { x: 0, z: 0 }, bowler: { x: 7, z: 0 } },
  onExit,
})

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = '<div id="app"></div>'
  root = createRoot(document.getElementById('app')!)
})
afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Lets the lazy import settle and React hear of it. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => void (await Promise.resolve()))
}

it('shows nothing while the game arrives, then the game', async () => {
  arrives()
  const { Cricket } = await import('./lazyCricket')
  const onExit = vi.fn()
  await act(async () => root.render(<Cricket {...props(onExit)} />))
  await settle()
  expect(document.querySelector('.cricket')).not.toBeNull()
  expect(document.querySelector('.cricket-failed')).toBeNull()
  act(() => document.querySelector<HTMLButtonElement>('.cricket button')!.click())
  expect(onExit).toHaveBeenCalledTimes(1)
})

it('a game that cannot load says so, closes its place by itself, and the city is not taken down', async () => {
  fails()
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {}) // React reports the caught error
  const { Cricket } = await import('./lazyCricket')
  const onExit = vi.fn()
  await act(async () =>
    root.render(
      <>
        <canvas className="stage" />
        <Cricket {...props(onExit)} />
      </>,
    ),
  )
  await settle()
  expect(document.querySelector('.cricket')).toBeNull()
  const said = document.querySelector('.cricket-failed')!
  expect(said.getAttribute('role')).toBe('alert')
  expect(said.textContent).toBe('Khel nahi khul paya. Page reload karke phir try karo.')
  expect(document.querySelector('canvas.stage')).not.toBeNull() // the street is still there
  expect(onExit).not.toHaveBeenCalled()
  act(() => void vi.advanceTimersByTime(4100))
  expect(onExit).toHaveBeenCalledTimes(1)
})
