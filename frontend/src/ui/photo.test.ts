// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { capturePhoto, photoName, sharePhoto } from './photo'

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

beforeEach(() => {
  URL.createObjectURL = () => 'blob:x'
  URL.revokeObjectURL = () => undefined
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('names the file by the moment, so two photos never overwrite each other', () => {
  expect(photoName(new Date(2026, 10, 15, 9, 5, 7))).toBe('gulabi-gali-20261115-090507.png')
})

it('capture draws the frame, adds the wordmark and encodes a PNG', async () => {
  const calls: string[] = []
  const ctx = {
    drawImage: () => calls.push('draw'),
    fillText: (text: string) => calls.push(`text:${text}`),
    measureText: () => ({ width: 10 }),
    save() {},
    restore() {},
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0,
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  const types: (string | undefined)[] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb, type) {
    types.push(type)
    cb(png())
  })
  const source = document.createElement('canvas')
  source.width = 600
  source.height = 800
  const stage = { capture: vi.fn(<T>(read: (c: HTMLCanvasElement) => T) => read(source)) }
  const blob = await capturePhoto(stage as never)
  expect(stage.capture).toHaveBeenCalledOnce()
  expect(blob.type).toBe('image/png')
  expect(types).toEqual(['image/png'])
  expect(calls[0]).toBe('draw')
  expect(calls).toContain('text:Gulabi Gali · Jaipur')
  const made = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.contexts[0] as HTMLCanvasElement
  expect([made.width, made.height]).toEqual([0, 0]) // emptied once encoded: its pixels let go
})

it('capture fails cleanly when the canvas cannot encode', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const stage = { capture: <T>(read: (c: HTMLCanvasElement) => T) => read(document.createElement('canvas')) }
  await expect(capturePhoto(stage)).rejects.toThrow()
})

it('shares the file through the share sheet when the browser can share files', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  const canShare = vi.fn().mockReturnValue(true)
  vi.stubGlobal('navigator', { share, canShare })
  expect(await sharePhoto(png())).toBe('shared')
  const arg = share.mock.calls[0]![0] as { files: File[] }
  expect(arg.files).toHaveLength(1)
  expect(arg.files[0]!.type).toBe('image/png')
  expect(arg.files[0]!.name).toMatch(/^gulabi-gali-\d{8}-\d{6}\.png$/)
  expect(canShare).toHaveBeenCalledWith({ files: arg.files })
})

it('downloads it when there is no canShare (many in-app browsers)', async () => {
  const share = vi.fn()
  vi.stubGlobal('navigator', { share })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  expect(await sharePhoto(png())).toBe('downloaded')
  expect(click).toHaveBeenCalledOnce()
  expect(share).not.toHaveBeenCalled()
  expect(document.querySelector('a[download]')).toBeNull() // the link does not stay in the page
})

it('downloads it when canShare says no to files, or sharing itself fails', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  vi.stubGlobal('navigator', { share: vi.fn(), canShare: () => false })
  expect(await sharePhoto(png())).toBe('downloaded')
  vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error('nope')), canShare: () => true })
  expect(await sharePhoto(png())).toBe('downloaded')
  expect(click).toHaveBeenCalledTimes(2)
})

it('closing the share sheet is not a failure and downloads nothing', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  const abort = Object.assign(new Error('x'), { name: 'AbortError' })
  vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(abort), canShare: () => true })
  expect(await sharePhoto(png())).toBe('cancelled')
  expect(click).not.toHaveBeenCalled()
})
