import { istClock } from '../live/winter'
import type { FestivalId } from '../net/protocol'
import { sharedAudio, soundOn } from './horn'

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

export type Tier = 0 | 1 | 2
export type Phase = 'day' | 'dawn' | 'dusk' | 'night'
export interface Mix {
  murmur: number
  birds: number
  crickets: number
  bells: number
  drums: number
  /** Wind over a ridge (Nahargarh): low, gusting noise. */
  wind: number
  /** Sankranti by day: now and then a far-off cheer from the roofs, as a kite is cut somewhere. */
  cheers: number
}
type Layer = keyof Mix

/**
 * Each district's bed: how busy its bazaar murmur is, how much green there is for birds and crickets, and how
 * windy it is (only up on a ridge). A district not listed has no murmur, no wind and is fairly green: add one
 * line here to tune it.
 */
const BED: Record<string, { murmur: number; nature: number; wind?: number }> = {
  'walled-city': { murmur: 1, nature: 0.4 },
  'mi-road': { murmur: 0.8, nature: 0.5 },
  university: { murmur: 0, nature: 1 },
  'malviya-nagar': { murmur: 0, nature: 0.9 },
  amer: { murmur: 0.5, nature: 0.7 }, // the stalls on the path up, under the hill
  nahargarh: { murmur: 0.3, nature: 0.85, wind: 1 }, // wind on the ridge, the birds, the city's far hum below
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

/** New Year's drums stop at this minute of the night (IST); its string lights stay up until 06:00. */
const NEW_YEAR_DRUMS_UNTIL = 60

/** Whether the festival's drums play at `now`: every festival's do, New Year's only until about 01:00 IST. */
export function festivalDrums(festival: FestivalId | null, now: Date): boolean {
  if (!festival) return false
  if (festival !== 'newyear') return true
  const { minutes } = istClock(now)
  return minutes < NEW_YEAR_DRUMS_UNTIL || minutes >= 12 * 60 // the evening, and midnight's first hour
}

/** What plays now: pure, from the district, the sky, the festival and the clock. Every level is 0 to 1. */
export function mixFor(
  district: string,
  sky: AmbientSky,
  festival: FestivalId | null,
  now: Date = new Date(),
): Mix {
  const bed = BED[district] ?? DEFAULT_BED
  const phase = phaseOf(sky)
  return {
    murmur: phase === 'night' ? bed.murmur * 0.5 : bed.murmur,
    birds: phase === 'day' || phase === 'dawn' ? bed.nature : 0,
    crickets: phase === 'night' || phase === 'dusk' ? bed.nature : 0,
    bells: phase === 'dawn' || phase === 'dusk' ? 1 : 0,
    drums: festivalDrums(festival, now) ? 1 : 0,
    wind: bed.wind ?? 0,
    // the kites are up from sunrise to sunset (see kites.ts), and so are the roofs' cheers
    cheers: festival === 'sankranti' && sky.sunElevationDeg >= 0 ? 1 : 0,
  }
}

/** The lowest quality tier's mix: one steady layer (the bazaar, else the crickets) and no blips. */
export function thinMix(m: Mix): Mix {
  return {
    murmur: m.murmur,
    birds: 0,
    crickets: m.murmur > 0 ? 0 : m.crickets,
    bells: 0,
    drums: 0,
    wind: 0,
    cheers: 0,
  }
}

/** Each layer's loudest, so the whole stays a very soft bed under the street. */
const CAP: Mix = {
  murmur: 0.07,
  birds: 0.05,
  crickets: 0.012,
  bells: 0.06,
  drums: 0.09,
  wind: 0.06,
  cheers: 0.05,
}
const MASTER = 0.6
/**
 * Photo mode and the taxi ride show the street with the player not walking in it, so the ambience steps back
 * to this share of its level. It is ducked, not muted: the city stays audible, and the sound switch is the
 * only thing that turns it off.
 */
const DUCK = 0.5
/** How often the mix is re-read and the next sounds scheduled. */
const TICK_MS = 400
/** Levels glide with this time constant, in seconds. */
const GLIDE_S = 1.5
const LAYERS: Layer[] = ['murmur', 'birds', 'crickets', 'bells', 'drums', 'wind', 'cheers']
/** The layers that play steadily (sources running while audible), not in blips. */
type Steady = 'murmur' | 'crickets' | 'wind'
const steady = (k: Layer): k is Steady => k === 'murmur' || k === 'crickets' || k === 'wind'

let duck = false
/** The app says when the street is on show without the player in it (photo mode, a taxi ride). */
export function setAmbienceDuck(on: boolean): void {
  duck = on
}

export interface AmbienceDeps {
  district: string
  sky(): AmbientSky
  festival(): FestivalId | null
  /** The clock the festival's hours run on (the sky's: a test can freeze it); `new Date()` by default. */
  now?(): Date
  /** Whether sound is on: the sound switch, unless a test says otherwise. */
  enabled?(): boolean
  /** The audio context, asked for only from inside a gesture. */
  context?(): AmbientCtx | null
  quality?(): Tier
  onQuality?(cb: (q: Tier) => void): () => void
  /** Whether to step back (photo mode, a ride). */
  ducked?(): boolean
  /** Where gestures and visibility changes are heard. */
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
  random?(): number
}

/** The district's ambience: silent until a tap or key press, paused with the tab, gone on dispose. */
export function createAmbience(deps: AmbienceDeps) {
  const enabled = deps.enabled ?? soundOn
  const getCtx = deps.context ?? (() => sharedAudio() as AmbientCtx | null)
  const doc = deps.doc ?? document
  const random = deps.random ?? Math.random
  const ducked = deps.ducked ?? (() => duck)

  let ctx: AmbientCtx | null = null
  let master: Gain | null = null
  let noise: { getChannelData(c: number): Float32Array } | null = null
  const buses: Partial<Record<Layer, Gain>> = {}
  const target: Mix = { murmur: 0, birds: 0, crickets: 0, bells: 0, drums: 0, wind: 0, cheers: 0 }
  let masterTarget = MASTER
  /** The steady layers' running sources, only while they are audible. */
  const running: Partial<Record<Steady, Source[]>> = {}
  const retired: Source[] = []
  let timer: ReturnType<typeof setInterval> | null = null
  const next = { birds: 0, bells: 0, drums: 0, cheers: 0 }
  let disposed = false
  let paused = false
  let tier: Tier = deps.quality?.() ?? 2

  const hidden = () => doc.visibilityState === 'hidden'

  function gain(to: unknown, v: number) {
    const g = ctx!.createGain()
    g.gain.value = v
    g.connect(to)
    return g
  }
  function osc(type: string, hz: number, to: unknown, into: Source[]) {
    const o = ctx!.createOscillator()
    o.type = type
    o.frequency.value = hz
    o.connect(to)
    o.start(ctx!.currentTime)
    into.push(o)
  }

  /** A layer's bus into the master, made the first time the layer is audible. */
  function bus(k: Layer) {
    return (buses[k] ??= gain(master, 0))
  }

  /** Two seconds of white noise, made once and shared by the murmur and the wind. */
  function noiseBuffer() {
    const c = ctx!
    if (!noise) {
      noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1
    }
    return noise
  }

  /** Murmur: the noise, looped, band-passed to a crowd's voice range, swelling slowly. */
  function startMurmur(): Source[] {
    const c = ctx!
    const out: Source[] = []
    const src = c.createBufferSource()
    src.buffer = noiseBuffer()
    src.loop = true
    const band = c.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 500
    band.Q.value = 0.6
    const swell = gain(bus('murmur'), 0.7)
    src.connect(band)
    band.connect(swell)
    src.start(c.currentTime)
    out.push(src)
    osc('sine', 0.25, gain(swell.gain, 0.3), out)
    return out
  }

  /** Wind: the noise, looped, low-passed to a rush, in slow gusts (two slow wobbles that drift in and out of step). */
  function startWind(): Source[] {
    const c = ctx!
    const out: Source[] = []
    const src = c.createBufferSource()
    src.buffer = noiseBuffer()
    src.loop = true
    const low = c.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 420
    low.Q.value = 0.8
    const gust = gain(bus('wind'), 0.6)
    src.connect(low)
    low.connect(gust)
    src.start(c.currentTime)
    out.push(src)
    osc('sine', 0.07, gain(gust.gain, 0.3), out)
    osc('sine', 0.11, gain(gust.gain, 0.15), out)
    return out
  }

  /** Crickets: a high tone chopped by a ~9 Hz wobble. */
  function startCrickets(): Source[] {
    const out: Source[] = []
    const chop = gain(bus('crickets'), 0.5)
    osc('sine', 4300, chop, out)
    osc('sine', 9, gain(chop.gain, 0.5), out)
    return out
  }

  /**
   * A far-off cheer: a second of the noise, band-passed to a crowd's voices, swelling and dying away, with a
   * rising "whoo" over it. Its sources stop by themselves.
   */
  function cheer(at: number) {
    const c = ctx!
    const src = c.createBufferSource()
    src.buffer = noiseBuffer()
    const band = c.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 900
    band.Q.value = 0.9
    const env = c.createGain()
    env.gain.setValueAtTime(0.0001, at)
    env.gain.linearRampToValueAtTime(0.8, at + 0.25)
    env.gain.exponentialRampToValueAtTime(0.0001, at + 1.4)
    src.connect(band)
    band.connect(env)
    env.connect(bus('cheers'))
    src.start(at)
    src.stop(at + 1.5)
    blip('cheers', 320, at + 0.05, 0.25, 0.7, 520)
  }

  /** Moves a layer to a level, starting or retiring its steady sources as it becomes audible or silent. */
  function setLevel(k: Layer, v: number, t: number) {
    if (v === target[k]) return
    target[k] = v
    if (v > 0) {
      if (k === 'murmur' && !running.murmur) running.murmur = startMurmur()
      if (k === 'crickets' && !running.crickets) running.crickets = startCrickets()
      if (k === 'wind' && !running.wind) running.wind = startWind()
      bus(k).gain.setTargetAtTime(v * CAP[k], t, GLIDE_S)
      return
    }
    buses[k]?.gain.setTargetAtTime(0, t, GLIDE_S)
    if (steady(k)) {
      const srcs = running[k]
      if (srcs) {
        for (const s of srcs) s.stop(t + GLIDE_S * 5)
        retired.push(...srcs)
      }
      running[k] = undefined
    }
  }

  /** A short enveloped tone into a layer's bus. */
  function blip(layer: Layer, hz: number, at: number, peak: number, len: number, hzEnd = hz) {
    const c = ctx!
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(peak, at + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, at + len)
    g.connect(bus(layer))
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
    const duckTo = MASTER * (ducked() ? DUCK : 1)
    if (duckTo !== masterTarget) {
      masterTarget = duckTo
      master.gain.setTargetAtTime(duckTo, t, 0.5)
    }
    let mix = mixFor(deps.district, deps.sky(), deps.festival(), deps.now?.() ?? new Date())
    if (tier === 0) mix = thinMix(mix)
    for (const k of LAYERS) setLevel(k, on ? mix[k] : 0, t)
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
    if (mix.cheers > 0 && t >= next.cheers) {
      // never at once: the first comes 9 to 20 s in, and so on
      if (next.cheers > 0) cheer(t)
      next.cheers = t + 9 + random() * 11
    }
  }

  const startTimer = () => void (timer ??= setInterval(tick, TICK_MS))
  const stopTimer = () => {
    if (timer) clearInterval(timer)
    timer = null
  }

  /**
   * From a tap or key press. The first one (with sound on) makes the context, the graph and the timer, once.
   * Every later one wakes the context if it is not running: a phone's first touch may not count as a
   * gesture, and a call or a screen lock leaves it 'interrupted' (Safari) or suspended.
   */
  function gesture() {
    if (disposed || hidden()) return
    if (ctx) {
      if (ctx.state !== 'running') void ctx.resume().catch(() => {})
      return
    }
    if (!enabled()) return
    const c = getCtx()
    if (!c) return
    ctx = c
    if (c.state !== 'running') void c.resume().catch(() => {})
    master = c.createGain()
    master.gain.value = MASTER
    master.connect(c.destination)
    tick()
    startTimer()
  }

  function visibility() {
    if (!ctx || disposed) return
    if (hidden()) {
      paused = true
      stopTimer()
      void ctx.suspend().catch(() => {})
    } else {
      paused = false
      void ctx.resume().catch(() => {})
      tick()
      startTimer()
    }
  }

  const offQuality = deps.onQuality?.((q) => {
    tier = q
    tick()
  })

  const gestures = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const
  for (const e of gestures) doc.addEventListener(e, gesture, true)
  doc.addEventListener('visibilitychange', visibility)

  return {
    dispose() {
      if (disposed) return
      disposed = true
      offQuality?.()
      for (const e of gestures) doc.removeEventListener(e, gesture, true)
      doc.removeEventListener('visibilitychange', visibility)
      stopTimer()
      for (const s of [
        ...(running.murmur ?? []),
        ...(running.crickets ?? []),
        ...(running.wind ?? []),
        ...retired,
      ]) {
        try {
          s.stop(ctx!.currentTime)
        } catch {
          // already stopped
        }
        s.disconnect()
      }
      retired.length = 0
      running.murmur = running.crickets = running.wind = undefined
      // silences any bell or drum still scheduled
      master?.disconnect()
      master = null
      ctx = null
    },
  }
}
