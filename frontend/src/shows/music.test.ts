import { describe, expect, it, vi } from 'vitest'
import type { AmbientCtx } from '../audio/ambience'
import { SHOW_KINDS, SHOW_S } from '../world/shows'
import { createShowMusic, scoreOf, TUNES } from './music'

/** A stand-in audio context that counts what is made and remembers the gains set. */
function fakeCtx(state = 'running') {
  const made = { oscillators: 0, buffers: 0, bufferSources: 0, filters: 0, resumed: 0, disconnected: 0 }
  const targets: number[] = []
  const starts: number[] = []
  /** When each oscillator was told to stop, in the order told. */
  const stops: number[] = []
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime(v: number) {
      targets.push(v)
    },
  })
  const node = () => ({ connect() {}, disconnect: () => void made.disconnected++ })
  const ctx = {
    currentTime: 100,
    sampleRate: 8000,
    state,
    destination: {},
    resume: async () => void made.resumed++,
    suspend: async () => {},
    createOscillator: () => {
      made.oscillators++
      return {
        ...node(),
        type: '',
        frequency: param(),
        start: (t: number) => void starts.push(t),
        stop: (t: number) => void stops.push(t),
      }
    },
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => {
      made.filters++
      return { ...node(), type: '', frequency: param(), Q: param() }
    },
    createBuffer: (_c: number, length: number) => {
      made.buffers++
      const data = new Float32Array(length)
      return { getChannelData: () => data }
    },
    createBufferSource: () => {
      made.bufferSources++
      return { ...node(), buffer: null as unknown, loop: false, start() {}, stop() {} }
    },
  }
  return { ctx: ctx as unknown as AmbientCtx, made, targets, starts, stops }
}

/** A stand-in document whose visibility a test sets. */
function fakeDoc() {
  const heard = new Set<() => void>()
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_type: string, fn: () => void) => void heard.add(fn),
    removeEventListener: (_type: string, fn: () => void) => void heard.delete(fn),
    set(state: DocumentVisibilityState) {
      doc.visibilityState = state
      for (const fn of [...heard]) fn()
    },
    listeners: () => heard.size,
  }
  return doc as typeof doc & Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
}

describe('the tunes as written', () => {
  it.each(SHOW_KINDS)(
    '%s: whole bars, a handful of pitches, and long enough to fill its show once round or twice',
    (kind) => {
      const tune = TUNES[kind]
      const { notes, beats } = scoreOf(tune)
      // every phrase closes on a bar line
      expect(beats % (tune.drum?.bar ?? 4)).toBe(0)
      expect(notes.length).toBeGreaterThan(20)
      // a five- or seven-note scale and its octave: nothing chromatic
      const pitches = new Set(notes.map(([, semitone]) => ((semitone % 12) + 12) % 12))
      expect(pitches.size).toBeLessThanOrEqual(7)
      expect(pitches.has(0)).toBe(true)
      for (const [at, , len] of notes) {
        expect(at).toBeGreaterThanOrEqual(0)
        expect(len).toBeGreaterThan(0)
      }
      // the round comes back at most twice in a show: it never sounds like a stuck loop
      expect((beats * tune.beat * 2) / SHOW_S[kind]).toBeGreaterThan(0.9)
    },
  )
})

