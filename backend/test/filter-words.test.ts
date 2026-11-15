import { describe, expect, it } from 'vitest'
import { buildList, check } from '../src/filter'
import { wordsOk } from '../src/filter/server'
import { normalise } from '../src/filter/normalise'
import { ENGLISH_EVERYDAY, HINDI_EVERYDAY, HINGLISH_EVERYDAY } from './everyday-words'
import {
  DEVANAGARI,
  ENGLISH,
  HINGLISH,
  NAME_SAFE,
  PUBLIC_ONLY,
  STRONG,
  UNGLUED,
  WORDS,
} from '../src/filter/words'

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
      'planning an US visa trip',
      "that isn't its real name",
      "don't wink at me",
      "it's punk rock night",
      "the team's winger scored",
      "here's pic of the haveli",
      'I shot a video at Nahargarh',
      'strap on your helmet',
      'sunburn on her bare back',
      'a wet back after the rain',
      'cream pie at the bakery',
      'deep throat infection, so no chai',
      'Raj ka Mina se milna hai',
      'mere pa ki gaadi',
      'Thar ki ret',
      // everyday Hindi and Hinglish, in bench lines and chat
      'कोई कमी ना हो',
      'पूजा में कोई कमी ना रहे',
      'इस कमी ने सब बिगाड़ दिया',
      'tu shy hai kya',
      'tu shy kyun hai',
      'hum ping karenge',
      'mujhe apna dil do',
      'dil do na',
    ])
      expect(wordsOk(ok), ok).toBe(true)
  })

  /**
   * Listed words that two everyday words split into but that stay glued on purpose: the abuse is the point of
   * the word, and the everyday pair is rare enough to give up. Each with its reason. (The controller's ruling,
   * 2026-11-15, for the English ones; the -chod and other family compounds are never freed.)
   */
  const KEPT_GLUED: Record<string, string> = {
    asshole: 'per-token "ass" is refused anyway; "ass hole" is the insult, not a phrase',
    bangbus: 'the split is the sexual phrase itself, never an everyday one',
    birdlock: 'the split is the sexual phrase itself, never an everyday one',
    blowjob: 'the split is the sexual phrase itself, never an everyday one',
    bondage: 'ruling: kept glued ("bond age" is rare)',
    butthole: 'the split is the sexual phrase itself, never an everyday one',
    camgirl: 'the split is the sexual phrase itself, never an everyday one',
    circlejerk: 'the split is the sexual phrase itself, never an everyday one',
    cornhole: 'the split is the sexual phrase itself, never an everyday one',
    doggystyle: 'the split is the sexual phrase itself, never an everyday one',
    fingerbang: 'the split is the sexual phrase itself, never an everyday one',
    footjob: 'the split is the sexual phrase itself, never an everyday one',
    gangbang: 'the split is the sexual phrase itself, never an everyday one',
    handjob: 'the split is the sexual phrase itself, never an everyday one',
    jailbait: 'the split is the sexual phrase itself, never an everyday one',
    livesex: 'ruling: kept glued',
    muffdiving: 'the split is the sexual phrase itself, never an everyday one',
    ponyplay: 'the split is the sexual phrase itself, never an everyday one',
    rimjob: 'the split is the sexual phrase itself, never an everyday one',
    sexcam: 'the split is the sexual phrase itself, never an everyday one',
    shemale: 'ruling: kept glued (a slur; "she male" is rare)',
    threesome: 'ruling: kept glued',
    tubgirl: 'the split is the sexual phrase itself, never an everyday one',
    upskirt: 'the split is the sexual phrase itself, never an everyday one',
    worldsex: 'the split is the sexual phrase itself, never an everyday one',
    raghead: 'a racial slur; the split is the slur',
    towelhead: 'a racial slur; the split is the slur',
    slanteye: 'a racial slur; the split is the slur',
    hentai: '"hen tai" is no phrase',
    honkey: '"hon key" is no phrase',
    nutten: '"nut ten" is no phrase',
    pikey: '"pi key" is no phrase',
    behenchod: 'a -chod compound: never freed',
    'beti-chod': 'a -chod compound: never freed',
    betichod: 'a -chod compound: never freed',
    maachod: 'a -chod compound: never freed',
    gaand: 'a family stem: never freed ("ga and" is no phrase)',
    lode: 'a family stem (lod): never freed',
    harami: 'kept strong on review ("ha rami" is rare)',
    chinki: 'ruling: kept glued (a slur)',
    chinal: 'gendered abuse; "chin al" is no phrase',
    chinaal: 'gendered abuse; "china al" is no phrase',
    nude: 'refused in profile fields only; "nu de" is not Jaipur Hinglish',
  }

  it('every glued word that two everyday Hinglish, Hindi or English words split into is freed or kept on purpose', () => {
    const everyday = new Set(
      [...HINGLISH_EVERYDAY, ...HINDI_EVERYDAY, ...ENGLISH_EVERYDAY].flatMap((w) => normalise(w)),
    )
    const found: string[] = []
    for (const w of STRONG) {
      const glued = [...normalise(w).join('')]
      if (glued.length < 4) continue
      for (let at = 1; at < glued.length; at++) {
        const [a, b] = [glued.slice(0, at).join(''), glued.slice(at).join('')]
        if (everyday.has(a) && everyday.has(b) && !(w in KEPT_GLUED)) found.push(`${w}: ${a} ${b}`)
      }
    }
    expect(found).toEqual([])
    // and everything kept on purpose really is still glued
    for (const w of Object.keys(KEPT_GLUED)) expect(STRONG, w).toContain(w)
  })

  it('glues every listed word but the few left out on purpose, each for a real everyday split', () => {
    // the left-out list: each word with the everyday phrase that splits it, which must pass
    const left = new Set(UNGLUED.map(([w]) => w))
    for (const [w, phrase] of UNGLUED) {
      expect([...WORDS, ...PUBLIC_ONLY], w).toContain(w)
      expect(normalise(phrase).join(''), phrase).toBe(normalise(w).join(''))
      expect(wordsOk(phrase, 'about'), phrase).toBe(true)
    }
    // 25 today: the English splits ("pen is"), the Hinglish and Hindi ones ("dil do", "कमी ना") and the
    // possessive or contracted ones ("let's hit"). A cap, so the list stays a short, reviewed exception.
    expect(UNGLUED.length).toBeLessThanOrEqual(30)
    // every other listed word is glued, and no family stem is ever left out
    for (const w of [...WORDS, ...PUBLIC_ONLY]) expect(left.has(w) || STRONG.includes(w), w).toBe(true)
    const FAMILIES =
      /(chut|choot|bhos|bhon|gaand|gand|laud|lavd|lawd|lod|rand|raand|haram|kut|chod|jhaa?nt|चोद|चुत|चूत|भोस|गां|गाण|गान|ंड|ण्ड|लौड|लोड|रंड|रण्ड|हराम|कुत)/
    for (const w of WORDS.filter((x) => FAMILIES.test(x))) expect(left.has(w), w).toBe(false)
  })

  it('a glued word stays caught split anywhere, spelled out, leet or look-alike; "cum laude" still passes', () => {
    const LEET: Record<string, string> = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' }
    const LOOKS: Record<string, string> = { a: 'а', e: 'е', o: 'о', c: 'с', p: 'р' } // Cyrillic
    for (const w of STRONG) {
      const field = PUBLIC_ONLY.includes(w) ? 'about' : undefined
      const glued = [...normalise(w).join('')]
      if (glued.length < 4) continue // two tokens are glued only into a word of four or more
      for (let at = 1; at < glued.length; at++) {
        const parts = [glued.slice(0, at).join(''), glued.slice(at).join('')]
        expect(wordsOk(parts.join(' '), field), `${w} at ${at}`).toBe(false)
        if (/^[a-z]+$/.test(glued.join(''))) {
          // one letter of each part (a part of one letter stays: a lone digit is a number, not a letter)
          const leet = parts.map((p) => (p.length > 1 ? p.replace(/[aeiost]/, (c) => LEET[c]!) : p)).join(' ')
          expect(wordsOk(leet, field), `${w} leet at ${at}`).toBe(false)
          const looks = parts.map((p) => p.replace(/[aeocp]/g, (c) => LOOKS[c]!)).join(' ')
          expect(wordsOk(looks, field), `${w} look-alike at ${at}`).toBe(false)
        }
      }
      expect(wordsOk(glued.join(' '), field), `${w} spelled out`).toBe(false)
    }
    expect(wordsOk('graduated magna cum laude')).toBe(true)
  })

  it('sex, sexy, porn and nude: refused in names, profile fields, posters and request notes, fine in chat', () => {
    expect([...PUBLIC_ONLY].sort()).toEqual(['nude', 'porn', 'sex', 'sexy'])
    for (const w of PUBLIC_ONLY) expect(WORDS, w).not.toContain(w)
    const dressed = [
      'sex',
      'SEXY!',
      's3xy',
      'sеx',
      'p0rn',
      'pоrn',
      'nude',
      'nud3',
      'n u d e',
      's e x y',
      'se xy',
      'po rn',
    ]
    for (const field of ['name', 'status', 'about', 'poster', 'reason'])
      for (const s of dressed) expect(wordsOk(`hey ${s} there`, field), `${field}: ${s}`).toBe(false)
    // bench lines, statuses aside, and 1:1 chat (no field), and a report note to the moderator: fine
    for (const s of dressed) {
      expect(wordsOk(`hey ${s} there`), s).toBe(true)
      expect(wordsOk(`hey ${s} there`, 'note'), s).toBe(true)
    }
    // whole tokens only: a place, a tool, a salon and a noodle are not the word
    for (const field of ['name', 'about', 'poster'])
      for (const ok of [
        'Essex',
        'from Sussex and Middlesex',
        'a sextant and a compass',
        'unisex salon',
        'nudel soup',
        'sexagenarian dadi',
        'Pornic in France',
      ])
        expect(wordsOk(ok, field), `${field}: ${ok}`).toBe(true)
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
