import { describe, expect, it } from 'vitest'
import { buildList, check } from '../src/filter'
import { DEVANAGARI, ENGLISH, HINGLISH, WORDS } from '../src/filter/words'

// The shipped list, unmocked. It is only measured here, never spelled out: no slur appears in a test.
const real = buildList(WORDS)

describe('the shipped word list', () => {
  it('is non-trivial in all three scripts, and every entry survives normalisation', () => {
    expect(ENGLISH.length).toBeGreaterThan(150)
    expect(HINGLISH.length).toBeGreaterThan(80)
    expect(DEVANAGARI.length).toBeGreaterThan(40)
    for (const w of WORDS) expect(real.has([...buildList([w])][0]!), w).toBe(true)
    expect(real.size).toBeGreaterThan(WORDS.length)
  })

  it('catches its own entries, spelled out and stretched', () => {
    for (const w of [ENGLISH[10]!, HINGLISH[10]!, DEVANAGARI[10]!]) {
      expect(check(`kya ${w} hai`, real).ok, w).toBe(false)
      expect(check([...w].join(' '), real).ok, `${w} spaced`).toBe(false)
    }
  })

  it('leaves everyday English, Hinglish and Jaipur words alone', () => {
    for (const ok of [
      'chai',
      'kachori',
      'hello there',
      'class assignment',
      'assistant',
      'Jaipur Hawa Mahal',
      'chod do yaar, kal milte hain',
      'maal pua and ghewar at the market',
      'gucchi bag',
      'Scunthorpe, Sussex, Essex, Middlesex',
      'cocktail, peacock, shitake, therapist, grape, analysis, document',
      'आज चाय पीते हैं, जयपुर में',
      'xxxxxxxxxx and ooooh, aaaaand sooooo goooood',
    ])
      expect(check(ok, real).ok, ok).toBe(true)
  })
})
