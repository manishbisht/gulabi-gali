// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { holdsToSave, pictureName, shareImage } from './share'

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
const IG =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 360.0.0.30.109 (iPhone15,2; iOS 18_1; en_IN)'
const CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('knows Instagram by its user agent, and nothing else as Instagram', () => {
  expect(holdsToSave(IG)).toBe(true)
  expect(holdsToSave(CHROME)).toBe(false)
  // Facebook's (and Messenger's) own browser: the same press-and-hold screen, not a download that may not happen
  expect(holdsToSave('Mozilla/5.0 … FBAN/FBIOS')).toBe(true)
})

it('names each kind of picture by the moment', () => {
  const at = new Date(2026, 0, 14, 7, 3, 9)
  expect(pictureName('', at)).toBe('gulabi-gali-20260114-070309.png')
  expect(pictureName('postcard-', at)).toBe('gulabi-gali-postcard-20260114-070309.png')
  expect(pictureName('darshan-', at)).toBe('gulabi-gali-darshan-20260114-070309.png')
})

it('the share sheet first, wherever the browser can share files (Instagram too, if it ever can)', async () => {
  for (const ua of [CHROME, IG]) {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, canShare: () => true })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    expect(await shareImage(png(), 'a.png', ua)).toBe('shared')
    const file = (share.mock.calls[0]![0] as { files: File[] }).files[0]!
    expect([file.name, file.type]).toEqual(['a.png', 'image/png'])
    expect(click).not.toHaveBeenCalled()
  }
})

it("in Instagram's browser, which cannot share files or download, it asks for the press-and-hold screen", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  vi.stubGlobal('navigator', { share: vi.fn(), userAgent: IG })
  expect(await shareImage(png(), 'a.png')).toBe('hold') // the browser's own user agent, by default
  vi.stubGlobal('navigator', { share: vi.fn(), canShare: () => false })
  expect(await shareImage(png(), 'a.png', IG)).toBe('hold')
  vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error('no')), canShare: () => true })
  expect(await shareImage(png(), 'a.png', IG)).toBe('hold')
  expect(click).not.toHaveBeenCalled()
  expect(URL.createObjectURL).not.toHaveBeenCalled() // nothing made here that would need letting go
})

it('anywhere else that cannot share files, it downloads, and lets the URL go afterwards', async () => {
  vi.useFakeTimers()
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  vi.stubGlobal('navigator', { userAgent: CHROME })
  expect(await shareImage(png(), 'gulabi-gali-darshan-x.png')).toBe('downloaded')
  expect(click).toHaveBeenCalledOnce()
  expect(document.querySelector('a[download]')).toBeNull()
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  vi.advanceTimersByTime(10_000)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
})

it('a share sheet refused for a late tap is "retry" (a fresh tap can open it), never a download or hold', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  const late = Object.assign(new Error('needs a tap'), { name: 'NotAllowedError' })
  for (const ua of [CHROME, IG]) {
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(late), canShare: () => true })
    expect(await shareImage(png(), 'a.png', ua)).toBe('retry')
  }
  expect(click).not.toHaveBeenCalled()
})

it('refused again on the "Share" button\'s own fresh tap, it falls through: the hold screen, or a download', async () => {
  const late = Object.assign(new Error('needs a tap'), { name: 'NotAllowedError' })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(late), canShare: () => true })
  expect(await shareImage(png(), 'a.png', IG, true)).toBe('hold')
  expect(click).not.toHaveBeenCalled()
  expect(await shareImage(png(), 'a.png', CHROME, true)).toBe('downloaded')
  expect(click).toHaveBeenCalledOnce()
})

it('closing the share sheet is not a failure, and nothing else happens', async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  const abort = Object.assign(new Error('x'), { name: 'AbortError' })
  vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(abort), canShare: () => true })
  expect(await shareImage(png(), 'a.png', IG)).toBe('cancelled')
  expect(click).not.toHaveBeenCalled()
})
