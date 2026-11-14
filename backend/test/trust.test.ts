import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import type { Me } from '../src/protocol'
import { CODE_LENGTH, generateCode, issueCodes, normaliseCode } from '../src/trust'
import { api, closeAll, devId, live, resident, verify } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

afterEach(() => closeAll())

const REASON = 'Mujhe bhi pencil sketching pasand hai'
const LINK = 'https://example.com/asha'

type Invite = { code: string; used: boolean }
const invites = async (token: string) =>
  ((await (await api('/api/invites', token)).json()) as { codes: Invite[] }).codes
const redeem = (token: string, code: unknown) =>
  api('/api/invites/redeem', token, { method: 'POST', body: JSON.stringify({ code }) })
const me = async (token: string) => (await (await api('/api/me', token)).json()) as Me
const unverified = (name: string, over: Record<string, unknown> = {}) =>
  resident(name, over, { verified: false })

/** A verified member with codes in hand. */
async function member(name: string) {
  const token = await resident(name)
  await issueCodes(testEnv, devId(name), 2)
  return { token, codes: (await invites(token)).map((c) => c.code) }
}

describe('invite codes', () => {
  it('generates 8 characters of Crockford base32, and normalises what people type', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
    expect(CODE_LENGTH).toBe(8)
    expect(normaliseCode('ab12-cd34')).toBe('AB12CD34')
    expect(normaliseCode(' o1Il 0O1l ')).toBe('01110011')
    expect(normaliseCode(42)).toBeNull()
    expect(normaliseCode('short')).toBeNull()
    expect(normaliseCode('ABCD-EFGH-J')).toBeNull()
  })

  it('redeeming makes you verified and gives you 2 codes', async () => {
    const owner = await member('Inv Owner')
    const guest = await unverified('Inv Guest')
    expect((await me(guest)).verified).toBe(false)
    expect(await invites(guest)).toEqual([])

    const res = await redeem(guest, owner.codes[0])
    expect(res.status).toBe(200)
    const body = (await res.json()) as Me
    expect(body.verified).toBe(true)
    expect((await me(guest)).verified).toBe(true)
    const row = await testEnv.DB.prepare('SELECT verified_by FROM users WHERE id = ?')
      .bind(devId('Inv Guest'))
      .first<{ verified_by: string }>()
    expect(row?.verified_by).toBe(devId('Inv Owner'))

    const mine = await invites(guest)
    expect(mine).toHaveLength(2)
    expect(mine.every((c) => !c.used && /^[0-9A-Z]{8}$/.test(c.code))).toBe(true)
    // the owner gets nothing extra: their other code is still there, the used one says so
    const theirs = await invites(owner.token)
    expect(theirs).toHaveLength(2)
    expect(theirs.filter((c) => c.used).map((c) => c.code)).toEqual([owner.codes[0]])
  })

  it('accepts a code typed the way people type it', async () => {
    const owner = await member('Inv Typed Owner')
    const guest = await unverified('Inv Typed Guest')
    const code = owner.codes[0]!
    const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase()
    expect((await redeem(guest, typed)).status).toBe(200)
  })

  it('a code works once', async () => {
    const owner = await member('Once Owner')
    const first = await unverified('Once First')
    const second = await unverified('Once Second')
    expect((await redeem(first, owner.codes[0])).status).toBe(200)
    const again = await redeem(second, owner.codes[0])
    expect(again.status).toBe(410)
    expect(await again.json()).toEqual({ error: 'used' })
    expect((await me(second)).verified).toBe(false)
    expect((await redeem(second, 'ZZZZZZZZ')).status).toBe(404)
    expect(await (await redeem(second, 'nope')).json()).toEqual({ error: 'bad-code' })
    expect((await redeem(second, 42)).status).toBe(404)
  })

  it('two people redeeming the same code at once: exactly one wins', async () => {
    const owner = await member('Race Owner')
    const x = await unverified('Race X')
    const y = await unverified('Race Y')
    const results = await Promise.all([redeem(x, owner.codes[0]), redeem(y, owner.codes[0])])
    expect(results.map((r) => r.status).sort()).toEqual([200, 410])
    const rows = await testEnv.DB.prepare('SELECT used_by FROM invites WHERE code = ?')
      .bind(owner.codes[0])
      .all<{ used_by: string }>()
    expect(rows.results).toHaveLength(1)
    const verifiedCount = [await me(x), await me(y)].filter((m) => m.verified).length
    expect(verifiedCount).toBe(1)
  })

  it('one person redeeming two codes at once uses only one', async () => {
    const owner = await member('Twin Owner')
    const x = await unverified('Twin X')
    const results = await Promise.all(owner.codes.map((c) => redeem(x, c)))
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    const unused = (await invites(owner.token)).filter((c) => !c.used)
    expect(unused).toHaveLength(1)
    expect(await invites(x)).toHaveLength(2)
  })

  it('cannot redeem your own', async () => {
    const owner = await member('Own Owner')
    const res = await redeem(owner.token, owner.codes[0])
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'own-code' })
    expect((await invites(owner.token)).some((c) => c.used)).toBe(false)
  })

  it('a verified member cannot redeem, and the code is not burnt', async () => {
    const owner = await member('Already Owner')
    const other = await member('Already Other')
    const res = await redeem(other.token, owner.codes[0])
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already-verified' })
    expect((await invites(owner.token)).filter((c) => c.used)).toEqual([])
  })

  it('needs a resident: a ghost or no token gets nothing', async () => {
    const owner = await member('Ghost Owner')
    expect(
      (await api('/api/invites/redeem', 'dev.nobody.forged', { method: 'POST', body: '{}' })).status,
    ).toBe(401)
    // a token with no profile is a ghost
    const { login } = await import('./helpers')
    const ghost = await login('Ghost Redeemer')
    expect((await redeem(ghost, owner.codes[0])).status).toBe(403)
    expect((await invites(owner.token)).filter((c) => c.used)).toEqual([])
    expect((await api('/api/invites', ghost)).status).toBe(403)
  })

  it('tops up to 2 unused codes, never more', async () => {
    const owner = await member('Topup Owner')
    await issueCodes(testEnv, devId('Topup Owner'), 2)
    expect(await invites(owner.token)).toHaveLength(2)
  })

  it('a non-verified member has no codes to see', async () => {
    const guest = await unverified('Codeless')
    expect(await invites(guest)).toEqual([])
  })

  it('10 attempts an hour, then 429 with Retry-After', async () => {
    const guest = await unverified('Guessy')
    for (let i = 0; i < 10; i++) expect((await redeem(guest, 'ZZZZZZZZ')).status).toBe(404)
    const res = await redeem(guest, 'ZZZZZZZZ')
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })
})

