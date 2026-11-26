import { afterEach, beforeEach, expect, it } from 'vitest'
import { storage } from '../storage'
import { cricketPlayed } from './cricketPitch'
import { onDeed } from './deeds'
import { emoted } from './emoting'
import { listenForFun } from './funDeeds'
import { showWatched } from './shows'
import { tasted } from './swaad'
import { meets, goalById, type Deed } from './today'
import { touched } from './touched'

let deeds: Deed[] = []
let stops: (() => void)[] = []
beforeEach(() => {
  deeds = []
  stops = [onDeed((d) => deeds.push(d)), listenForFun()]
})
afterEach(() => {
  for (const stop of stops) stop()
  storage.clear()
})

it('an innings played out is a cricket deed, whatever the score', () => {
  cricketPlayed(0)
  cricketPlayed(23)
  expect(deeds).toEqual([{ kind: 'cricket' }, { kind: 'cricket' }])
})

it('a bell, a pump, a diya, a roti for the cow or a pat is a touch deed; pigeons flying up are not', () => {
  for (const kind of ['bell', 'pump', 'diyas', 'feed', 'pet'] as const) touched(kind)
  expect(deeds).toEqual(Array(5).fill({ kind: 'touch' }))
  touched('pigeons')
  expect(deeds).toHaveLength(5)
})

it('any dish tasted is a swaad deed, the first time or again', () => {
  tasted('chai')
  tasted('chai')
  tasted('ghewar')
  expect(deeds).toEqual(Array(3).fill({ kind: 'swaad' }))
})

it('any show watched to its end is a show deed', () => {
  showWatched('kathputli')
  showWatched('ravanhatta')
  showWatched('dancers')
  expect(deeds).toEqual(Array(3).fill({ kind: 'show' }))
})

it('any emote played is an emote deed', () => {
  emoted('wave')
  emoted('sit')
  expect(deeds).toEqual([{ kind: 'emote' }, { kind: 'emote' }])
})

it("each does its own day's goal and no other; once stopped, nothing more is heard", () => {
  cricketPlayed(4)
  touched('bell')
  tasted('kulfi')
  showWatched('kathputli')
  emoted('dance')
  const kinds = ['cricket', 'touch', 'swaad', 'show', 'emote']
  expect(deeds.map((d) => d.kind)).toEqual(kinds)
  for (const kind of kinds)
    expect(deeds.filter((d) => meets(goalById(kind)!, d)).map((d) => d.kind)).toEqual([kind])
  stops.pop()!()
  cricketPlayed(4)
  touched('bell')
  tasted('kulfi')
  showWatched('kathputli')
  emoted('dance')
  expect(deeds).toHaveLength(5)
})
