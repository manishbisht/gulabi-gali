/** Leetspeak a person may swap for a letter. Applied to a token that has a letter, `@` or `$` in it. */
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

/** Letters of other scripts that look like a Latin letter. Applied after lowercasing. */
const CONFUSABLES: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  х: 'x',
  і: 'i',
  ѕ: 's',
  у: 'y',
  ɑ: 'a',
  ο: 'o',
  ν: 'v',
  κ: 'k',
}
const CONFUSABLES_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'g')

/** Format characters (zero-width, soft hyphen) draw as nothing, so they join; control characters are breaks. */
const FORMAT_RE = /\p{Cf}/gu
const CONTROL_RE = /\p{Cc}/gu
/** Letters that draw as blanks (Hangul fillers) and variation selectors: invisible, so they join. */
const BLANK_RE = new RegExp(
  [0x115f, 0x1160, 0x3164, 0xffa0, ...Array.from({ length: 16 }, (_, i) => 0xfe00 + i)]
    .map((c) => String.fromCharCode(c))
    .join('|'),
  'g',
)
const PRIVATE_RE = //g
const isAscii = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false
  return true
}
const HAS_MARK_RE = /\p{M}/u
const MARK_RE = /\p{Mn}/u
const LATINISH_RE = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u

/**
 * Accents and stacked marks on a Latin, Greek or Cyrillic letter go (`b̶ád`). Devanagari vowel signs, the virama
 * and the nukta are marks too, and stay: they change the word.
 */
function stripLatinMarks(s: string): string {
  // NFKC has already joined `a` and an acute into one letter, so only plain ASCII can skip the decomposing.
  if (isAscii(s)) return s
  let out = ''
  let latinish = false
  for (const ch of s.normalize('NFD')) {
    if (HAS_MARK_RE.test(ch)) {
      if (!(latinish && MARK_RE.test(ch))) out += ch
    } else {
      latinish = LATINISH_RE.test(ch)
      out += ch
    }
  }
  return out.normalize('NFC')
}

/** NFKC and lowercase, nothing invisible, no stacked accents, look-alike letters made Latin. Punctuation stays. */
function fold(s: string): string {
  return stripLatinMarks(
    s.normalize('NFKC').toLowerCase().replace(FORMAT_RE, '').replace(BLANK_RE, '').replace(PRIVATE_RE, ' '),
  )
    .replace(CONFUSABLES_RE, (c) => CONFUSABLES[c])
    .replace(CONTROL_RE, ' ')
}

/** What breaks a word: anything but letters, combining marks, numbers, and `@` and `$` (leet letters). */
const SEPARATOR_RE = /[^\p{L}\p{M}\p{N}@$]+/u
/** The same, but the private-use mark that stands for a masking `*` stays inside a token. */
const MASKED_SEPARATOR_RE = /[^\p{L}\p{M}\p{N}@$]+/u
const NUMERIC_RE = /^\p{N}+$/u

/** Leet is for words: a token of digits only (`455`, `717`) is a number, not `ass` or `tit`. */
const unleet = (token: string): string =>
  NUMERIC_RE.test(token) ? token : token.replace(LEET_RE, (c) => LEET[c])

const tokenise = (folded: string, separator = SEPARATOR_RE): string[] =>
  folded.split(separator).filter(Boolean).map(unleet)

/**
 * The tokens of `s` as the filter compares them: folded (see `fold`), split on anything that is not a letter,
 * mark or digit, leetspeak mapped to letters in any token that has one. Never answers an empty token.
 */
export function normalise(s: string): string[] {
  return tokenise(fold(s))
}

/** Punctuation people put inside a word to dress it up (`f*ck`, `fu-ck`, `sh!t`, `ch.utiya`). */
const JOINERS = `*!.\\-_'’~|`
const WORDISH = '\\p{L}\\p{M}\\p{N}@$'
const INSIDE_RE = new RegExp(`(?<=[${WORDISH}])[${JOINERS}]+(?=[${WORDISH}])`, 'gu')
const HAS_INSIDE_RE = new RegExp(INSIDE_RE.source, 'u')

/**
 * Every reading of `s`, each a token list: the plain one, then (only when a joiner sits between two word
 * characters) one with the joiners dropped, one where `!` and `|` read as `i`, and one where a run of `*`
 * is a single `*` inside its token, for the masked spellings the list keeps (see `buildList`).
 */
export function readings(s: string): string[][] {
  const folded = fold(s)
  const plain = tokenise(folded)
  if (!HAS_INSIDE_RE.test(folded)) return [plain]
  const dropped = tokenise(folded.replace(INSIDE_RE, ''))
  const bangs = tokenise(folded.replace(INSIDE_RE, (run) => (/[!|]/.test(run) ? 'i' : '')))
  const masked = tokenise(
    folded.replace(INSIDE_RE, (run) => (run.includes('*') ? '' : '')),
    MASKED_SEPARATOR_RE,
  )
    .map((t) => t.replace(PRIVATE_RE, '*'))
    .filter((t) => t.includes('*'))
  return [plain, dropped, bangs, masked]
}

/** Each run of the same character cut to one: `baaad` is `bad`. */
export const collapse = (token: string): string => token.replace(/(.)\1+/gsu, '$1')

/** Each run of three or more cut to two: `assss` is `ass`, and a real double letter stays. */
export const squeeze = (token: string): string => token.replace(/(.)\1{2,}/gsu, '$1$1')

/** True for a token that stretches some character three times or more (`baaad`), which `squeeze` undoes. */
export const elongated = (token: string): boolean => /(.)\1\1/su.test(token)

/** True for a token with any doubled character (`baadword`): `collapse` may bring it back to a word. */
export const doubled = (token: string): boolean => /(.)\1/su.test(token)
