import type { FestivalId } from '../net/protocol'
import { ambientOn, sharedAudio } from './horn'

/** What this file needs of WebAudio, so a test can stand in for it. */
interface Param {
  value: number
  setValueAtTime(v: number, t: number): void
  linearRampToValueAtTime(v: number, t: number): void
  exponentialRampToValueAtTime(v: number, t: number): void
  setTargetAtTime(v: number, t: number, tc: number): void
}
interface AudioNode {
  connect(n: unknown): void
  disconnect(): void
}
interface Source extends AudioNode {
  start(t: number): void
  stop(t: number): void
}
type Gain = AudioNode & { gain: Param }
export interface AmbientCtx {
  currentTime: number
  sampleRate: number
  state: string
  destination: unknown
  resume(): Promise<void>
  suspend(): Promise<void>
  createOscillator(): Source & { type: string; frequency: Param }
  createGain(): Gain
  createBiquadFilter(): AudioNode & { type: string; frequency: Param; Q: Param }
  createBuffer(channels: number, length: number, rate: number): { getChannelData(c: number): Float32Array }
  createBufferSource(): Source & { buffer: unknown; loop: boolean }
}

/** The sky the ambience reads (a subset of `SkyParams`). */
export interface AmbientSky {
  sunElevationDeg: number
  /** Compass bearing: below 180 the sun is in the east, so it is morning. */
  sunAzimuthDeg: number
}

export type Phase = 'day' | 'dawn' | 'dusk' | 'night'
export interface Mix {
  murmur: number
  birds: number
  crickets: number
  bells: number
  drums: number
}
type Layer = keyof Mix

/**
 * Each district's bed: how busy its bazaar murmur is, and how much green there is for birds and crickets.
 * A district not listed (Amer, say) has no murmur and is fairly green: add one line here to tune it.
 */
const BED: Record<string, { murmur: number; nature: number }> = {
  'walled-city': { murmur: 1, nature: 0.4 },
  'mi-road': { murmur: 0.8, nature: 0.5 },
  university: { murmur: 0, nature: 1 },
  'malviya-nagar': { murmur: 0, nature: 0.9 },
}
const DEFAULT_BED = { murmur: 0, nature: 0.8 }

/** The sun's height (degrees) above which it is day, and below which it is night; between is twilight. */
const DAY_DEG = 12
const NIGHT_DEG = -4

export function phaseOf(sky: AmbientSky): Phase {
  const e = sky.sunElevationDeg
  if (e >= DAY_DEG) return 'day'
  if (e <= NIGHT_DEG) return 'night'
  return sky.sunAzimuthDeg < 180 ? 'dawn' : 'dusk'
}

/** What plays now: pure, from the district, the sky and the festival. Every level is 0 to 1. */
export function mixFor(district: string, sky: AmbientSky, festival: FestivalId | null): Mix {
  const bed = BED[district] ?? DEFAULT_BED
  const phase = phaseOf(sky)
  return {
    murmur: phase === 'night' ? bed.murmur * 0.5 : bed.murmur,
    birds: phase === 'day' || phase === 'dawn' ? bed.nature : 0,
    crickets: phase === 'night' || phase === 'dusk' ? bed.nature : 0,
    bells: phase === 'dawn' || phase === 'dusk' ? 1 : 0,
    drums: festival ? 1 : 0,
  }
}

/** Each layer's loudest, so the whole stays a soft bed under the street. */
const CAP: Mix = { murmur: 0.07, birds: 0.05, crickets: 0.012, bells: 0.06, drums: 0.09 }
const MASTER = 0.6
/** How often the mix is re-read and the next sounds scheduled. */
const TICK_MS = 400
/** Levels glide with this time constant, in seconds. */
const GLIDE_S = 1.5
const LAYERS: Layer[] = ['murmur', 'birds', 'crickets', 'bells', 'drums']

export interface AmbienceDeps {
  district: string
  sky(): AmbientSky
  festival(): FestivalId | null
  /** Whether the visitor has the ambience on. */
  enabled?(): boolean
  /** The audio context, asked for only from inside a gesture. */
  context?(): AmbientCtx | null
  /** Where gestures and visibility changes are heard. */
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
  random?(): number
}

