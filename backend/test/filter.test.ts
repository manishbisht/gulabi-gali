import { applyD1Migrations, env, SELF } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { check, buildList, candidates } from '../src/filter'
import { normalise } from '../src/filter/normalise'
import type { Env } from '../src/env'
import { BENCH_POSITIONS } from '../src/district'
import type { DistrictId } from '../src/protocol'
import { closeAll, devId, live, resident, WAIT } from './helpers'

// Placeholder tokens only: no real slur appears in any test. Every write path below runs against this list.
vi.mock('../src/filter/words', () => ({
  WORDS: ['badword', 'ganda', 'गंदा', 'zzzstatus', 'namesafe'],
  NAME_SAFE: ['namesafe'],
}))

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const LIST = buildList(['badword', 'ganda', 'गंदा'])
const flagged = (s: string) => !check(s, LIST).ok

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

afterEach(() => closeAll())

describe('normalise', () => {
  it('lowercases, NFKC-folds, maps leetspeak and splits on separators', () => {
    expect(normalise('B4DW0RD, Ｇａｎｄａ! x_y')).toEqual(['badword', 'ganda', 'x', 'y'])
    expect(normalise('b@d $hit')).toEqual(['bad', 'shit'])
    expect(normalise('zero​width')).toEqual(['zerowidth'])
    expect(normalise('one\ntwo\tthree')).toEqual(['one', 'two', 'three'])
    expect(normalise('   ')).toEqual([])
  })
})

const ALL = buildList(['badword', 'ganda', 'गंदा', 'ass', 'tit'])
const caught = (s: string, list = LIST) => !check(s, list).ok

describe('numbers are not leetspeak', () => {
  it('spares digits alone, still catches leet inside words', () => {
    for (const s of ['Room 455', 'Flat 717', '4 5 5', 'call 455717', '7 1 7'])
      expect(caught(s, ALL), s).toBe(false)
    for (const s of ['@ss', '4ss', 'a55', 'a$s', '7!t']) expect(caught(s, ALL), s).toBe(true)
    expect(normalise('Room 455 4ss')).toEqual(['room', '455', 'ass'])
  })
})

describe('dressed-up spellings', () => {
  it('joiners inside a word (placeholder tokens)', () => {
    for (const s of [
      'b*dword',
      'b**word',
      'ba-dword',
      'bad.word',
      'b.a.d.w.o.r.d',
      'b_a_d_w_o_r_d',
      "bad'word",
      'bad~word',
      'bad|word',
      'b*d*w*r*d x',
    ])
      expect(caught(s), s).toBe(s === 'b*d*w*r*d x' ? false : true)
    expect(caught('bad!word')).toBe(true)
    // `!` and `|` read as `i`, so a placeholder with an i behaves like sh!t and b!tch
    const withI = buildList(['bitword'])
    for (const s of ['b!tword', 'b|tword', 'bi*word', 'bi-tword']) expect(caught(s, withI), s).toBe(true)
  })

  it('a sentence end is still a break, and a lone joiner is nothing', () => {
    expect(caught('so tired.Word is out')).toBe(false)
    expect(caught('bad ... word')).toBe(true) // a pair of neighbours, see below
    expect(caught('wow!! great *** day')).toBe(false)
  })

  it('neighbouring tokens glue (fu ck)', () => {
    for (const s of ['bad word', 'ba dword', 'badw ord', 'BAD   WORD', 'गं दा'])
      expect(caught(s), s).toBe(true)
    expect(caught('a b')).toBe(false)
  })

  it('combining marks, blanks, variation selectors and look-alike letters', () => {
    const word = 'badword'
    const marks = [...word].map((c) => `${c}\u0301\u0336`).join('')
    for (const s of [
      marks,
      'ba\u0301dword',
      'bad\u3164word',
      'bad\u115Fword\u1160',
      'b\uFFA0adword',
      'bad\uFE0Fword\uFE0E',
      'bаdwоrd', // Cyrillic а, о
      'badwοrd', // Greek omicron
      'ɑ'.length ? 'b\u0251dword' : '', // latin alpha
    ])
      expect(caught(s), s).toBe(true)
    const wide = buildList(['pekvxcisy'])
    expect(caught('рекνхсіѕу', wide)).toBe(false) // a mixed bag does not become a word by accident
    expect(caught('pеκνхcіѕу', wide)).toBe(true) // е κ ν х і ѕ
    expect(caught('pekvxcisу', wide)).toBe(true) // Cyrillic у
  })

  it('keeps Devanagari vowel signs, virama and nukta', () => {
    expect(normalise('गंदा')).toEqual(['गंदा'])
    expect(normalise('ग\u0902दा')).toEqual(['गंदा'])
    expect(normalise('ड़')).toEqual(['ड़'.normalize('NFKC')])
    expect(normalise('क्या सुंदर')).toEqual(['क्या', 'सुंदर'])
    expect(caught('सुंदर')).toBe(false)
    expect(normalise('Café Zoë')).toEqual(['cafe', 'zoe'])
  })

  it('any doubled letter: the collapsed form meets words of four letters or more', () => {
    for (const s of ['baadword', 'baaadword', 'badwoord', 'bbaaddwwoorrdd']) expect(caught(s), s).toBe(true)
    // a three-letter word is never loosened: only exact, or stretched (`assss`)
    const short = buildList(['ass'])
    expect(caught('as', short)).toBe(false)
    expect(caught('ass', short)).toBe(true)
    expect(caught('assss', short)).toBe(true)
    expect(caught('aas', short)).toBe(false)
  })
})

