/** Leetspeak a person may swap for a letter. Applied before anything is split, so `b@d` is `bad`. */
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
}

const LEET_RE = /[013457@$]/g
/** Everything that is not part of a word: letters, combining marks (Devanagari vowel signs) and numbers stay. */
const SEPARATOR_RE = /[^\p{L}\p{M}\p{N}]+/u
/** Format characters (zero-width, soft hyphen) draw as nothing, so they join; control characters are breaks. */
const FORMAT_RE = /\p{Cf}/gu
const CONTROL_RE = /\p{Cc}/gu

/**
 * The tokens of `s` as the filter compares them: NFKC and lowercase, leetspeak mapped to letters, invisible
 * characters dropped, and the rest split on anything that is not a letter, mark or digit. Never answers an
 * empty token.
 */
export function normalise(s: string): string[] {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(FORMAT_RE, '')
    .replace(CONTROL_RE, ' ')
    .replace(LEET_RE, (c) => LEET[c])
    .split(SEPARATOR_RE)
    .filter(Boolean)
}

/** Each run of the same character cut to one: `baaad` is `bad`. */
export const collapse = (token: string): string => token.replace(/(.)\1+/gsu, '$1')

/** Each run of three or more cut to two: `assss` is `ass`, and a real double letter stays. */
export const squeeze = (token: string): string => token.replace(/(.)\1{2,}/gsu, '$1$1')

/** True for a token that stretches some character three times or more (`baaad`), which `collapse` undoes. */
export const elongated = (token: string): boolean => /(.)\1\1/su.test(token)
