import { afterEach, expect, it, vi } from 'vitest'
import { resetHorn, setSoundOn } from '../audio/horn'
import { cricketSound, resetCricketSound, soundFor, wakeCricketSound } from './cricketSound'

afterEach(() => {
  resetCricketSound()
  resetHorn()
  vi.unstubAllGlobals()
})

it('a dot ball met no bat and makes no sound; runs are the bat, a wicket the bricks, the window glass', () => {
  expect(soundFor('dot', false)).toBeNull()
  expect(soundFor('one', false)).toBe('bat')
  expect(soundFor('two', false)).toBe('bat')
  expect(soundFor('four', false)).toBe('big')
  expect(soundFor('six', false)).toBe('big')
  expect(soundFor('six', true)).toBe('glass')
  expect(soundFor('bowled', false)).toBe('out')
  expect(soundFor('caught', false)).toBe('out')
})

/** A stand-in audio context that counts the notes started on it. */
function fakeAudio() {
  const started: number[] = []
  class Ctx {
    currentTime = 0
    state = 'running'
    destination = {}
    resume = () => Promise.resolve()
    close = () => Promise.resolve()
    createOscillator() {
      const o = {
        type: '',
        frequency: { value: 0 },
        connect() {},
        start: () => void started.push(o.frequency.value),
        stop() {},
      }
      return o
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      }
    }
  }
  vi.stubGlobal('AudioContext', Ctx)
  return started
}

it("is silent before the first tap and with sound off, and plays through the page's switch after", () => {
  const started = fakeAudio()
  expect(cricketSound('bat')).toBe(false) // no tap yet: no context is made, nothing plays
  wakeCricketSound()
  expect(cricketSound('bat')).toBe(true)
  expect(started).toHaveLength(1)
  expect(cricketSound('glass')).toBe(true)
  expect(started).toHaveLength(5)
  setSoundOn(false)
  expect(cricketSound('big')).toBe(false)
  expect(started).toHaveLength(5)
  setSoundOn(true)
})
