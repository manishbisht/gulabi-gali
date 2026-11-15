import { applyD1Migrations, env, runInDurableObject } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { parseClientMsg } from '../src/district'
import type { Env } from '../src/env'
import { REACT_PAIR_MS, REACT_PER_MINUTE, REACT_RANGE_M, type DistrictId } from '../src/protocol'
import { api, closeAll, devId, live, login, resident, type LiveClient } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }
const stub = (id: DistrictId) => testEnv.DISTRICT.get(testEnv.DISTRICT.idFromName(id))
const sql = (q: string, ...args: unknown[]) =>
  testEnv.DB.prepare(q)
    .bind(...args)
    .run()

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})
afterEach(() => closeAll())

/** A resident on the street at (x, z). */
async function walker(name: string, district: DistrictId, x: number, z = 0): Promise<LiveClient> {
  const c = await live(district, { token: await resident(name) })
  c.send({ t: 'move', x, z, ry: 0 })
  await c.sync()
  return c
}

const block = (token: string, id: string) =>
  api('/api/blocks', token, { method: 'POST', body: JSON.stringify({ id }) })

/** Runs `fn` with the district's clock `ms` ahead, then puts it back. */
async function later(district: DistrictId, ms: number, fn: () => Promise<void>) {
  await runInDurableObject(stub(district), (instance) => {
    instance.clock = () => Date.now() + ms
  })
  try {
    await fn()
  } finally {
    await runInDurableObject(stub(district), (instance) => {
      instance.clock = Date.now
    })
  }
}

describe('react frames', () => {
  it('parses a namaste or a wave to someone, and nothing else', () => {
    expect(parseClientMsg('{"t":"react","to":"dev:x","kind":"namaste"}')).toEqual({
      t: 'react',
      to: 'dev:x',
      kind: 'namaste',
    })
    expect(parseClientMsg('{"t":"react","to":"dev:x","kind":"wave","extra":1}')).toEqual({
      t: 'react',
      to: 'dev:x',
      kind: 'wave',
    })
    for (const bad of [
      '{"t":"react","to":"dev:x","kind":"kiss"}',
      '{"t":"react","to":"dev:x"}',
      '{"t":"react","kind":"wave"}',
      '{"t":"react","to":5,"kind":"wave"}',
      `{"t":"react","to":"${'x'.repeat(65)}","kind":"wave"}`,
    ])
      expect(parseClientMsg(bad), bad).toBeNull()
  })
})

