import { collapse, elongated, normalise, squeeze } from './normalise'

/**
 * What the filter looks up: a set of normalised words, plus `~`-marked loose forms (see `buildList`). The
 * server builds it from the raw list; the page checks the SHA-1 of each candidate against a hashed copy.
 */
export interface WordList {
  has(candidate: string): boolean
}

/** A run of this many single-character tokens or more (`b a d w o r d`) is also checked glued together. */
const MIN_SPELLED = 3
/** A loose (collapsed) form is kept only for words that are at least this long once collapsed. */
const MIN_LOOSE = 3

/**
 * The raw words as a `Set`: each one normalised and glued into a single token, and also its `collapse`d form
 * behind a `~` when that is 3+ letters, which only an elongated input is compared with (`baaadword` is
 * `badword`, while a plain `as` is never `ass`; an elongated input is also squeezed, so `assss` is `ass`). `~` is never part of a token, so the two kinds cannot meet.
 */
export function buildList(words: readonly string[]): Set<string> {
  const set = new Set<string>()
  for (const word of words) {
    const w = normalise(word).join('')
    if (!w) continue
    set.add(w)
    // A loose form this short would match any stretched letter (`xxxxxxx`): those words only match as spelled.
    const loose = collapse(w)
    if ([...loose].length >= MIN_LOOSE) set.add(`~${loose}`)
  }
  return set
}

/** Every string worth looking up for `s`: each token, and each run of single-character tokens glued. */
export function candidates(s: string): string[] {
  const out = new Set<string>()
  const add = (token: string) => {
    out.add(token)
    if (elongated(token)) {
      out.add(squeeze(token))
      out.add(`~${collapse(token)}`)
    }
  }
  let run = ''
  let runLength = 0
  const flush = () => {
    if (runLength >= MIN_SPELLED) add(run)
    run = ''
    runLength = 0
  }
  for (const token of normalise(s)) {
    add(token)
    if ([...token].length === 1) {
      run += token
      runLength++
    } else flush()
  }
  flush()
  return [...out]
}

/** Whether `s` passes: no token, and no spelled-out run of letters, is on `list`. Whole tokens only. */
export function check(s: string, list: WordList): { ok: true } | { ok: false } {
  for (const c of candidates(s)) if (list.has(c)) return { ok: false }
  return { ok: true }
}

export { normalise }