describe('the tunes as played', () => {
  it('schedules a little ahead, on oscillators only, and louder the nearer the player is', () => {
    const { ctx, made, targets, starts } = fakeCtx()
    const music = createShowMusic({ context: () => ctx, enabled: () => true })
    music.start('kathputli')
    expect(made.oscillators).toBe(0)
    expect(music.update(0, 1)).toBe(true)
    const first = made.oscillators
    expect(first).toBeGreaterThan(0)
    // nothing further ahead than a quarter of a second
    expect(Math.max(...starts)).toBeLessThanOrEqual(100.25)
    expect(music.update(0.01, 1)).toBe(true)
    expect(made.oscillators).toBe(first) // the same notes are not scheduled twice
    for (let t = 0.02; t < 5; t += 1 / 30) music.update(t, 1)
    expect(made.oscillators).toBeGreaterThan(first + 10)
    expect(made.bufferSources).toBe(0) // no samples: the only buffer is the clap's noise
    // the bus follows the distance, and only when it changes
    const loud = targets.at(-1)!
    const sets = targets.length
    music.update(5, 1)
    expect(targets.length).toBe(sets)
    music.update(5.03, 0.4)
    expect(targets.at(-1)!).toBeLessThan(loud)
    expect(targets.at(-1)!).toBeGreaterThan(0)
  })

  it('too far to hear: keeps its place in the tune and makes nothing', () => {
    const { ctx, made } = fakeCtx()
    const music = createShowMusic({ context: () => ctx, enabled: () => true })
    music.start('dancers')
    for (let t = 0; t < 3; t += 1 / 30) expect(music.update(t, 0)).toBe(false)
    expect(made.oscillators).toBe(0)
    // back in earshot: it goes on from here, not from the notes missed
    music.update(3.02, 1)
    expect(made.oscillators).toBeLessThan(8)
  })

  it('follows the sound switch: off, nothing is made, and what was playing dies away', () => {
    let on = false
    const { ctx, made, targets } = fakeCtx()
    const music = createShowMusic({ context: () => ctx, enabled: () => on })
    music.start('ravanhatta')
    expect(music.update(0, 1)).toBe(false)
    expect(made.oscillators).toBe(0)
    music.clap()
    expect(made.bufferSources).toBe(0)
    on = true
    expect(music.update(0.1, 1)).toBe(true)
    expect(made.oscillators).toBeGreaterThan(0)
    const playing = made.oscillators
    on = false
    expect(music.update(0.2, 1)).toBe(false)
    expect(made.oscillators).toBe(playing)
    expect(targets.at(-1)).toBe(0)
  })

  it('a context that is not running is woken, and nothing is piled up on it meanwhile', () => {
    const { ctx, made } = fakeCtx('suspended')
    const music = createShowMusic({ context: () => ctx, enabled: () => true })
    music.start('kathputli')
    expect(music.update(0, 1)).toBe(false)
    expect(made.resumed).toBe(1)
    expect(made.oscillators).toBe(0)
  })

  it('the bowed and the reed voices each make one filter for the whole tune', () => {
    for (const kind of ['ravanhatta', 'dancers'] as const) {
      const { ctx, made } = fakeCtx()
      const music = createShowMusic({ context: () => ctx, enabled: () => true })
      music.start(kind)
      for (let t = 0; t < 10; t += 1 / 30) music.update(t, 1)
      expect(made.filters).toBe(1)
    }
  })

  it('wakes a sleeping context once a tune, not once a frame; a clap (a tap) may always ask', () => {
    const { ctx, made } = fakeCtx('suspended')
    const music = createShowMusic({ context: () => ctx, enabled: () => true })
    music.start('kathputli')
    for (let t = 0; t < 2; t += 1 / 30) expect(music.update(t, 1)).toBe(false)
    expect(made.resumed).toBe(1)
    music.clap()
    expect(made.resumed).toBe(2)
    // the next tune asks again, once
    music.start('ravanhatta')
    for (let t = 0; t < 1; t += 1 / 30) music.update(t, 1)
    expect(made.resumed).toBe(3)
  })

  it('a hidden tab: the bus is shut and the drone stopped at once, the caller told; back in view the tune goes on', () => {
    const { ctx, made, targets, stops } = fakeCtx()
    const doc = fakeDoc()
    const onHush = vi.fn()
    const music = createShowMusic({ context: () => ctx, enabled: () => true, doc, onHush })
    music.start('ravanhatta')
    for (let t = 0; t < 2; t += 1 / 30) expect(music.update(t, 1)).toBe(true)
    expect(targets.at(-1)).toBeGreaterThan(0)
    const droneStops = stops.length

    doc.set('hidden')
    expect(onHush).toHaveBeenCalledOnce()
    expect(targets.at(-1)).toBe(0)
    // both of the drone's oscillators, within a tenth of a second
    const cut = stops.slice(droneStops)
    expect(cut).toHaveLength(2)
    for (const at of cut) expect(at).toBeLessThanOrEqual(100.1)
    // nothing is scheduled while hidden, whoever calls
    const before = made.oscillators
    expect(music.update(2.1, 1)).toBe(false)
    music.clap()
    expect(made.oscillators).toBe(before)
    expect(made.bufferSources).toBe(0)

    doc.set('visible')
    expect(onHush).toHaveBeenCalledOnce()
    expect(music.update(2.2, 1)).toBe(true)
    expect(targets.at(-1)).toBeGreaterThan(0)
    expect(made.oscillators).toBeGreaterThan(before) // the drone again, and the notes from here

    // a show that had already ended stays silent on coming back
    music.stop()
    doc.set('hidden')
    doc.set('visible')
    const ended = made.oscillators
    expect(music.update(3, 1)).toBe(false)
    expect(made.oscillators).toBe(ended)
    music.dispose()
    expect(doc.listeners()).toBe(0)
  })

  it('a clap is five short bursts of noise; stopping fades the bus, disposing cuts it', () => {
    const { ctx, made, targets } = fakeCtx()
    const music = createShowMusic({ context: () => ctx, enabled: () => true, random: () => 0.5 })
    music.start('ravanhatta')
    music.update(0, 1)
    music.clap()
    expect(made.bufferSources).toBe(5)
    expect(made.buffers).toBe(1)
    music.clap()
    expect(made.buffers).toBe(1) // the noise is made once
    music.stop()
    expect(targets.at(-1)).toBe(0)
    const before = made.oscillators
    expect(music.update(1, 1)).toBe(false) // stopped: nothing more is scheduled
    expect(made.oscillators).toBe(before)
    music.dispose()
    expect(made.disconnected).toBeGreaterThan(0)
  })
})
