import { collapse, doubled, elongated, normalise, readings, squeeze } from './normalise'

/**
 * What the filter looks up: a set of normalised words, plus marked forms (see `buildList`). The server builds
 * it from the raw list; the page checks the SHA-1 of each candidate against a hashed copy.
 */
export interface WordList {
  has(candidate: string): boolean
}

/** A run of this many single-character tokens or more (`b a d w o r d`) is also checked glued together. */
const MIN_SPELLED = 3
/**
 * Two neighbouring tokens are checked glued (`fu ck`) when the result is at least this long, behind `PAIR`:
 * only the strong-abuse words are listed that way, so a pair never makes an ordinary listed word (`pen is`).
 */
const MIN_PAIRED = 4
const PAIR = '+'
/**
 * Everyday phrases with a listed word in them, read as one token so the word is not met on its own: the Latin
 * honours (`magna cum laude`). Neither part is a slur, and only these exact neighbours are spared.
 */
const PHRASES: readonly (readonly [string, string])[] = [['cum', 'laude']]
/** A loose (collapsed) form is kept only for words at least this long once collapsed. */
const MIN_LOOSE = 4
/** Masked spellings (`f*ck`) are kept only for words at least this long. */
const MIN_MASKED = 4
const LATIN_RE = /^[a-z]+$/

/**
 * The raw words as a `Set`: each one normalised and glued into a single token, plus
 * - its `collapse`d form behind a `~` when that is 4+ letters, which an input with any doubled letter is
 *   compared with (`baadword`, `baaadword` are `badword`, while a plain `as` is never `ass`);
 * - for Latin words of 4+ letters, every way to hide one to three letters after the first behind a single `*`
 *   (`f*ck`, `f*k`), compared with an input that has a `*` inside a word;
 * - for the `strong` ones (the strong-abuse subset), the word behind a `+`, which two neighbouring tokens glued
 *   are compared with (`fu ck`). Any other listed word is only ever met whole.
 * `~`, `*` and `+` are never part of a plain token, so the kinds cannot meet. Nothing marked with `*` is ever
 * sent to a page.
 */
export function buildList(words: readonly string[], strong: readonly string[] = []): Set<string> {
  const set = new Set<string>()
  for (const word of words) {
    const w = normalise(word).join('')
    if (!w) continue
    set.add(w)
    const loose = collapse(w)
    if ([...loose].length >= MIN_LOOSE) set.add(`~${loose}`)
    if (LATIN_RE.test(w) && w.length >= MIN_MASKED)
      for (let at = 1; at < w.length - 1; at++)
        for (let run = 1; run <= 3 && at + run < w.length; run++)
          set.add(`${w.slice(0, at)}*${w.slice(at + run)}`)
  }
  for (const word of strong) {
    const w = normalise(word).join('')
    if (w) set.add(PAIR + w)
  }
  return set
}

/** The tokens with each known phrase (see `PHRASES`) made one token, which no listed word can be. */
function joinPhrases(tokens: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const next = tokens[i + 1]
    if (next !== undefined && PHRASES.some(([a, b]) => tokens[i] === a && next === b)) {
      out.push(`${tokens[i]} ${next}`)
      i++
    } else out.push(tokens[i]!)
  }
  return out
}

/**
 * Every string worth looking up for `s`, over each reading of it (see `readings`): each token, each run of
 * single-character letters glued (`b a d w o r d`) and each neighbouring pair glued (`fu ck`, behind `PAIR`),
 * and for a token with a repeated letter its `squeeze`d and `collapse`d forms. A known phrase is one token.
 */
export function candidates(s: string): string[] {
  const out = new Set<string>()
  const add = (token: string) => {
    out.add(token)
    if (elongated(token)) out.add(squeeze(token))
    if (doubled(token)) out.add(`~${collapse(token)}`)
  }
  /** A glued pair never meets the collapsed forms (`chod do` is not `chodo`). */
  const addPair = (glued: string) => {
    out.add(PAIR + glued)
    if (elongated(glued)) out.add(PAIR + squeeze(glued))
  }
  const isNumber = (token: string) => /^\p{N}+$/u.test(token)
  for (const tokens of readings(s).map(joinPhrases)) {
    let run = ''
    let runLength = 0
    const flush = () => {
      if (runLength >= MIN_SPELLED) add(run)
      run = ''
      runLength = 0
    }
    tokens.forEach((token, i) => {
      add(token)
      const next = tokens[i + 1]
      if (next && !isNumber(token) && !isNumber(next) && [...token].length + [...next].length >= MIN_PAIRED)
        addPair(token + next)
      if ([...token].length === 1 && !isNumber(token)) {
        run += token
        runLength++
      } else flush()
    })
    flush()
  }
  return [...out]
}

/**
 * Whether `s` passes: no token or spelled-out run is on `list`, and no joined pair of tokens is one of its strong
 * words. Whole tokens only.
 */
export function check(s: string, list: WordList): { ok: true } | { ok: false } {
  for (const c of candidates(s)) if (list.has(c)) return { ok: false }
  return { ok: true }
}

export { normalise }
