import type { AmbientCtx } from './ambience'
import { sharedAudio, soundOn } from './horn'

/*
 * The sounds of things touched on the street (see world/touchables.ts): a temple bell, a hand pump, pigeons
 * going up, a diya being lit, a cat's purr. Each is a second or two of oscillators and filtered noise in the
 * page's one audio context (the ambience's; no audio files), heard only here. They follow the sound switch,
 * and a hidden tab plays nothing (the ambience has the context suspended there anyway).
 */

export type TouchSound = 'bell' | 'pump' | 'pigeons' | 'diya' | 'purr'

export interface TouchSoundDeps {
  enabled?(): boolean
  context?(): AmbientCtx | null
  hidden?(): boolean
  random?(): number
}

type Noise = ReturnType<AmbientCtx['createBuffer']>
/** One second of white noise per context, made the first time a sound needs it. */
const noises = new WeakMap<object, Noise>()

function noiseOf(c: AmbientCtx, random: () => number): Noise {
  let n = noises.get(c)
  if (!n) {
    n = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const data = n.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1
    noises.set(c, n)
  }
  return n
}

/** A tone with a soft attack that rings out over `len` seconds. */
function tone(c: AmbientCtx, type: string, hz: number, at: number, peak: number, len: number, hzEnd = hz) {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.linearRampToValueAtTime(peak, at + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, at + len)
  g.connect(c.destination)
  const o = c.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(hz, at)
  if (hzEnd !== hz) o.frequency.exponentialRampToValueAtTime(hzEnd, at + len)
  o.connect(g)
  o.start(at)
  o.stop(at + len + 0.05)
}

/** The noise through a band-pass, from `at` for `len` seconds; returns its gain for the caller's envelope. */
function hiss(c: AmbientCtx, random: () => number, hz: number, q: number, at: number, len: number) {
  const src = c.createBufferSource()
  src.buffer = noiseOf(c, random)
  src.loop = true
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = hz
  band.Q.value = q
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  src.connect(band)
  band.connect(g)
  g.connect(c.destination)
  src.start(at)
  src.stop(at + len + 0.05)
  return g.gain
}

const SOUNDS: Record<TouchSound, (c: AmbientCtx, t: number, random: () => number) => void> = {
  // one soft ring: a fundamental, its hum below and an inharmonic partial above, dying away
  bell(c, t) {
    tone(c, 'sine', 587, t, 0.07, 2.6)
    tone(c, 'sine', 293.5, t, 0.02, 2.2)
    tone(c, 'sine', 1585, t, 0.022, 1.1)
  },
  // three strokes of the handle, each a squeak down and up, and the water coming after the first
  pump(c, t, random) {
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.7
      tone(c, 'triangle', 560, at, 0.022, 0.22, 380)
      tone(c, 'triangle', 380, at + 0.34, 0.018, 0.2, 520)
    }
    const water = hiss(c, random, 1900, 0.7, t + 0.35, 2.3)
    water.linearRampToValueAtTime(0.035, t + 0.6)
    water.setValueAtTime(0.035, t + 2.1)
    water.exponentialRampToValueAtTime(0.0001, t + 2.65)
  },
  // a clatter of wings: short puffs of noise, quickening and fading
  pigeons(c, t, random) {
    const wings = hiss(c, random, 1300, 0.9, t, 1.5)
    for (let i = 0; i < 12; i++) {
      const at = t + i * 0.085
      wings.setValueAtTime(0.0001, at)
      wings.linearRampToValueAtTime(0.05 * (1 - i / 14), at + 0.02)
      wings.exponentialRampToValueAtTime(0.0001, at + 0.075)
    }
  },
  // a match struck, and a small bright note as the wick takes
  diya(c, t, random) {
    const strike = hiss(c, random, 3200, 1.2, t, 0.25)
    strike.linearRampToValueAtTime(0.03, t + 0.02)
    strike.exponentialRampToValueAtTime(0.0001, t + 0.2)
    tone(c, 'sine', 1320, t + 0.12, 0.018, 0.6)
  },
  // a low rumble that wavers, twice (in and out)
  purr(c, t) {
    tone(c, 'sawtooth', 46, t, 0.03, 0.55, 40)
    tone(c, 'sawtooth', 50, t + 0.6, 0.03, 0.6, 42)
  },
}

/**
 * Plays `kind` now. Only with sound on, in a visible tab, and with an audio context to play in (a touch
 * follows a tap or key press, so the browser lets one be made). Returns whether it sounded.
 */
export function playTouch(kind: TouchSound, deps: TouchSoundDeps = {}): boolean {
  const enabled = deps.enabled ?? soundOn
  const hidden =
    deps.hidden ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden')
  if (!enabled() || hidden()) return false
  const c = (deps.context ?? (() => sharedAudio() as AmbientCtx | null))()
  if (!c) return false
  if (c.state !== 'running') {
    void c.resume().catch(() => {})
    // the pigeons go up from a walk, not a tap: a context that is not running yet (iOS, before its first
    // counted gesture) would play their clatter late, whenever it woke. Better silent.
    if (kind === 'pigeons') return false
  }
  SOUNDS[kind](c, c.currentTime, deps.random ?? Math.random)
  return true
}