describe('the verified tier', () => {
  it('non-verified cannot send requests', async () => {
    const asker = await unverified('Tier Asker')
    await resident('Tier Target')
    const res = await api('/api/requests', asker, {
      method: 'POST',
      body: JSON.stringify({ to: devId('Tier Target'), reason: REASON }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'not-verified' })
    // ...but can receive one, and can once verified
    const owner = await member('Tier Owner')
    expect((await redeem(asker, owner.codes[0])).status).toBe(200)
    const again = await api('/api/requests', asker, {
      method: 'POST',
      body: JSON.stringify({ to: devId('Tier Target'), reason: REASON }),
    })
    expect(again.status).toBe(201)
  })

  it('a non-verified resident can be asked, and can accept', async () => {
    const asker = await resident('Tier Asker 2')
    const target = await unverified('Tier Receiver')
    const sent = await api('/api/requests', asker, {
      method: 'POST',
      body: JSON.stringify({ to: devId('Tier Receiver'), reason: REASON }),
    })
    expect(sent.status).toBe(201)
    const { id } = (await sent.json()) as { id: string }
    expect((await api(`/api/requests/${id}/accept`, target, { method: 'POST' })).status).toBe(200)
  })

  it('an admin marking someone verified is the other way in', async () => {
    const guest = await unverified('Admin Marked')
    await verify('Admin Marked')
    expect((await me(guest)).verified).toBe(true)
  })
})

describe('the profile link', () => {
  const put = (token: string, name: string, over: Record<string, unknown> = {}) =>
    api('/api/me/profile', token, {
      method: 'PUT',
      body: JSON.stringify({
        name,
        look: { skin: 1, outfit: 'pink', head: 'none' },
        status: 'chai pe',
        homeArea: 'Raja Park',
        hereFor: 'friends',
        about: 'About.',
        adult: true,
        pledge: true,
        ...over,
      }),
    })
  const profileOf = async (viewer: string, name: string) =>
    (await (await api(`/api/profiles/${encodeURIComponent(devId(name))}`, viewer)).json()) as {
      link?: string
    }

  it('link only visible to verified viewers', async () => {
    const owner = await resident('Link Owner', { link: LINK })
    const insider = await resident('Link Insider')
    const outsider = await unverified('Link Outsider')

    expect((await profileOf(insider, 'Link Owner')).link).toBe(LINK)
    const hidden = await api(`/api/profiles/${encodeURIComponent(devId('Link Owner'))}`, outsider)
    expect(hidden.status).toBe(200)
    expect(await hidden.text()).not.toContain('example.com')
    // the owner sees their own, verified or not
    expect(((await me(owner)).profile as { link?: string }).link).toBe(LINK)
    const mine = await unverified('Link Mine', { link: LINK })
    expect(((await me(mine)).profile as { link?: string }).link).toBe(LINK)
  })

  it('the link is on no ghost or public surface', async () => {
    const owner = await resident('Link Public', { link: LINK })
    const other = await resident('Link Seen')
    // a ghost gets no profile at all
    const { login } = await import('./helpers')
    const ghost = await login('Link Ghost')
    const res = await api(`/api/profiles/${encodeURIComponent(devId('Link Public'))}`, ghost)
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain('example.com')
    // the map, and a request list, carry public people only
    const watcher = await live('walled-city', { token: other })
    const mate = await live('walled-city', { token: owner })
    mate.send({ t: 'move', x: 1, z: 1, ry: 0 })
    await watcher.next('join', (m) => m.p.id === devId('Link Public'))
    expect(JSON.stringify(watcher.messages)).not.toContain('example.com')
    expect(JSON.stringify(mate.messages)).not.toContain('example.com')
    const sent = await api('/api/requests', owner, {
      method: 'POST',
      body: JSON.stringify({ to: devId('Link Seen'), reason: REASON }),
    })
    expect(sent.status).toBe(201)
    expect(await (await api('/api/requests', other)).text()).not.toContain('example.com')
    expect(await (await api('/api/matches', other)).text()).not.toContain('example.com')
  })

  it('saving the profile without the link field keeps the stored link', async () => {
    const token = await resident('Link Keeper', { link: LINK })
    const body = { link: undefined }
    expect((await put(token, 'Link Keeper', body)).status).toBe(200)
    expect(((await me(token)).profile as { link?: string }).link).toBe(LINK)
    // an explicit null clears it, and an empty string does too
    expect((await put(token, 'Link Keeper', { link: null })).status).toBe(200)
    expect(((await me(token)).profile as { link?: string }).link).toBeUndefined()
    expect((await put(token, 'Link Keeper', { link: LINK })).status).toBe(200)
    expect((await put(token, 'Link Keeper', { link: '' })).status).toBe(200)
    expect(((await me(token)).profile as { link?: string }).link).toBeUndefined()
  })

  it('stores the normalised href, https only, no control characters', async () => {
    const token = await resident('Link Clean')
    expect((await put(token, 'Link Clean', { link: 'HTTPS://Example.COM' })).status).toBe(200)
    expect(((await me(token)).profile as { link?: string }).link).toBe('https://example.com/')
    for (const bad of [
      'http://example.com',
      'javascript:alert(1)',
      'https://user:pw@example.com',
      'https://example.com/\u0007x',
      'https://example.com/​x',
      'https://example.com/a\nb',
      `https://example.com/${'a'.repeat(200)}`,
      'not a url',
      42,
    ]) {
      const res = await put(token, 'Link Clean', { link: bad })
      expect(res.status, String(bad)).toBe(400)
      expect(((await res.json()) as { fields: string[] }).fields).toEqual(['link'])
    }
    expect(((await me(token)).profile as { link?: string }).link).toBe('https://example.com/')
  })
})

describe('hardening carried from phase 2', () => {
  const body = (over: Record<string, unknown>) =>
    JSON.stringify({
      name: 'Hard Asha',
      look: { skin: 1, outfit: 'pink', head: 'none' },
      status: 'chai pe',
      homeArea: 'Raja Park',
      hereFor: 'friends',
      about: 'About.',
      adult: true,
      pledge: true,
      ...over,
    })

  it('status is one line, but about keeps its newlines', async () => {
    const token = await resident('Hard Asha')
    const res = await api('/api/me/profile', token, {
      method: 'PUT',
      body: body({ status: 'chai\npe\r\nchalo', about: 'line one\nline two' }),
    })
    expect(res.status).toBe(200)
    const profile = ((await res.json()) as Me).profile!
    expect(profile.status).toBe('chaipechalo')
    expect(profile.about).toBe('line one\nline two')
  })

  it('a body over 16 KB is refused before it is parsed', async () => {
    const token = await resident('Hard Big')
    const res = await api('/api/me/profile', token, {
      method: 'PUT',
      body: body({ about: 'x'.repeat(17 * 1024) }),
    })
    expect(res.status).toBe(400)
    const ok = await api('/api/me/profile', token, { method: 'PUT', body: body({ about: 'x'.repeat(100) }) })
    expect(ok.status).toBe(200)
  })

  it('a malformed profile id is a 404, and the lookup is not inside the try', async () => {
    const token = await resident('Hard Viewer')
    expect((await api('/api/profiles/%E0%A4%A', token)).status).toBe(404)
    expect((await api('/api/profiles/nobody-here', token)).status).toBe(404)
  })
})
