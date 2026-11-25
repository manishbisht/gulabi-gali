// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { STAMPS, TOTAL_STAMPS } from '../world/stamps'
import { CARD_H, CARD_W, SITE_ADDRESS } from './cardLayout'
import { composeDarshanCard, composePostcard } from './cards'

/** A 2D context that draws nothing and remembers the text it was asked to write and the images it drew. */
function fakeContext() {
  const texts: string[] = []
  const images: unknown[][] = []
  const ctx: Record<string, unknown> = {
    font: '10px x',
    fillText: (s: string) => texts.push(s),
    drawImage: (...args: unknown[]) => images.push(args),
    measureText: (s: string) => ({ width: Array.from(s).length * 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }
  const target = new Proxy(ctx, {
    get: (o, key: string) => (key in o ? o[key] : () => undefined),
    set: (o, key: string, v) => ((o[key] = v), true),
  })
  return { ctx: target, texts, images }
}

let drawn: ReturnType<typeof fakeContext>
let sizes: [number, number][]
let canvases: HTMLCanvasElement[]
beforeEach(() => {
  drawn = fakeContext()
  sizes = []
  canvases = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    sizes.push([this.width, this.height])
    canvases.push(this)
    return drawn.ctx as never
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb, type) =>
    cb(new Blob(['x'], { type: type ?? '' })),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('the postcard is a 1080×1920 PNG: the frame cut to 9:16 from its middle, the band and the address', async () => {
  vi.stubGlobal('innerWidth', 1280)
  vi.stubGlobal('innerHeight', 720)
  const source = document.createElement('canvas')
  source.width = 2560
  source.height = 1440
  const ratios: (number | undefined)[] = []
  const capture = <T>(read: (c: HTMLCanvasElement) => T, minRatio?: number) => {
    ratios.push(minRatio)
    return read(source)
  }
  const blob = await composePostcard({ capture }, 'Hawa Mahal')
  expect(blob.type).toBe('image/png')
  expect(sizes[0]).toEqual([CARD_W, CARD_H])
  expect([canvases[0]!.width, canvases[0]!.height]).toEqual([0, 0]) // emptied once encoded: its pixels let go
  // a 1280×720 window's 9:16 middle is 405 px wide: drawn at a ratio that makes it 1080
  expect(ratios).toHaveLength(1)
  expect(ratios[0]).toBeCloseTo(1080 / 405)
  const [img, sx, sy, sw, sh, dx, dy, dw, dh] = drawn.images[0]!
  expect(img).toBe(source)
  expect([sy, sh, dx, dy, dw, dh]).toEqual([0, 1440, 0, 0, CARD_W, CARD_H])
  expect(sw as number).toBeCloseTo(810)
  expect(sx as number).toBeCloseTo((2560 - 810) / 2)
  expect(drawn.texts.join('')).toBe(`Gulabi Gali · Hawa Mahal · Jaipur${SITE_ADDRESS}`)
})

it('a postcard of a place with a very long name still says Gulabi Gali and Jaipur', async () => {
  const capture = <T>(read: (c: HTMLCanvasElement) => T) => read(document.createElement('canvas'))
  await composePostcard({ capture }, 'Ek bahut hi lamba jagah ka naam jo band mein kabhi poora nahi aata')
  const line = drawn.texts.slice(0, -1).join('')
  expect(line.startsWith('Gulabi Gali · ')).toBe(true)
  expect(line.endsWith(' · Jaipur')).toBe(true)
  expect(line).toContain('…')
})

it('a failed capture makes no postcard', async () => {
  const capture = () => {
    throw new Error('capture: the WebGL context is lost')
  }
  await expect(composePostcard({ capture }, 'Amer')).rejects.toThrow(/lost/)
})

it('the Darshan card: title, the count out of every stamp, names of the collected only, and no name by default', async () => {
  const blob = await composeDarshanCard({ ids: ['hawa-mahal', 'jkk'], lang: 'hi', name: null, streak: 0 })
  expect(blob.type).toBe('image/png')
  expect(sizes[0]).toEqual([CARD_W, CARD_H])
  expect([canvases[0]!.width, canvases[0]!.height]).toEqual([0, 0])
  const all = drawn.texts.join('\n')
  expect(drawn.texts).toContain('Mera Jaipur Darshan')
  expect(drawn.texts).toContain(`2/${TOTAL_STAMPS}`)
  expect(all).toContain('Hawa Mahal')
  expect(all).toContain('Jawahar')
  expect(all).not.toContain('Albert Hall') // not collected: a "?" and "still to find", never its name
  expect(drawn.texts.filter((s) => s === '?')).toHaveLength(TOTAL_STAMPS - 2)
  expect(drawn.texts).toContain(SITE_ADDRESS)
  expect(all).not.toMatch(/Lagataar/) // no long run, no streak line
})

it('the Darshan card prints the name only when it is given, and a long run of days', async () => {
  await composeDarshanCard({ ids: [], lang: 'en', name: 'Aarav', streak: 5 })
  expect(drawn.texts).toContain('Aarav')
  expect(drawn.texts).toContain('My Jaipur Darshan')
  expect(drawn.texts).toContain(`0/${TOTAL_STAMPS}`)
  expect(drawn.texts).toContain('5-day Darshan run')
})

it('every stamp there is goes on the card, however many there are', async () => {
  await composeDarshanCard({ ids: STAMPS.map((s) => s.id), lang: 'en', name: null, streak: 0 })
  expect(drawn.texts).toContain(`${TOTAL_STAMPS}/${TOTAL_STAMPS}`)
  expect(drawn.texts.filter((s) => s === '?')).toHaveLength(0)
  expect(drawn.texts).toContain('Jaipur Darshan complete')
})