describe('the word filter', () => {
  it('catches leet and spaced variants', () => {
    for (const s of [
      'badword',
      'BADWORD',
      'b4dw0rd',
      'b a d w o r d',
      'b.a.d.w.o.r.d',
      'b-4-d-w-0-r-d',
      'baaadword',
      'you are a baaaaadwooooord',
      'what a ganda day',
    ])
      expect(flagged(s), s).toBe(true)
  })

  it('does not flag substrings in innocent words', () => {
    for (const s of [
      'badwords',
      'notbadwordatall',
      'gandalf the grey',
      'Scunthorpe',
      'I a m here at a count',
      'a b c d e f g',
      'badly word',
      'a bad day, word up',
      '',
    ])
      expect(flagged(s), s).toBe(false)
  })

  it('does not treat a normal double letter as elongation', () => {
    const list = buildList(['ass'])
    expect(check('as you wish', list).ok).toBe(true)
    expect(check('ass', list).ok).toBe(false)
    expect(check('assss', list).ok).toBe(false)
  })

  it('Devanagari and Roman Hinglish both checked', () => {
    expect(flagged('ये बहुत गंदा है')).toBe(true)
    expect(flagged('ye bahut ganda hai')).toBe(true)
    expect(flagged('ये बहुत सुंदर है')).toBe(false)
  })

  it('exposes the same candidates the frontend hashes', () => {
    expect(candidates('b a d w o r d')).toContain('badword')
    expect(candidates('baaad')).toContain('~bad')
    expect(candidates('bad')).not.toContain('~bad')
  })
})

