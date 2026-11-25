import { describe, expect, it } from 'vitest'
import {
  bandText,
  CARD_H,
  CARD_W,
  cardName,
  coverCrop,
  ellipsize,
  fitBand,
  initials,
  stampGrid,
  wrapTwo,
  type Measure,
} from './cardLayout'

/** Every character (code point) half the size wide: a font where widths are easy to count. */
const mono: Measure = (text, size) => Array.from(text).length * size * 0.5

describe('coverCrop', () => {
  it('a phone held upright (narrower than 9:16) keeps its whole width and loses a strip top and bottom', () => {
    // 360×740 at 3x
    const c = coverCrop(1080, 2220, CARD_W, CARD_H)
    expect(c.w).toBe(1080)
    expect(c.h).toBeCloseTo(1920)
    expect(c.x).toBe(0)
    expect(c.y).toBeCloseTo(150)
  })

  it('a wide screen keeps its whole height and loses the sides, from the middle', () => {
    const c = coverCrop(1280, 720, CARD_W, CARD_H)
    expect(c.h).toBe(720)
    expect(c.w).toBeCloseTo(405)
    expect(c.x).toBeCloseTo((1280 - 405) / 2)
    expect(c.y).toBe(0)
  })

  it('a screen already 9:16 is kept whole, and a crop always has the picture shape', () => {
    expect(coverCrop(540, 960, CARD_W, CARD_H)).toEqual({ x: 0, y: 0, w: 540, h: 960 })
    for (const [w, h] of [
      [390, 844],
      [1920, 1080],
      [768, 1024],
      [100, 101],
    ] as const) {
      const c = coverCrop(w, h, CARD_W, CARD_H)
      expect(c.w / c.h).toBeCloseTo(9 / 16)
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.x + c.w).toBeLessThanOrEqual(w + 1e-9)
      expect(c.y + c.h).toBeLessThanOrEqual(h + 1e-9)
    }
  })

  it('an empty source crops to nothing rather than to NaN', () => {
    expect(coverCrop(0, 0, CARD_W, CARD_H)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('ellipsize', () => {
  it('leaves what fits alone, and cuts the rest with an ellipsis that fits', () => {
    expect(ellipsize(mono, 'Hawa Mahal', 10, 100)).toBe('Hawa Mahal')
    const cut = ellipsize(mono, 'Jawahar Kala Kendra', 10, 45)
    expect(cut.endsWith('…')).toBe(true)
    expect(mono(cut, 10)).toBeLessThanOrEqual(45)
    expect(cut).toBe('Jawahar…') // trailing space dropped before the ellipsis
  })

  it('never splits a character in half', () => {
    const cut = ellipsize(mono, '🏰🏰🏰🏰🏰', 10, 24)
    expect(cut).toBe('🏰🏰🏰…')
  })

  it('gives nothing when not even "…" fits', () => {
    expect(ellipsize(mono, 'Amer', 10, 4)).toBe('')
  })
})

describe('fitBand', () => {
  it('a short place fits at the biggest size', () => {
    const line = fitBand(mono, ['Gulabi Gali', 'Amer', 'Jaipur'], 864, 64, 40)
    expect(line.size).toBe(64)
    expect(bandText(line)).toBe('Gulabi Gali · Amer · Jaipur')
  })

  it('a longer place makes the line smaller, never past the smallest size', () => {
    const line = fitBand(mono, ['Gulabi Gali', 'Jawahar Kala Kendra', 'Jaipur'], 864, 64, 40)
    expect(line.size).toBeLessThan(64)
    expect(line.size).toBeGreaterThanOrEqual(40)
    expect(line.parts[1]).toBe('Jawahar Kala Kendra')
    expect(mono(bandText(line), line.size)).toBeLessThanOrEqual(864)
  })

  it('a very long place is cut short at the smallest size; Gulabi Gali and Jaipur always stay whole', () => {
    const place = 'University of Rajasthan ka bahut lamba naam jo kabhi khatam nahi hota'
    const line = fitBand(mono, ['Gulabi Gali', place, 'Jaipur'], 864, 64, 40)
    expect(line.size).toBe(40)
    expect(line.parts[0]).toBe('Gulabi Gali')
    expect(line.parts[2]).toBe('Jaipur')
    expect(line.parts[1].endsWith('…')).toBe(true)
    expect(place.startsWith(line.parts[1].slice(0, -1))).toBe(true)
    expect(mono(bandText(line), 40)).toBeLessThanOrEqual(864)
  })

  it('with no room for any of the place, the band still says Gulabi Gali · Jaipur', () => {
    const line = fitBand(mono, ['Gulabi Gali', 'Hawa Mahal', 'Jaipur'], 420, 64, 40)
    expect(bandText(line)).toBe('Gulabi Gali · Jaipur')
  })
})

describe('stampGrid', () => {
  const area = { x: 90, y: 790, w: 900, h: 730 }
  it.each([13, 14, 20])('puts %i stamps in order, inside the area, none overlapping', (n) => {
    const cells = stampGrid(n, area, 2, 130)
    expect(cells).toHaveLength(n)
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(area.x - 1e-9)
      expect(c.y).toBeGreaterThanOrEqual(area.y - 1e-9)
      expect(c.x + c.w).toBeLessThanOrEqual(area.x + area.w + 1e-9)
      expect(c.y + c.h).toBeLessThanOrEqual(area.y + area.h + 1e-9)
    }
    // reading order: row by row, left to right
    for (let i = 1; i < n; i++) {
      const [a, b] = [cells[i - 1]!, cells[i]!]
      expect(b.y > a.y || (b.y === a.y && b.x > a.x)).toBe(true)
    }
  })

  it('a short last row is centred, and rows are never taller than asked', () => {
    const cells = stampGrid(13, area, 2, 130)
    const last = cells[12]!
    expect(last.x + last.w / 2).toBeCloseTo(area.x + area.w / 2)
    expect(cells[0]!.h).toBeLessThanOrEqual(130)
    expect(stampGrid(2, area, 2, 130)[0]!.h).toBe(130)
  })

  it('no stamps, no cells', () => expect(stampGrid(0, area)).toEqual([]))
})

describe('cardName: no name unless asked', () => {
  it('prints no name by default, even for a resident with one', () => {
    expect(cardName('Aarav Sharma', false)).toBeNull()
  })
  it('prints nothing for someone with no name (a guest), even if asked', () => {
    expect(cardName(undefined, true)).toBeNull()
    expect(cardName('   ', true)).toBeNull()
  })
  it('prints the first name only, when asked', () => {
    expect(cardName('Aarav Sharma', true)).toBe('Aarav')
    expect(cardName('  Meera  ', true)).toBe('Meera')
    expect(cardName('Abcdefghijklmnopq', true)).toBe('Abcdefghijkl') // 12 characters, as the server cuts it
  })
})

it('initials take the capitalised words', () => {
  expect(initials('Hawa Mahal')).toBe('HM')
  expect(initials('Amer ka Qila')).toBe('AQ')
  expect(initials('University of Rajasthan')).toBe('UR')
  expect(initials('jkk')).toBe('J')
})

it('wrapTwo breaks at a space onto at most two lines, the second cut short if needed', () => {
  expect(wrapTwo(mono, 'Jal Mahal', 10, 200)).toEqual(['Jal Mahal'])
  expect(wrapTwo(mono, 'Jawahar Kala Kendra', 10, 60)).toEqual(['Jawahar Kala', 'Kendra'])
  expect(wrapTwo(mono, 'Jawahar Kala Kendra', 10, 40)).toEqual(['Jawahar', 'Kala Ke…'])
  expect(wrapTwo(mono, 'Supercalifragilistic', 10, 50)).toEqual(['Supercali…'])
})
