// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const photo = vi.hoisted(() => ({ capture: vi.fn(), share: vi.fn(), postcard: vi.fn(), shareImage: vi.fn() }))
vi.mock('./photo', () => ({
  WORDMARK: 'Gulabi Gali · Jaipur',
  capturePhoto: photo.capture,
  sharePhoto: photo.share,
}))
vi.mock('./cards', () => ({ composePostcard: photo.postcard }))
vi.mock('./share', async (real) => ({
  ...(await real<typeof import('./share')>()),
  shareImage: photo.shareImage,
}))
import { onDeed } from '../world/deeds'
import { PhotoMode } from './PhotoMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
const stage = { capture: vi.fn() }
const exit = vi.fn()
beforeEach(() => {
  photo.capture.mockReset()
  photo.share.mockReset()
  photo.postcard.mockReset()
  photo.shareImage.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:card')
  URL.revokeObjectURL = vi.fn()
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() => root.render(<PhotoMode stage={stage} place="Hawa Mahal" lang="en" onExit={exit} />))
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

it('"Postcard" frames the shot 9:16 with the place, and makes the postcard from the same stage', async () => {
  const postcard = host.querySelector<HTMLInputElement>('input[value="postcard"]')!
  expect(host.querySelector<HTMLInputElement>('input[value="photo"]')!.checked).toBe(true) // a plain photo first
  expect(host.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Choose a frame')
  act(() => postcard.click())
  expect(q('.photo-frame').classList.contains('photo-frame-postcard')).toBe(true)
  expect(q('.photo-wordmark').textContent).toBe('Gulabi Gali · Hawa Mahal · Jaipur')
  photo.postcard.mockResolvedValue(new Blob(['p'], { type: 'image/png' }))
  photo.shareImage.mockResolvedValue('downloaded')
  const deeds = vi.fn()
  const off = onDeed(deeds)
  await act(async () => q('.photo-shutter').click())
  off()
  expect(photo.postcard).toHaveBeenCalledWith(stage, 'Hawa Mahal')
  expect(photo.capture).not.toHaveBeenCalled()
  expect(photo.shareImage.mock.calls[0]![1]).toMatch(/^gulabi-gali-postcard-\d{8}-\d{6}\.png$/)
  expect(deeds.mock.calls).toEqual([[{ kind: 'photo' }]]) // a postcard is a photo too
  expect(q('.photo-note').textContent).toBe('Postcard saved to your phone.')
})

it("in Instagram's browser the picture opens alone to press and save; Escape closes that, not photo mode", async () => {
  const card = new Blob(['p'], { type: 'image/png' })
  photo.capture.mockResolvedValue(card)
  photo.share.mockResolvedValue('hold')
  await act(async () => q('.photo-shutter').click())
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog.getAttribute('aria-label')).toBe('Save the picture')
  expect(dialog.textContent).toContain('Press and hold the image to save it')
  expect(dialog.querySelector('img')!.getAttribute('src')).toBe('blob:card')
  expect(URL.createObjectURL).toHaveBeenCalledWith(card)
  expect(q('.photo-note').textContent).toBe('')
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:card') // let go as it closes
  expect(exit).not.toHaveBeenCalled()
})