const api = (path: string, token: string, init: RequestInit = {}) =>
  SELF.fetch(`https://api.test${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })

const PROFILE = {
  name: 'Filter Fatima',
  look: { skin: 1, outfit: 'pink', head: 'none' },
  status: 'chai pe',
  homeArea: 'Raja Park',
  hereFor: 'friends',
  about: 'Hello',
  adult: true,
  pledge: true,
}
const put = (token: string, over: Record<string, unknown>) =>
  api('/api/me/profile', token, { method: 'PUT', body: JSON.stringify({ ...PROFILE, ...over }) })

describe('every write path rejects with field', () => {
  it('profile name, status and about', async () => {
    const token = await resident('Filter Fatima')
    for (const [field, value] of [
      ['name', 'B4dw0rd'],
      ['status', 'so g a n d a'],
      ['about', 'line one\nbaaadword here'],
    ] as const) {
      const res = await put(token, { [field]: value })
      expect(res.status, field).toBe(400)
      expect(await res.json()).toEqual({ error: 'words', field })
    }
    // A word on NAME_SAFE is fine as a name, but not anywhere else.
    expect((await put(token, { name: 'Namesafe' })).status).toBe(200)
    expect(await (await put(token, { about: 'namesafe' })).json()).toEqual({ error: 'words', field: 'about' })
    expect(await (await put(token, { status: 'NameSafe' })).json()).toEqual({
      error: 'words',
      field: 'status',
    })
    await put(token, { name: 'Filter Fatima' })
    // Nothing was saved, and an innocent word containing a bad one is fine; a link is never word-filtered.
    expect((await put(token, { about: 'gandalf', link: 'https://example.com/badword' })).status).toBe(200)
    const saved = (await (await api('/api/me', token)).json()) as { profile: { name: string } }
    expect(saved.profile.name).toBe('Filter Fatima')
  })

  it('request reason', async () => {
    const a = await resident('Filter Asha')
    await resident('Filter Bilal')
    const send = (reason: string) =>
      api('/api/requests', a, { method: 'POST', body: JSON.stringify({ to: devId('Filter Bilal'), reason }) })
    const res = await send('You are such a b4dword person')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'words', field: 'reason' })
    expect((await send('Mujhe bhi gandalf pasand hai')).status).toBe(201)
  })

  it('chat message', async () => {
    const a = await resident('Filter Chandu')
    const b = await resident('Filter Dev')
    const { id } = (await (
      await api('/api/requests', a, {
        method: 'POST',
        body: JSON.stringify({ to: devId('Filter Dev'), reason: 'Mujhe bhi sketching pasand hai' }),
      })
    ).json()) as { id: string }
    const { matchId } = (await (await api(`/api/requests/${id}/accept`, b, { method: 'POST' })).json()) as {
      matchId: string
    }
    const say = (body: string) =>
      api(`/api/matches/${matchId}/messages`, a, { method: 'POST', body: JSON.stringify({ body }) })
    const res = await say('first line\nb a d w o r d')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'words', field: 'body' })
    expect((await say('first line ok')).status).toBe(201)
  })

  describe('bench say and status, over the socket', () => {
    const district: DistrictId = 'walled-city'
    it('answers words without a strike, and nobody else hears it', async () => {
      const a = await live(district, { token: await resident('Filter Esha') })
      const b = await live(district, { token: await resident('Filter Farid') })
      const at = BENCH_POSITIONS[district][0]!
      for (const c of [a, b]) {
        c.send({ t: 'move', x: at.x + 1.5, z: at.z, ry: 0 })
        c.send({ t: 'sit', bench: `${district}:0` })
        await c.next('seated', (m) => m.bench === `${district}:0`)
      }
      const from = b.mark()
      for (let i = 0; i < 6; i++) {
        a.send({ t: 'say', text: i % 2 ? 'b4dword' : 'b a d w o r d' })
        await vi.waitFor(
          () => expect(a.all('error').filter((m) => m.code === 'words')).toHaveLength(i + 1),
          WAIT,
        )
        // Past the bad-frame limit (it would close the socket) and the one-a-second lane: still alive.
        await new Promise((r) => setTimeout(r, 1100))
      }
      a.send({ t: 'status', text: 'zzzstatus' })
      await a.sync()
      expect(a.closes).toEqual([])
      expect(b.all('bench', from)).toEqual([])
      a.send({ t: 'say', text: 'chai peeoge?' })
      expect((await b.next('bench')).text).toBe('chai peeoge?')
    }, 30_000)
  })
})

describe('GET /api/filter/words.json', () => {
  it('is public, cacheable for a day, and ships hashes, never words', async () => {
    const res = await SELF.fetch('https://api.test/api/filter/words.json')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
    const body = (await res.json()) as { hashes: string[] }
    expect(body.hashes.every((h) => /^[0-9a-f]{40}$/.test(h))).toBe(true)
    const sha1 = async (s: string) =>
      [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    expect(body.hashes).toContain(await sha1('badword'))
    expect(body.hashes).toContain(await sha1('~badword'))
    expect(JSON.stringify(body)).not.toContain('badword')
  })
})
