import type { AmbientCtx } from '../audio/ambience'
import { sharedAudio, soundOn } from '../audio/horn'
import type { ShowKind } from '../world/types'

/*
 * The shows' tunes, made on the page from oscillators and a little noise: no samples, and no melody taken from
 * anywhere. Each is a few short phrases written here in a five- or seven-note scale of the kind the craft's own
 * music moves in, played on the page's one audio context (the ambience's graph, see `sharedAudio`) through a bus
 * of its own, so it can fade with distance while the ambience steps back under it (`setShowDuck`).
 *
 * Like every sound here it follows the sound switch, and it stops with the tab: notes are scheduled a quarter of
 * a second ahead from the frame loop, which a hidden tab does not run, and the ambience suspends the context.
 */

/** One note: when it starts (beats), its pitch (semitones above the tune's Sa) and how long it is held (beats). */
type Note = readonly [at: number, semitone: number, beats: number]
/** A phrase as written: pitch and length pairs, one after the other; a pitch of `REST` is a silence. */
type Phrase = readonly (readonly [semitone: number, beats: number])[]
const REST = -99

interface Tune {
  /** Sa, in Hz. */
  sa: number
  /** Seconds a beat. */
  beat: number
  /** The melody, phrase after phrase, then round again. */
  phrases: readonly Phrase[]
  /** The drum under it: where in a bar it falls (beats) and whether it is the low or the high side. */
  drum?: { bar: number; hits: readonly (readonly [at: number, low: boolean])[] }
  /** A held Sa and Pa under the tune, at this level. */
  drone?: number
  voice: 'pluck' | 'bowed' | 'reed'
}

// Kathputli: bright and quick, five notes (Sa Re Ga Pa Dha), a dholak under it.
// prettier-ignore
const K_A: Phrase = [[0, 0.5], [2, 0.5], [4, 0.5], [7, 0.5], [9, 1], [7, 1], [4, 0.5], [7, 0.5], [9, 0.5], [12, 0.5], [9, 1], [7, 1]]
// prettier-ignore
const K_B: Phrase = [[12, 0.5], [9, 0.5], [7, 0.5], [4, 0.5], [7, 1], [4, 1], [2, 0.5], [4, 0.5], [2, 0.5], [0, 0.5], [0, 2]]
// prettier-ignore
const K_C: Phrase = [[7, 0.5], [7, 0.5], [9, 0.5], [7, 0.5], [12, 1], [9, 1], [14, 0.5], [12, 0.5], [9, 0.5], [7, 0.5], [9, 1], [7, 1]]

// Ravanhatta: slow and bowed, seven notes, each sliding into the next over a drone.
// prettier-ignore
const R_A: Phrase = [[0, 2], [4, 1], [5, 1], [7, 2], [9, 1], [7, 1]]
// prettier-ignore
const R_B: Phrase = [[9, 1.5], [12, 0.5], [11, 1], [9, 1], [7, 3], [REST, 1]]
// prettier-ignore
const R_C: Phrase = [[12, 2], [14, 1], [12, 1], [11, 1], [9, 1], [7, 2]]
// prettier-ignore
const R_D: Phrase = [[5, 1], [4, 1], [2, 1], [4, 1], [0, 4]]

// The dancers: a reed's line in six, five notes with the flat third and seventh, a dholak driving it.
// prettier-ignore
const D_A: Phrase = [[0, 1], [3, 0.5], [5, 0.5], [7, 1], [5, 0.5], [7, 0.5], [10, 1], [7, 1]]
// prettier-ignore
const D_B: Phrase = [[12, 1], [10, 0.5], [7, 0.5], [10, 1], [7, 0.5], [5, 0.5], [7, 2]]
// prettier-ignore
const D_C: Phrase = [[7, 0.5], [7, 0.5], [10, 0.5], [12, 0.5], [15, 1], [12, 1], [10, 0.5], [12, 0.5], [10, 1]]
// prettier-ignore
const D_D: Phrase = [[5, 1], [3, 0.5], [5, 0.5], [7, 1], [3, 1], [0, 2]]

export const TUNES: Record<ShowKind, Tune> = {
  kathputli: {
    sa: 392,
    beat: 60 / 132,
    phrases: [K_A, K_B, K_A, K_C, K_A, K_B, K_C, K_B],
    // prettier-ignore
    drum: { bar: 4, hits: [[0, true], [1.5, false], [2, true], [3, false]] },
    voice: 'pluck',
  },
  ravanhatta: {
    sa: 293.66,
    beat: 0.75,
    phrases: [R_A, R_B, R_C, R_D],
    drone: 0.05,
    voice: 'bowed',
  },
  dancers: {
    sa: 329.63,
    beat: 0.36,
    phrases: [D_A, D_B, D_A, D_D, D_C, D_B, D_C, D_D],
    // prettier-ignore
    drum: { bar: 6, hits: [[0, true], [1.5, false], [3, true], [4, false], [5, false]] },
    drone: 0.03,
    voice: 'reed',
  },
}

