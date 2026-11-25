/**
 * The layout maths of the shareable pictures (the postcard and the Darshan card), kept apart from any canvas so
 * it can be tested on its own. Every size here is in the picture's own pixels.
 */

/** An Instagram Story: 9:16, the size the postcard and the card are drawn at. */
export const CARD_W = 1080
export const CARD_H = 1920

/** The address printed on every picture (no account id, no name unless asked: see `DarshanCard`). */
export const SITE_ADDRESS = 'gulabi-gali.manishbisht.me'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The part of a `sw`×`sh` source that fills a `dw`×`dh` picture with nothing stretched and nothing left empty
 * (CSS `object-fit: cover`): the source's middle, cut to the picture's shape.
 */
export function coverCrop(sw: number, sh: number, dw: number, dh: number): Rect {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return { x: 0, y: 0, w: Math.max(sw, 0), h: Math.max(sh, 0) }
  const want = dw / dh
  if (sw / sh > want) {
    // wider than the picture: the sides go
    const w = sh * want
    return { x: (sw - w) / 2, y: 0, w, h: sh }
  }
  const h = sw / want
  return { x: 0, y: (sh - h) / 2, w: sw, h }
}

/** How wide `text` is at `size` px in the font the caller has in mind. */
export type Measure = (text: string, size: number) => number

const ELLIPSIS = '…'

/**
 * `text` cut short with an ellipsis so it fits `maxWidth` at `size` (whole as it is when it already fits). Cuts
 * by code point, so an emoji or a Devanagari letter is never split in half; trailing spaces go before the "…".
 */
export function ellipsize(measure: Measure, text: string, size: number, maxWidth: number): string {
  if (measure(text, size) <= maxWidth) return text
  const points = Array.from(text)
  let lo = 0
  let hi = points.length
  // the longest prefix that fits with the ellipsis after it
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const tried = points.slice(0, mid).join('').trimEnd() + ELLIPSIS
    if (measure(tried, size) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo === 0 ? '' : points.slice(0, lo).join('').trimEnd() + ELLIPSIS
}

export interface BandLine {
  /** The words before the place, the place (it is the part that gives way) and the words after it. */
  parts: [lead: string, place: string, tail: string]
  size: number
}

/** The separator between a band's parts: a middle dot with a space either side. */
export const SEP = ' · '

/** The band's line as one string. */
export const bandText = (line: BandLine): string => line.parts.filter((p) => p !== '').join(SEP)

/**
 * The postcard band's line "Gulabi Gali · <place> · Jaipur", fitted to `maxWidth`: the biggest size from `max`
 * down to `min` (in steps of 2) at which it fits whole; at `min`, the place is cut short with an ellipsis; a
 * place with no room at all is left out, so the band always reads "Gulabi Gali · Jaipur" at the very least.
 */
export function fitBand(
  measure: Measure,
  [lead, place, tail]: [string, string, string],
  maxWidth: number,
  max: number,
  min: number,
): BandLine {
  const whole = (p: string) => [lead, p, tail].filter((s) => s !== '').join(SEP)
  for (let size = max; size >= min; size -= 2) {
    if (measure(whole(place), size) <= maxWidth) return { parts: [lead, place, tail], size }
  }
  // the room the place has at the smallest size: the line less the place, less its separator
  const room = maxWidth - measure(whole(''), min) - measure(SEP, min)
  const cut = room > 0 ? ellipsize(measure, place, min, room) : ''
  return { parts: [lead, cut, tail], size: min }
}

/**
 * Where `n` stamps sit on the Darshan card: `cols` to a row, in order, in `area`; the last row is centred when it
 * is not full. Each cell is as tall as the area allows, up to `maxRowH`, so a longer list (a new landmark)
 * only makes the rows a little shorter. The block of rows is centred in the area.
 */
export function stampGrid(n: number, area: Rect, cols = 3, maxRowH = 220): Rect[] {
  if (n <= 0) return []
  const rows = Math.ceil(n / cols)
  const w = area.w / cols
  const h = Math.min(maxRowH, area.h / rows)
  const top = area.y + (area.h - h * rows) / 2
  const cells: Rect[] = []
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols)
    const inRow = row === rows - 1 ? n - row * cols : cols
    const left = area.x + (area.w - inRow * w) / 2
    cells.push({ x: left + (i % cols) * w, y: top + row * h, w, h })
  }
  return cells
}

/**
 * `text` on at most two lines of `maxWidth`: whole on one when it fits, else broken at the last space that
 * lets the first line fit, the rest on the second line (cut short with "…" if it is still too long). A
 * single word too long for a line is cut short on one line.
 */
export function wrapTwo(measure: Measure, text: string, size: number, maxWidth: number): string[] {
  if (measure(text, size) <= maxWidth) return [text]
  const words = text.split(' ')
  for (let i = words.length - 1; i > 0; i--) {
    const first = words.slice(0, i).join(' ')
    if (measure(first, size) <= maxWidth)
      return [first, ellipsize(measure, words.slice(i).join(' '), size, maxWidth)]
  }
  return [ellipsize(measure, text, size, maxWidth)]
}

/**
 * What the Darshan card may print of the visitor: nothing unless they asked (`show`) and they are a resident
 * with a name; then the first word of it, or, for a name with no space, its first 12 characters (as the
 * server cuts a name for strangers).
 */
export function cardName(name: string | null | undefined, show: boolean): string | null {
  if (!show || !name) return null
  const clean = name.trim()
  if (!clean) return null
  const space = clean.search(/\s/)
  return space > 0 ? clean.slice(0, space) : Array.from(clean).slice(0, 12).join('')
}

/**
 * A stamp's initials for its round seal: the first letter of its first two capitalised words ("Hawa Mahal" is
 * "HM", "Amer ka Qila" is "AQ"; a name with no capitals uses its first two words).
 */
export function initials(name: string): string {
  const words = name.split(/[\s\-–&]+/).filter((w) => w !== '')
  const caps = words.filter((w) => /^\p{Lu}/u.test(w))
  return (caps.length ? caps : words)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]!.toUpperCase())
    .join('')
}
