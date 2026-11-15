import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { storage } from '../storage'
import {
  chime,
  closeAudio,
  woKaata,
  HONK_GAP_MS,
  honk,
  resetHorn,
  setSoundOn,
  soundOn,
  unlockAudio,
} from './horn'

let made = 0
let oscillators = 0
const notes: { type: string; frequency: { value: number } }[] = []
const contexts: FakeAudio[] = []
class FakeAudio {
  currentTime = 0
  state = 'suspended'
  destination = {}
  constructor() {
    made++
    contexts.push(this)
  }
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {})
  createOscillator = () => {
    oscillators++
    const o = { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }
    notes.push(o)
    return o
  }
  createGain = () => ({
    gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() {},
  })
}

beforeEach(() => {
  made = 0
  oscillators = 0
  notes.length = 0
  contexts.length = 0
  storage.clear()
  resetHorn()
  vi.stubGlobal('AudioContext', FakeAudio)
})
afterEach(() => vi.unstubAllGlobals())

it('makes no audio context until the first honk', () => {
  expect(soundOn()).toBe(true)
  expect(made).toBe(0)
  expect(honk(1000)).toBe(true)
  expect(made).toBe(1)
  expect(oscillators).toBe(2)
  honk(2000)
  expect(made).toBe(1) // one context for the page
})

it('honks at most once every half second', () => {
  expect(honk(1000)).toBe(true)
  expect(honk(1000 + HONK_GAP_MS - 1)).toBe(false)
  expect(honk(1000 + HONK_GAP_MS)).toBe(true)
  expect(oscillators).toBe(4)
})

it('is silent when sound is off, and remembers the choice under gg-sound', () => {
  setSoundOn(false)
  expect(storage.get('gg-sound')).toBe('off')
  expect(honk(1000)).toBe(false)
  unlockAudio()
  expect(made).toBe(0) // not even a context
  resetHorn()
  expect(soundOn()).toBe(false) // read back from storage
  setSoundOn(true)
  expect(honk(5000)).toBe(true)
  expect(storage.get('gg-sound')).toBe('on')
})

it('unlock wakes a suspended context from a gesture, and close lets it go', () => {
  unlockAudio()
  expect(made).toBe(1)
  expect(contexts[0]!.resume).toHaveBeenCalledOnce()
  closeAudio()
  honk(1000)
  expect(made).toBe(2)
})

it('survives a browser with no WebAudio', () => {
  vi.stubGlobal('AudioContext', undefined)
  expect(honk(1000)).toBe(false)
})

it("wakes a context Safari left 'interrupted', on unlock and on a honk", () => {
  unlockAudio()
  const c = contexts[0]!
  c.state = 'interrupted'
  unlockAudio()
  expect(c.resume).toHaveBeenCalledTimes(2)
  c.state = 'interrupted'
  honk(1000)
  expect(c.resume).toHaveBeenCalledTimes(3)
  c.state = 'running'
  honk(2000)
  expect(c.resume).toHaveBeenCalledTimes(3) // running: left alone
})

it('a chime never makes an audio context, and only sounds with sound on and a running one', () => {
  expect(chime()).toBe(false)
  expect(made).toBe(0)
  honk(1000) // a honk makes the context, and resumes it
  const before = oscillators
  expect(made).toBe(1)
  expect(chime()).toBe(true)
  expect(oscillators).toBeGreaterThan(before)
  expect(made).toBe(1)
  setSoundOn(false)
  expect(chime()).toBe(false)
})

it('a bus pulls in with its own two short notes, not the metro chime', () => {
  honk(1000)
  notes.length = 0
  expect(chime()).toBe(true)
  const metro = notes.map((o) => `${o.type} ${o.frequency.value}`)
  notes.length = 0
  expect(chime('bus')).toBe(true)
  const bus = notes.map((o) => `${o.type} ${o.frequency.value}`)
  expect(bus).toHaveLength(2)
  expect(bus).not.toEqual(metro)
  setSoundOn(false)
  expect(chime('bus')).toBe(false)
})

it('a wo-kaata chirp sounds only with sound on and a running context, and never makes one', () => {
  expect(woKaata()).toBe(false)
  expect(made).toBe(0)
  unlockAudio() // the pull button's tap
  expect(made).toBe(1)
  const before = oscillators
  expect(woKaata()).toBe(true)
  expect(oscillators).toBe(before + 1)
  setSoundOn(false)
  expect(woKaata()).toBe(false)
})