/** A tune's phrases laid end to end: every note with the beat it starts on, and how many beats the round is. */
export function scoreOf(tune: Pick<Tune, 'phrases'>): { notes: Note[]; beats: number } {
  const notes: Note[] = []
  let at = 0
  for (const phrase of tune.phrases)
    for (const [semitone, beats] of phrase) {
      if (semitone !== REST) notes.push([at, semitone, beats])
      at += beats
    }
  return { notes, beats: at }
}

/** Notes are handed to the audio clock this far ahead of when they sound. */
const AHEAD_S = 0.25
/** The bus at its loudest (beside the performers); the ambience's master is 0.6, and it is ducked under this. */
const LEVEL = 0.55

export interface ShowMusicDeps {
  /** The audio context; by default the page's one, and only while sound is on. */
  context?(): AmbientCtx | null
  /** Whether sound is on: the sound switch, unless a test says otherwise. */
  enabled?(): boolean
  random?(): number
}

export interface ShowMusic {
  /** Begins `kind`'s tune from its first note. */
  start(kind: ShowKind): void
  /**
   * Call every frame while a show plays: `elapsed` seconds into it, `loud` 0 to 1 by how near the player is.
   * Returns whether anything can be heard (sound on, a running context, and near enough).
   */
  update(elapsed: number, loud: number): boolean
  /** Lets the tune die away. */
  stop(): void
  /** A few handclaps, from the player. */
  clap(): void
  dispose(): void
}

