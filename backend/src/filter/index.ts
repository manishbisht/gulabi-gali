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
/** Two neighbouring tokens are checked glued (`fu ck`) when the result is at least this long. */
const MIN_PAIRED = 4
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
 *   (`f*ck`, `f*k`), compared with an input that has a `*` inside a word.
 * `~` and `*` are never part of a plain token, so the kinds cannot meet. Nothing marked is ever sent to a page.
 */
export function buildList(words: readonly string[]): Set<string> {
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
  return set
}

/**
 * Every string worth looking up for `s`, over each reading of it (see `readings`): each token, each run of
 * single-character letters glued (`b a d w o r d`) and each neighbouring pair glued (`fu ck`), and for a token
 * with a repeated letter its `squeeze`d and `collapse`d forms.
 */
export function candidates(s: string): string[] {
  const out = new Set<string>()
  /** `loose`: a token on its own may meet the collapsed forms; a glued pair may not (`chod do` is not `chodo`). */
  const add = (token: string, loose = true) => {
    out.add(token)
    if (elongated(token)) out.add(squeeze(token))
    if (loose && doubled(token)) out.add(`~${collapse(token)}`)
  }
  const isNumber = (token: string) => /^\p{N}+$/u.test(token)
  for (const tokens of readings(s)) {
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
        add(token + next, false)
      if ([...token].length === 1 && !isNumber(token)) {
        run += token
        runLength++
      } else flush()
    })
    flush()
  }
  return [...out]
}

/** Whether `s` passes: no token, spelled-out run or joined pair of tokens is on `list`. Whole tokens only. */
export function check(s: string, list: WordList): { ok: true } | { ok: false } {
  for (const c of candidates(s)) if (list.has(c)) return { ok: false }
  return { ok: true }
}

export { normalise }
