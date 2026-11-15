import { describe, expect, it } from 'vitest'
import { buildList, check } from '../src/filter'
import { wordsOk } from '../src/filter/server'
import { normalise } from '../src/filter/normalise'
import { DEVANAGARI, ENGLISH, HINGLISH, NAME_SAFE, STRONG, WORDS } from '../src/filter/words'

// The shipped list, unmocked. It is only measured here, never spelled out: no slur appears in a test.
const real = buildList(WORDS, STRONG)

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

  it('spares real first names, in a name and anywhere else', () => {
    for (const name of [
      'Kamini',
      'Kutti',
      'Dick',
      'Lund',
      'Kike',
      'Mong',
      'Tarki',
      'Dalli',
      'Guro',
      'Kanjar',
    ]) {
      expect(wordsOk(name, 'name'), name).toBe(true)
      expect(wordsOk(`Hi, I am ${name}`), name).toBe(true)
    }
  })

  it('NAME_SAFE words pass only as a name', () => {
    for (const w of NAME_SAFE) {
      expect(wordsOk(w, 'name'), w).toBe(true)
      expect(wordsOk(w, 'about'), w).toBe(false)
      expect(wordsOk(`kya ${w} hai`), w).toBe(false)
    }
  })

  it('is not too strict for a bio, and never lists bc or mc', () => {
    for (const ok of [
      'sexy',
      'nude drawing class',
      'a blue tit',
      'bc',
      'mc',
      'BC and MC',
      'Room 455, Flat 717',
    ])
      expect(wordsOk(ok), ok).toBe(true)
    for (const w of WORDS) expect(['bc', 'mc', 'sexy', 'nude', 'cum', 'tit', 'dick']).not.toContain(w)
  })

  it('glues two tokens into a strong-abuse word only: everyday phrases that split a listed word pass', () => {
    for (const ok of [
      'the pen is mightier than the sword',
      'an Al Jazeera report on Jaipur',
      'who re-entered the chat?',
      'who re ran the stall',
      'graduated magna cum laude',
      'cum laude, 2019',
      "let's hit the bazaar",
      'tit for tat',
    ])
      expect(wordsOk(ok), ok).toBe(true)
  })

  it('the strong subset is listed, takes every "-chod" compound, and stays strong split, spaced, leet or look-alike', () => {
    expect(STRONG.length).toBeGreaterThan(40)
    for (const w of STRONG) expect(WORDS, w).toContain(w)
    for (const w of WORDS.filter((x) => /^.+(chod|चोद)/.test(x))) expect(STRONG, w).toContain(w)
    const LEET: Record<string, string> = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' }
    const LOOKS: Record<string, string> = { a: 'а', e: 'е', o: 'о', c: 'с', p: 'р' } // Cyrillic
    for (const w of STRONG) {
      const glued = normalise(w).join('')
      for (let at = 1; at < [...glued].length; at++) {
        const parts = [[...glued].slice(0, at).join(''), [...glued].slice(at).join('')]
        expect(wordsOk(parts.join(' ')), `${w} at ${at}`).toBe(false)
        if (/^[a-z]+$/.test(glued)) {
          // one letter of each part (a part of one letter stays: a lone digit is a number, not a letter)
          const leet = parts.map((p) => (p.length > 1 ? p.replace(/[aeiost]/, (c) => LEET[c]!) : p)).join(' ')
          expect(wordsOk(leet), `${w} leet at ${at}`).toBe(false)
          const looks = parts.map((p) => p.replace(/[aeocp]/g, (c) => LOOKS[c]!)).join(' ')
          expect(wordsOk(looks), `${w} look-alike at ${at}`).toBe(false)
        }
      }
      expect(wordsOk([...glued].join(' ')), `${w} spelled out`).toBe(false)
    }
  })

  it('has the added variants', () => {
    for (const w of ['bsdk', 'bkl', 'भेनचोद', 'भैनचोद', 'चूतीया', 'गाँड']) {
      expect(WORDS, w).toContain(w)
      expect(wordsOk(w), w).toBe(false)
    }
  })

  it('catches the shipped list dressed up', () => {
    // (split by a space, only a strong word is glued back: see the strong subset above)
    const w = ENGLISH.find((x) => x.length >= 5 && /^[a-z]+$/.test(x))!
    const mid = Math.floor(w.length / 2)
    for (const s of [
      `${w.slice(0, mid)}-${w.slice(mid)}`,
      `${w.slice(0, mid)}.${w.slice(mid)}`,
      `${w[0]}**${w.slice(3)}`,
      `${w}${w.at(-1)}${w.at(-1)}`,
      `${w.slice(0, 2)}\u0301${w.slice(2)}`,
    ])
      expect(wordsOk(s), s).toBe(false)
  })
})