describe('reactions', () => {
  it('reach both people and whoever near can see both, ghosts watching included, and nobody far', async () => {
    const d: DistrictId = 'walled-city'
    const a = await walker('React Asha', d, 0)
    const b = await walker('React Bina', d, 3)
    const c = await walker('React Chetan', d, 10)
    const far = await walker('React Faraway', d, 200)
    const ghost = await live(d)
    ghost.send({ t: 'move', x: 5, z: 0, ry: 0 })
    await ghost.sync()
    const marks = [a, b, c, far, ghost].map((s) => s.mark())

    a.send({ t: 'react', to: devId('React Bina'), kind: 'namaste' })
    const want = { t: 'react', from: devId('React Asha'), to: devId('React Bina'), kind: 'namaste' }
    for (const [i, s] of [a, b, c, ghost].entries())
      expect(await s.next('react', undefined, marks[[0, 1, 2, 4][i]!])).toEqual(want)
    await far.sync()
    expect(far.all('react', marks[3])).toEqual([])
  })

  it('are never stored: the district keeps nothing and D1 gains nothing', async () => {
    const d: DistrictId = 'university'
    const tables = async () =>
      (
        await testEnv.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{
          name: string
        }>()
      ).results.map((r) => r.name)
    const before = await tables()
    const a = await walker('Store Asha', d, 0)
    const b = await walker('Store Bina', d, 2)
    a.send({ t: 'react', to: devId('Store Bina'), kind: 'wave' })
    await b.next('react')
    expect(await tables()).toEqual(before)
    expect(before.some((t) => /react/i.test(t))).toBe(false)
    const kept = await runInDurableObject(stub(d), async (_i, state) => [
      ...(await state.storage.list()).keys(),
    ])
    expect(kept).toEqual([])
  })

  it('residents only: a ghost cannot send one, nor be greeted', async () => {
    const d: DistrictId = 'mi-road'
    const a = await walker('Ghostly Asha', d, 0)
    const ghost = await live(d, { token: await login('Ghostly Halfway') })
    ghost.send({ t: 'move', x: 1, z: 0, ry: 0 })
    await ghost.sync()
    ghost.send({ t: 'react', to: devId('Ghostly Asha'), kind: 'wave' })
    expect(await ghost.next('react-no')).toEqual({ t: 'react-no', to: devId('Ghostly Asha'), why: 'ghost' })
    a.send({ t: 'react', to: devId('Ghostly Halfway'), kind: 'wave' })
    expect(await a.next('react-no')).toEqual({ t: 'react-no', to: devId('Ghostly Halfway'), why: 'gone' })
    await a.sync()
    expect(a.all('react')).toEqual([])
  })

  it('a hidden person can neither send nor be greeted', async () => {
    const d: DistrictId = 'mi-road'
    const a = await walker('Hide Asha', d, 0)
    const token = await resident('Hide Hema')
    await sql('UPDATE users SET hidden = 1 WHERE id = ?', devId('Hide Hema'))
    const hidden = await live(d, { token })
    hidden.send({ t: 'move', x: 1, z: 0, ry: 0 })
    await hidden.sync()
    hidden.send({ t: 'react', to: devId('Hide Asha'), kind: 'namaste' })
    expect((await hidden.next('react-no')).why).toBe('ghost')
    a.send({ t: 'react', to: devId('Hide Hema'), kind: 'namaste' })
    expect((await a.next('react-no')).why).toBe('gone')
  })

  it('a muted resident cannot send one', async () => {
    const d: DistrictId = 'malviya-nagar'
    const b = await walker('Mute Bina', d, 2)
    const token = await resident('Mute Mohan')
    await sql('UPDATE users SET muted_until = ? WHERE id = ?', Date.now() + 3600_000, devId('Mute Mohan'))
    const m = await live(d, { token })
    m.send({ t: 'move', x: 0, z: 0, ry: 0 })
    await m.sync()
    const from = b.mark()
    m.send({ t: 'react', to: devId('Mute Bina'), kind: 'wave' })
    expect((await m.next('react-no')).why).toBe('muted')
    await b.sync()
    expect(b.all('react', from)).toEqual([])
  })

  it(`only within ${REACT_RANGE_M} m of the sender's last accepted point, and only once they are on the street`, async () => {
    const d: DistrictId = 'university'
    const a = await walker('Range Asha', d, 0, 40)
    const b = await walker('Range Bina', d, REACT_RANGE_M + 0.5, 40)
    a.send({ t: 'react', to: devId('Range Bina'), kind: 'wave' })
    expect((await a.next('react-no')).why).toBe('far')
    await b.sync()
    expect(b.all('react')).toEqual([])
    // a resident who has not stepped onto the street yet is nowhere: too far from anyone
    const still = await live(d, { token: await resident('Range Still') })
    await still.sync()
    still.send({ t: 'react', to: devId('Range Asha'), kind: 'wave' })
    expect((await still.next('react-no')).why).toBe('far')
    // a step closer, and it goes
    a.send({ t: 'move', x: 1, z: 40, ry: 0 })
    a.send({ t: 'react', to: devId('Range Bina'), kind: 'wave' })
    await b.next('react')
  })

  it('blocks keep both ways apart, and a third person who blocked either one sees nothing', async () => {
    const d: DistrictId = 'walled-city'
    const ta = await resident('Apart Asha')
    const tb = await resident('Apart Bina')
    const a = await live(d, { token: ta })
    const b = await live(d, { token: tb })
    a.send({ t: 'move', x: 50, z: 50, ry: 0 })
    b.send({ t: 'move', x: 52, z: 50, ry: 0 })
    await a.sync()
    await b.sync()
    expect((await block(ta, devId('Apart Bina'))).status).toBe(204)
    await b.next('leave', (m) => m.id === devId('Apart Asha'))
    a.send({ t: 'react', to: devId('Apart Bina'), kind: 'wave' })
    expect((await a.next('react-no')).why).toBe('gone')
    b.send({ t: 'react', to: devId('Apart Asha'), kind: 'wave' })
    expect((await b.next('react-no')).why).toBe('gone')

    // C greets D: E blocked C (the sender), F was blocked by D (the target); G, blocked by nobody, sees it
    const tc = await resident('Apart Chetan')
    const te = await resident('Apart Esha')
    const td = await resident('Apart Dev')
    const c = await live(d, { token: tc })
    const dd = await live(d, { token: td })
    const e = await live(d, { token: te })
    const f = await walker('Apart Farid', d, 54, 52)
    const g = await walker('Apart Gita', d, 54, 53)
    for (const [s, x] of [
      [c, 50],
      [dd, 52],
      [e, 53],
    ] as const) {
      s.send({ t: 'move', x, z: 52, ry: 0 })
      await s.sync()
    }
    expect((await block(te, devId('Apart Chetan'))).status).toBe(204)
    expect((await block(td, devId('Apart Farid'))).status).toBe(204)
    await e.next('leave', (m) => m.id === devId('Apart Chetan'))
    await f.next('leave', (m) => m.id === devId('Apart Dev'))
    const [fe, ff] = [e.mark(), f.mark()]
    c.send({ t: 'react', to: devId('Apart Dev'), kind: 'namaste' })
    await dd.next('react')
    await g.next('react')
    await e.sync()
    await f.sync()
    expect(e.all('react', fe)).toEqual([])
    expect(f.all('react', ff)).toEqual([])
  })

  it(`once per ${REACT_PAIR_MS / 1000} s to the same person, and ${REACT_PER_MINUTE} a minute in all`, async () => {
    const d: DistrictId = 'malviya-nagar'
    const a = await walker('Often Asha', d, -60, -60)
    const names = ['B', 'C', 'D', 'E', 'F', 'G'].map((n) => `Often ${n}ina`)
    const others: LiveClient[] = []
    for (const [i, n] of names.entries())
      others.push(await walker(n, d, -60 + (i % 3), -59 + Math.floor(i / 3)))
    const ids = names.map(devId)

    // everyone here watches each greeting: each waits for the one to them
    const greeted = (i: number, from?: number) => others[i]!.next('react', (m) => m.to === ids[i], from)
    a.send({ t: 'react', to: ids[0]!, kind: 'wave' })
    await greeted(0)
    a.send({ t: 'react', to: ids[0]!, kind: 'namaste' })
    expect(await a.next('react-no')).toEqual({ t: 'react-no', to: ids[0], why: 'wait' })
    // someone else is fine meanwhile: five more, six this minute
    for (const [i, id] of ids.slice(1).entries()) {
      a.send({ t: 'react', to: id, kind: 'wave' })
      await greeted(i + 1)
    }
    await later(d, REACT_PAIR_MS + 500, async () => {
      // past the pair's wait, B to E again: ten in the minute, and the eleventh waits
      const from = a.mark()
      for (const i of [0, 1, 2, 3]) {
        const mark = others[i]!.mark()
        a.send({ t: 'react', to: ids[i]!, kind: 'namaste' })
        await greeted(i, mark)
      }
      a.send({ t: 'react', to: ids[4]!, kind: 'namaste' })
      expect(await a.next('react-no', undefined, from)).toEqual({ t: 'react-no', to: ids[4], why: 'wait' })
    })
  }, 20_000)
})
