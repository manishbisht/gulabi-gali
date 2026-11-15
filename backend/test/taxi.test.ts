import { applyD1Migrations, env } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import { BENCH_POSITIONS, DISTRICT_IDS, SPEED_BURST_M, TAXI, TAXI_RANGE_M } from '../src/district'
import { api, closeAll, devId, live, resident } from './helpers'

const testEnv = env as unknown as Env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
})

afterEach(() => closeAll())

/** The Walled City's auto stand on Johari Bazaar, and the drop point by Hawa Mahal's face. */
const STAND = { x: -2.6, z: 30 }
const HAWA = TAXI['walled-city'].drops['hawa-mahal']!

describe('the auto-taxi', () => {
  it('knows a stand and a drop point for every district, and a drop for each landmark only', () => {
    expect(Object.keys(TAXI).sort()).toEqual([...DISTRICT_IDS].sort())
    expect(TAXI['walled-city'].stands).toContainEqual(STAND)
    expect(Object.keys(TAXI['walled-city'].drops).sort()).toEqual([
      'badi-chaupar',
      'hawa-mahal',
      'jantar-mantar',
      'tripolia-gate',
    ])
    expect(TAXI_RANGE_M).toBe(3)
  })

  it('a ride from beside a stand sets the rider down by the landmark: gone from the street, back there on their next step', async () => {
    const rider = await live('walled-city', { token: await resident('Ride Rekha') })
    const there = await live('walled-city', { token: await resident('Hawa Watcher') })
    const here = await live('walled-city', { token: await resident('Stand Watcher') })
    rider.send({ t: 'move', x: -1.2, z: 30.5, ry: 0 })
    there.send({ t: 'move', x: 30, z: -8, ry: 0 })
    here.send({ t: 'move', x: 0, z: 34, ry: 0 })
    for (const c of [rider, there, here]) await c.sync()
    await here.next('join', (m) => m.p.id === 'dev:ride-rekha')
    const fromThere = there.mark()
    const fromHere = here.mark()

    // where they stand now (a step on from the last move), 1.2 m from the auto
    rider.send({ t: 'ride', to: 'hawa-mahal', x: -1.4, z: 30.6 })
    await here.next('leave', (m) => m.id === 'dev:ride-rekha', fromHere)
    // out of the auto beside it: 2 m from the drop point is a walk on from it, ~65 m from the stand
    rider.send({ t: 'move', x: HAWA.x + 2, z: HAWA.z, ry: 0 })
    const join = await there.next('join', (m) => m.p.id === 'dev:ride-rekha', fromThere)
    expect(join.p).toMatchObject({ x: HAWA.x + 2, z: HAWA.z })
    rider.send({ t: 'move', x: HAWA.x + 2.5, z: HAWA.z, ry: 0 })
    await there.next('moves', (m) => m.m.some(([id]) => id === 'dev:ride-rekha'), fromThere)
    await rider.sync()
    expect(rider.all('error')).toEqual([])
  })

  it('every drop is further from every stand than a stand reach and a burst: a ride never chains into another', () => {
    for (const id of DISTRICT_IDS)
      for (const [landmark, drop] of Object.entries(TAXI[id].drops))
        for (const s of TAXI[id].stands)
          expect(Math.hypot(drop.x - s.x, drop.z - s.z), `${id} ${landmark}`).toBeGreaterThan(
            TAXI_RANGE_M + SPEED_BURST_M,
          )
  })

  it('a ghost may ride too, and nobody sees it go or arrive', async () => {
    const jkk = TAXI.university.drops.jkk!
    const [stand] = TAXI.university.stands
    // a resident standing right at the drop point, and one at the stand
    const there = await live('university', { token: await resident('Ghost Watcher Gita') })
    const here = await live('university', { token: await resident('Ghost Watcher Girish') })
    there.send({ t: 'move', x: jkk.x + 2, z: jkk.z, ry: 0 })
    here.send({ t: 'move', x: stand!.x + 1, z: stand!.z, ry: 0 })
    await there.sync()
    await here.sync()
    const ghost = await live('university')
    await ghost.next('welcome')
    const [fromThere, fromHere] = [there.mark(), here.mark()]
    ghost.send({ t: 'move', x: stand!.x, z: stand!.z + 2, ry: 0 })
    ghost.send({ t: 'ride', to: 'jkk', x: stand!.x, z: stand!.z + 2 })
    ghost.send({ t: 'move', x: jkk.x + 1, z: jkk.z, ry: 0 })
    ghost.send({ t: 'move', x: jkk.x + 1.5, z: jkk.z, ry: 0 })
    await ghost.sync()
    expect(ghost.all('error')).toEqual([])
    await new Promise((r) => setTimeout(r, 250)) // past a move batch
    await there.sync()
    await here.sync()
    expect(there.messages.slice(fromThere)).toEqual([{ t: 'pong' }])
    expect(here.messages.slice(fromHere)).toEqual([{ t: 'pong' }])
  })

  it('someone who blocked the rider hears neither the leave nor the rejoin; anyone else hears both', async () => {
    const riderToken = await resident('Blocked Bharat')
    const blockerToken = await resident('Blocker Bela')
    const rider = await live('walled-city', { token: riderToken })
    const blocker = await live('walled-city', { token: blockerToken })
    const other = await live('walled-city', { token: await resident('Other Omkar') })
    rider.send({ t: 'move', x: STAND.x + 1.5, z: STAND.z, ry: 0 })
    blocker.send({ t: 'move', x: STAND.x + 3, z: STAND.z + 2, ry: 0 })
    other.send({ t: 'move', x: HAWA.x, z: HAWA.z + 4, ry: 0 })
    await blocker.next('join', (m) => m.p.id === devId('Blocked Bharat'))
    await other.next('join', (m) => m.p.id === devId('Blocked Bharat'))
    expect(
      (
        await api('/api/blocks', blockerToken, {
          method: 'POST',
          body: JSON.stringify({ id: devId('Blocked Bharat') }),
        })
      ).status,
    ).toBeLessThan(300)
    // the block itself takes the rider off the blocker's street
    await blocker.next('leave', (m) => m.id === devId('Blocked Bharat'))
    const [fromBlocker, fromOther] = [blocker.mark(), other.mark()]

    rider.send({ t: 'ride', to: 'hawa-mahal', x: STAND.x + 1.5, z: STAND.z })
    rider.send({ t: 'move', x: HAWA.x + 1, z: HAWA.z, ry: 0 })
    await other.next('leave', (m) => m.id === devId('Blocked Bharat'), fromOther)
    await other.next('join', (m) => m.p.id === devId('Blocked Bharat'), fromOther)
    await rider.sync()
    expect(rider.all('error')).toEqual([])
    await blocker.sync()
    expect(JSON.stringify(blocker.messages.slice(fromBlocker))).not.toContain(devId('Blocked Bharat'))
  })

  it('a ride refills no burst: one spent on the way to the stand is still spent at the drop', async () => {
    const rider = await live('walled-city', { token: await resident('Spent Sapna') })
    // 7.5 m in one hop to beside the stand: almost the whole 8 m burst gone
    rider.send({ t: 'move', x: STAND.x + 9.5, z: STAND.z, ry: 0 })
    rider.send({ t: 'move', x: STAND.x + 2, z: STAND.z, ry: 0 })
    rider.send({ t: 'ride', to: 'hawa-mahal', x: STAND.x + 2, z: STAND.z })
    // so a 3 m step at once off the drop point is more than is left
    rider.send({ t: 'move', x: HAWA.x + 3, z: HAWA.z, ry: 0 })
    expect(await rider.next('error')).toEqual({
      t: 'error',
      code: 'too-fast',
      x: HAWA.x,
      z: HAWA.z,
      ry: HAWA.ry,
    })
  })

  it('after a ride the speed check carries on from the drop point', async () => {
    const rider = await live('walled-city', { token: await resident('Hop Hemant') })
    rider.send({ t: 'move', x: STAND.x + 2, z: STAND.z, ry: 0 })
    rider.send({ t: 'ride', to: 'hawa-mahal', x: STAND.x + 2, z: STAND.z })
    rider.send({ t: 'move', x: HAWA.x + 20, z: HAWA.z, ry: 0 })
    expect(await rider.next('error')).toEqual({
      t: 'error',
      code: 'too-fast',
      x: HAWA.x,
      z: HAWA.z,
      ry: HAWA.ry,
    })
  })

  /** A resident who stood at `at`, asks for `ride`, then steps out at Hawa Mahal: the errors heard. */
  async function refused(name: string, at: { x: number; z: number } | null, ride: object) {
    const rider = await live('walled-city', { token: await resident(name) })
    await rider.next('welcome')
    if (at) rider.send({ t: 'move', x: at.x, z: at.z, ry: 0 })
    rider.raw(JSON.stringify({ t: 'ride', ...ride }))
    rider.send({ t: 'move', x: HAWA.x + 1, z: HAWA.z, ry: 0 })
    await rider.sync()
    return rider.all('error').map((e) => e.code)
  }

  it('is refused, and the rider stays put, far from every stand or for anything but a landmark here', async () => {
    const atStand = { x: STAND.x + 2, z: STAND.z }
    // the step out at Hawa Mahal is then a jump, refused as one (the first move of a socket goes anywhere)
    expect(await refused('No Move Naina', null, { to: 'hawa-mahal', ...atStand })).toEqual(['no-ride'])
    expect(await refused('Far Farida', { x: 10, z: 10 }, { to: 'hawa-mahal', x: 10, z: 10 })).toEqual([
      'no-ride',
      'too-fast',
    ])
    // another district's landmark, an inherited name, a made-up one
    for (const [name, to] of [
      ['Other Ojas', 'albert-hall'],
      ['Proto Prem', '__proto__'],
      ['Proto Puja', 'toString'],
      ['Made Manu', 'amber-fort'],
    ] as const)
      expect(await refused(name, atStand, { to, ...atStand }), to).toEqual(['no-ride', 'too-fast'])
  })

  it('is refused when the place it claims to start from is not a walk on from the last accepted point', async () => {
    // stood 40 m from the stand, then says it is at the stand
    expect(
      await refused(
        'Liar Lalit',
        { x: STAND.x + 40, z: STAND.z },
        { to: 'hawa-mahal', x: STAND.x + 1, z: STAND.z },
      ),
    ).toEqual(['no-ride', 'too-fast'])
    // just out of the stand's reach
    expect(
      await refused(
        'Edge Esha',
        { x: STAND.x + TAXI_RANGE_M + 0.2, z: STAND.z },
        { to: 'hawa-mahal', x: STAND.x + TAXI_RANGE_M + 0.2, z: STAND.z },
      ),
    ).toEqual(['no-ride', 'too-fast'])
  })

  it('is refused from a bench', async () => {
    // the tapri by Johari Bazaar, 6.7 m from the stand: sit there, then claim a point by the auto
    const tapri = BENCH_POSITIONS['walled-city'][4]!
    expect(tapri).toEqual({ x: -5.6, z: 36 })
    const rider = await live('walled-city', { token: await resident('Seated Sunny') })
    rider.send({ t: 'move', x: -4, z: 34, ry: 0 })
    rider.send({ t: 'sit', bench: 'walled-city:4' })
    await rider.next('seated', (m) => m.bench === 'walled-city:4')
    rider.send({ t: 'ride', to: 'hawa-mahal', x: STAND.x + 1, z: STAND.z + 0.5 })
    expect(await rider.next('error')).toEqual({ t: 'error', code: 'no-ride' })
  })

  it('a ride frame without a landmark name or a point is a bad frame', async () => {
    const rider = await live('walled-city', { token: await resident('Bad Bhanu') })
    await rider.next('welcome')
    rider.raw(JSON.stringify({ t: 'ride', x: 0, z: 0 }))
    rider.raw(JSON.stringify({ t: 'ride', to: 7, x: 0, z: 0 }))
    rider.raw(JSON.stringify({ t: 'ride', to: 'x'.repeat(65), x: 0, z: 0 }))
    rider.raw(JSON.stringify({ t: 'ride', to: 'hawa-mahal', z: 0 }))
    await rider.sync()
    expect(rider.all('error')).toEqual(Array(4).fill({ t: 'error', code: 'invalid' }))
  })
})