export function createShowMusic(deps: ShowMusicDeps = {}): ShowMusic {
  const enabled = deps.enabled ?? soundOn
  const getCtx = deps.context ?? (() => sharedAudio() as AmbientCtx | null)
  const random = deps.random ?? Math.random

  let ctx: AmbientCtx | null = null
  let bus: ReturnType<AmbientCtx['createGain']> | null = null
  let noise: ReturnType<AmbientCtx['createBuffer']> | null = null
  let tune: Tune | null = null
  let score: { notes: Note[]; beats: number } | null = null
  /** The next note and drum hit to schedule, counted through every round so far. */
  let nextNote = 0
  let nextHit = 0
  let level = -1
  /** The drone's oscillators, while it sounds. */
  const drone: { stop(t: number): void }[] = []
  /** A voice's filter into the bus, made the first time that voice plays. */
  const filters: Partial<Record<Tune['voice'], unknown>> = {}

  /** The context, once there is one and it runs; never while sound is off. */
  function audio(): AmbientCtx | null {
    if (!enabled()) return null
    ctx ??= getCtx()
    if (!ctx) return null
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {})
      return null
    }
    if (!bus) {
      bus = ctx.createGain()
      bus.gain.value = 0
      bus.connect(ctx.destination)
    }
    return ctx
  }

  function noiseBuffer(c: AmbientCtx) {
    if (!noise) {
      noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.3), c.sampleRate)
      const data = noise.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1
    }
    return noise
  }

  /** One enveloped oscillator into `to`. */
  function tone(
    c: AmbientCtx,
    to: unknown,
    type: string,
    hz: number,
    at: number,
    len: number,
    peak: number,
    attack: number,
    from = hz,
  ) {
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(peak, at + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, at + len)
    g.connect(to)
    const o = c.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(from, at)
    if (from !== hz) o.frequency.exponentialRampToValueAtTime(hz, at + Math.min(0.14, len / 2))
    o.connect(g)
    o.start(at)
    o.stop(at + len + 0.05)
  }

  /** A voice's filter into the bus (one for the tune, not one a note). */
  function through(c: AmbientCtx, voice: Tune['voice'], type: string, hz: number, q: number) {
    if (filters[voice]) return filters[voice]
    const f = c.createBiquadFilter()
    f.type = type
    f.frequency.value = hz
    f.Q.value = q
    f.connect(bus)
    return (filters[voice] = f)
  }

  let prev = 0
  function play(c: AmbientCtx, t: Tune, semitone: number, at: number, len: number) {
    const hz = t.sa * 2 ** (semitone / 12)
    if (t.voice === 'pluck') {
      // a struck string: bright at once, gone quickly, an octave shimmer over it
      tone(c, bus, 'triangle', hz, at, Math.min(len, 0.5), 0.2, 0.008)
      tone(c, bus, 'sine', hz * 2, at, 0.12, 0.05, 0.005)
    } else if (t.voice === 'bowed') {
      // a bowed string: it swells, and slides in from the note before
      tone(
        c,
        through(c, 'bowed', 'lowpass', 1500, 0.7),
        'sawtooth',
        hz,
        at,
        len * 1.08,
        0.13,
        0.09,
        prev || hz,
      )
      tone(c, bus, 'sine', hz, at, len, 0.07, 0.12, prev || hz)
    } else {
      // a reed: nasal, held for its whole length
      tone(c, through(c, 'reed', 'bandpass', 1300, 1.4), 'square', hz, at, len * 0.95, 0.16, 0.02)
    }
    prev = hz
  }

  /** A dholak's stroke: the low side falls in pitch, the high side is a short tap. */
  function hit(c: AmbientCtx, at: number, low: boolean) {
    if (low) tone(c, bus, 'sine', 62, at, 0.26, 0.5, 0.005, 150)
    else tone(c, bus, 'triangle', 330, at, 0.07, 0.16, 0.003, 420)
  }

  function startDrone(c: AmbientCtx, t: Tune) {
    if (!t.drone || drone.length) return
    for (const hz of [t.sa / 2, (t.sa / 2) * 1.5]) {
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, c.currentTime)
      g.gain.linearRampToValueAtTime(t.drone, c.currentTime + 1.2)
      g.connect(bus)
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.value = hz
      o.connect(g)
      o.start(c.currentTime)
      drone.push(o)
    }
  }
  function stopDrone() {
    // once the bus has died away under them
    for (const o of drone) o.stop(ctx!.currentTime + 1.5)
    drone.length = 0
  }

  function setLevel(c: AmbientCtx, to: number, glide: number) {
    if (to === level) return
    level = to
    bus!.gain.setTargetAtTime(to, c.currentTime, glide)
  }

  return {
    start(kind) {
      tune = TUNES[kind]
      score = scoreOf(tune)
      nextNote = 0
      nextHit = 0
      prev = 0
      // a tune cut short and begun again: this one has its own drone
      stopDrone()
    },
    update(elapsed, loud) {
      const c = audio()
      if (!c || !tune || !score) {
        // sound went off mid-tune: what is scheduled dies away
        if (ctx && bus && level > 0) setLevel(ctx, 0, 0.1)
        return false
      }
      // in steps of a twentieth, so a steady walk does not write the gain every frame
      setLevel(c, (Math.round(loud * 20) / 20) * LEVEL, 0.25)
      const until = elapsed + AHEAD_S
      const t = tune
      const round = score.beats * t.beat
      // too far to hear: the place in the tune is kept, nothing is made
      const heard = loud > 0
      for (;;) {
        const lap = Math.floor(nextNote / score.notes.length)
        const [beat, semitone, beats] = score.notes[nextNote % score.notes.length]!
        const at = lap * round + beat * t.beat
        if (at > until) break
        nextNote++
        // a note whose time passed while there was no sound (or no frame) is skipped, not played late
        if (heard && at >= elapsed - 0.05)
          play(c, t, semitone, c.currentTime + Math.max(0, at - elapsed), beats * t.beat)
      }
      if (t.drum)
        for (;;) {
          const bar = Math.floor(nextHit / t.drum.hits.length)
          const [beat, low] = t.drum.hits[nextHit % t.drum.hits.length]!
          const at = (bar * t.drum.bar + beat) * t.beat
          if (at > until) break
          nextHit++
          if (heard && at >= elapsed - 0.05) hit(c, c.currentTime + Math.max(0, at - elapsed), low)
        }
      if (heard) startDrone(c, t)
      return heard
    },
    stop() {
      tune = null
      score = null
      if (ctx && bus) setLevel(ctx, 0, 0.35)
      if (ctx) stopDrone()
    },
    clap() {
      const c = audio()
      if (!c) return
      // straight out, not through the show's bus: your own hands are as loud wherever the show is
      const out = c.createGain()
      out.gain.value = 0.5
      out.connect(c.destination)
      for (let i = 0; i < 5; i++) {
        const at = c.currentTime + i * 0.19 + random() * 0.02
        const src = c.createBufferSource()
        src.buffer = noiseBuffer(c)
        const band = c.createBiquadFilter()
        band.type = 'bandpass'
        band.frequency.value = 1500 + random() * 500
        band.Q.value = 1.1
        const env = c.createGain()
        env.gain.setValueAtTime(0.0001, at)
        env.gain.linearRampToValueAtTime(0.9, at + 0.004)
        env.gain.exponentialRampToValueAtTime(0.0001, at + 0.11)
        src.connect(band)
        band.connect(env)
        env.connect(out)
        src.start(at)
        src.stop(at + 0.13)
      }
    },
    dispose() {
      tune = null
      score = null
      if (ctx) stopDrone()
      // silences any note still scheduled
      bus?.disconnect()
      bus = null
      ctx = null
      level = -1
      filters.bowed = filters.reed = undefined
    },
  }
}