/** The district's ambience: silent until a tap or key press, paused with the tab, gone on dispose. */
export function createAmbience(deps: AmbienceDeps) {
  const enabled = deps.enabled ?? ambientOn
  const getCtx = deps.context ?? (() => sharedAudio() as AmbientCtx | null)
  const doc = deps.doc ?? document
  const random = deps.random ?? Math.random

  let ctx: AmbientCtx | null = null
  let master: Gain | null = null
  const levels = {} as Record<Layer, Gain>
  const sources: Source[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  const next = { birds: 0, bells: 0, drums: 0 }
  let disposed = false
  let paused = false

  const hidden = () => doc.visibilityState === 'hidden'

  function gain(to: unknown, v: number) {
    const g = ctx!.createGain()
    g.gain.value = v
    g.connect(to)
    return g
  }
  function osc(type: string, hz: number, to: unknown) {
    const o = ctx!.createOscillator()
    o.type = type
    o.frequency.value = hz
    o.connect(to)
    o.start(ctx!.currentTime)
    sources.push(o)
  }

  /** Builds the graph once: a murmur of filtered noise and a cricket trill run all the time, at level 0. */
  function build() {
    const c = ctx!
    master = c.createGain()
    master.gain.value = MASTER
    master.connect(c.destination)
    for (const k of LAYERS) levels[k] = gain(master, 0)

    // murmur: two seconds of noise, looped, band-passed to a crowd's voice range, swelling slowly
    const noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1
    const src = c.createBufferSource()
    src.buffer = noise
    src.loop = true
    const band = c.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 500
    band.Q.value = 0.6
    const swell = gain(levels.murmur, 0.7)
    src.connect(band)
    band.connect(swell)
    src.start(c.currentTime)
    sources.push(src)
    osc('sine', 0.25, gain(swell.gain, 0.3))

    // crickets: a high tone chopped by a ~9 Hz wobble
    const chop = gain(levels.crickets, 0.5)
    osc('sine', 4300, chop)
    osc('sine', 9, gain(chop.gain, 0.5))
  }

  /** A short enveloped tone into a layer's bus. */
  function blip(layer: Layer, hz: number, at: number, peak: number, len: number, hzEnd = hz) {
    const c = ctx!
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(peak, at + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, at + len)
    g.connect(levels[layer])
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(hz, at)
    if (hzEnd !== hz) o.frequency.exponentialRampToValueAtTime(hzEnd, at + len)
    o.connect(g)
    o.start(at)
    o.stop(at + len + 0.05)
  }

  function tick() {
    if (!ctx || !master || disposed || paused) return
    const t = ctx.currentTime
    const on = enabled()
    const mix = mixFor(deps.district, deps.sky(), deps.festival())
    for (const k of LAYERS) levels[k].gain.setTargetAtTime(on ? mix[k] * CAP[k] : 0, t, GLIDE_S)
    if (!on) return
    if (mix.birds > 0 && t >= next.birds) {
      // a two-note whistle
      const hz = 2400 + random() * 1400
      blip('birds', hz, t, 0.9, 0.12, hz * 1.3)
      blip('birds', hz * 1.2, t + 0.16, 0.9, 0.1, hz * 0.9)
      next.birds = t + 1.5 + random() * 4
    }
    if (mix.bells > 0 && t >= next.bells) {
      // a temple bell: a fundamental and an inharmonic partner, ringing out
      blip('bells', 660, t, 0.8, 2.2)
      blip('bells', 1782, t, 0.3, 1.4)
      next.bells = t + 6 + random() * 4
    }
    if (mix.drums > 0 && t >= next.drums) {
      // a dhol's tum-tum-ta-tum: a falling thump on each beat
      for (const beat of [0, 0.5, 0.75, 1, 1.5]) blip('drums', 130, t + beat, 1, 0.28, 55)
      next.drums = t + 2.2
    }
  }

  /** From a tap or key press: makes (or wakes) the context and starts the graph, if sound is wanted. */
  function gesture() {
    if (disposed || ctx || !enabled() || hidden()) return
    const c = getCtx()
    if (!c) return
    ctx = c
    if (c.state !== 'running') void c.resume().catch(() => {})
    build()
    tick()
    timer = setInterval(tick, TICK_MS)
  }

  function visibility() {
    if (!ctx || disposed) return
    if (hidden()) {
      paused = true
      void ctx.suspend().catch(() => {})
    } else {
      paused = false
      void ctx.resume().catch(() => {})
      tick()
    }
  }

  const gestures = ['pointerdown', 'keydown'] as const
  for (const e of gestures) doc.addEventListener(e, gesture, true)
  doc.addEventListener('visibilitychange', visibility)

  return {
    dispose() {
      if (disposed) return
      disposed = true
      for (const e of gestures) doc.removeEventListener(e, gesture, true)
      doc.removeEventListener('visibilitychange', visibility)
      if (timer) clearInterval(timer)
      timer = null
      for (const s of sources) {
        try {
          s.stop(ctx!.currentTime)
        } catch {
          // already stopped
        }
        s.disconnect()
      }
      sources.length = 0
      // silences any bell or drum still scheduled
      master?.disconnect()
      master = null
      ctx = null
    },
  }
}
