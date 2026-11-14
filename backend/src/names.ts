/** The longest display name, in code points (never splitting a character someone sees as one). */
export const MAX_NAME_POINTS = 24
/** The shortest, in code points: a single letter is not a name. */
export const MIN_NAME_POINTS = 2

/**
 * Characters a name may not carry: controls, formatting characters (bidi
 * overrides and isolates, zero-width spaces, soft hyphens, tag characters) and
 * the other default-ignorables, which draw as nothing — plus the braille blank,
 * which draws as a space without being one. Kept: the two joiners that emoji
 * sequences and Persian or Indic names are built with, and the variation
 * selectors that choose an emoji's presentation.
 */
const INVISIBLE = /(?![‌‍︀-️])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu
const JOINERS = /[‌‍]/
const graphemes =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** Whole characters as a reader sees them, up to `max` code points between them. */
function capLength(name: string, max = MAX_NAME_POINTS): string {
  const parts = graphemes ? Array.from(graphemes.segment(name), (part) => part.segment) : [...name]
  let out = '',
    points = 0
  for (const part of parts) {
    const size = [...part].length
    if (points + size > max) break
    out += part
    points += size
  }
  return out
}

/**
 * A display name as every other person at the table will see it, or null when
 * nothing printable is left. Names are free text from strangers that reach the
 * map, other people's screens and profiles, so
 * this is the one gate all of them pass: NFC, one space between words, nothing
 * invisible or direction-changing, no tower of stacked accents, and at most
 * `MAX_NAME_POINTS` code points without cutting a character in half.
 */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = capLength(
    value
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .replace(INVISIBLE, '')
      // Three marks covers every script's real clusters; a hundred is Zalgo.
      .replace(/(\p{M}{3})\p{M}+/gu, '$1')
      // A joiner only means something between two characters.
      .replace(/[‌‍]{2,}/g, (run) => run[0])
      .replace(/(^|\s)[‌‍]+|[‌‍]+(?=\s|$)/g, '$1')
      .trim(),
  )
    .replace(/[‌‍]+$/, '')
    .trim()
  if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(name.replace(JOINERS, ''))) return null
  return [...name].length >= MIN_NAME_POINTS ? name : null
}

/** How long a first name may run when a name has no space to end it at. */
export const MAX_FIRST_NAME_POINTS = 12

/**
 * What a stranger sees of a cleaned name: its first word, or, for a name with no space, its first
 * `MAX_FIRST_NAME_POINTS` code points without cutting a character in half.
 */
export function firstName(name: string): string {
  const space = name.indexOf(' ')
  return space > 0
    ? name.slice(0, space)
    : capLength(name, MAX_FIRST_NAME_POINTS).replace(/[\u200c\u200d]+$/, '')
}
