// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const photo = vi.hoisted(() => ({ capture: vi.fn(), share: vi.fn() }))
vi.mock('./photo', () => ({
  WORDMARK: 'Gulabi Gali · Jaipur',
  capturePhoto: photo.capture,
  sharePhoto: photo.share,
}))
import { onDeed } from '../world/deeds'
import { PhotoMode } from './PhotoMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
beforeEach(() => {
  photo.capture.mockReset()
  photo.share.mockReset()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root.render(<PhotoMode stage={{ capture: vi.fn() }} lang="en" onExit={() => {}} />))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
const q = (s: string) => host.querySelector<HTMLElement>(s)!

it('a failed capture (a lost context) says so and shares and saves nothing', async () => {
  photo.capture.mockRejectedValue(new Error('capture: the WebGL context is lost'))
  const deeds = vi.fn()
  const off = onDeed(deeds)
  await act(async () => q('.photo-shutter').click())
  off()
  expect(deeds).not.toHaveBeenCalled() // no photo, so no "Aaj ka Darshan" photo either
  expect(q('.photo-note').textContent).toBe("Couldn't take the photo. Try again.")
  expect(photo.share).not.toHaveBeenCalled()
  expect((q('.photo-shutter') as HTMLButtonElement).disabled).toBe(false) // and it can be tried again
})

it('the status line is in the page from the start, empty, and only its text changes', async () => {
  const note = q('.photo-note')
  expect(note.getAttribute('role')).toBe('status')
  expect(note.textContent).toBe('')
  photo.capture.mockResolvedValue(new Blob())
  photo.share.mockResolvedValue('downloaded')
  const deeds = vi.fn()
  const off = onDeed(deeds)
  await act(async () => q('.photo-shutter').click())
  off()
  expect(deeds.mock.calls).toEqual([[{ kind: 'photo' }]]) // a photo taken does today's photo goal
  expect(q('.photo-note')).toBe(note)
  expect(note.textContent).toBe('Photo saved to your phone.')
})
