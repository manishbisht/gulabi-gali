// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { PosterView } from '../net/protocol'
import { usePosters, type PosterActions } from './usePosters'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const poster: PosterView = { id: 'p1', wall: 0, slot: 1, text: 'Chai at the tapri', when: null, name: 'Ravi' }

function mount() {
  const out = {} as ReturnType<typeof usePosters>
  function Probe() {
    Object.assign(out, usePosters())
    return null
  }
  act(() => createRoot(document.createElement('div')).render(<Probe />))
  const actions: PosterActions = { pinned: vi.fn(), unpinned: vi.fn(), refreshPosters: vi.fn() }
  act(() => out.bind(actions))
  return { out, actions }
}

it('a changed count goes to the wall and the open card', () => {
  const { out, actions } = mount()
  act(() => out.hooks.tap(poster))
  act(() => out.changed({ ...poster, going: 2, coming: true }))
  expect(actions.pinned).toHaveBeenCalledWith({ ...poster, going: 2, coming: true })
  expect(out.open?.poster).toEqual({ ...poster, going: 2, coming: true })
})

it('a poster that came off the wall meanwhile is never put back by its count', () => {
  const { out, actions } = mount()
  act(() => out.hooks.tap(poster))
  act(() => out.hooks.gone(['p1']))
  act(() => out.changed({ ...poster, going: 2, coming: true }))
  expect(actions.pinned).not.toHaveBeenCalled()
})
