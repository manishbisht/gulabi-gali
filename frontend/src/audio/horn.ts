import { storage } from '../storage'

const KEY = 'gg-sound'
/** One honk at most this often, however hard the key or button is hammered. */
export const HONK_GAP_MS = 500
/** How long a honk sounds, in seconds. */
const HONK_S = 0.25

/** What this file needs of WebAudio, so a test can stand in for it. */
interface Audio {
  currentTime: number
  state: string
  destination: unknown
  resume(): Promise<void>
  close(): Promise<void>
  createOscillator(): {
    type: string
    frequency: { value: number }
    connect(n: unknown): void
    start(t: number): void
    stop(t: number): void
  }
  createGain(): {
    gain: {
      setValueAtTime(v: number, t: number): void
      linearRampToValueAtTime(v: number, t: number): void
      exponentialRampToValueAtTime(v: number, t: number): void
    }
    connect(n: unknown): void
  }
}

let ctx: Audio | null = null
let lastHonk = -Infinity
let on: boolean | null = null

/** Whether sound is on: a visitor's choice, kept under `gg-sound`; on until they say otherwise. */
export function soundOn(): boolean {
  on ??= storage.get(KEY) !== 'off'
  return on
}

export function setSoundOn(next: boolean): void {
  on = next
  storage.set(KEY, next ? 'on' : 'off')
}

/**
 * The audio context, made on first use (always from a honk, which always follows a key press or a tap, so
 * the browser lets it run) and never before: nothing here plays by itself.
 */
function context(): Audio | null {
  if (ctx) return ctx
  const Impl = globalThis as { AudioContext?: new () => Audio; webkitAudioContext?: new () => Audio }
  const Ctor = Impl.AudioContext ?? Impl.webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

/**
 * Wakes the audio context if there is one to make, from inside a tap or key press, so a later honk is not
 * held back by a browser that wants a gesture first. Does nothing when sound is off.
 */
export function unlockAudio(): void {
  if (!soundOn()) return
  const c = context()
  // not just 'suspended': Safari reports 'interrupted' after a call or a lock
  if (c && c.state !== 'running') void c.resume().catch(() => {})
}

/**
 * A two-tone auto horn, 0.25 s, made of two oscillators. At most one every `HONK_GAP_MS`, never while sound
 * is off. Heard only here: nothing is sent to anyone. Returns whether it sounded.
 */
export function honk(now: number = performance.now()): boolean {
  if (!soundOn() || now - lastHonk < HONK_GAP_MS) return false
  const c = context()
  if (!c) return false
  lastHonk = now
  if (c.state !== 'running') void c.resume().catch(() => {})
  const t = c.currentTime
  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.linearRampToValueAtTime(0.18, t + 0.02)
  gain.gain.setValueAtTime(0.18, t + HONK_S - 0.06)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + HONK_S)
  gain.connect(c.destination)
  for (const hz of [392, 494]) {
    const o = c.createOscillator()
    o.type = 'square'
    o.frequency.value = hz
    o.connect(gain)
    o.start(t)
    o.stop(t + HONK_S)
  }
  return true
}

/**
 * A soft two-note chime for arriving by metro. Only when sound is on and a context already exists (a honk
 * made it): this never creates one, so a ride stays silent for anyone who has not driven.
 */
export function chime(): boolean {
  const c = ctx
  if (!c || !soundOn() || c.state !== 'running') return false
  const t = c.currentTime
  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.linearRampToValueAtTime(0.08, t + 0.03)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
  gain.connect(c.destination)
  ;[659, 523].forEach((hz, i) => {
    const o = c.createOscillator()
    o.type = 'sine'
    o.frequency.value = hz
    o.connect(gain)
    o.start(t + i * 0.2)
    o.stop(t + i * 0.2 + 0.4)
  })
  return true
}

/**
 * A short rising chirp for a cut string ("Wo kaata!"). Like the chime it never makes a context: the pull
 * button wakes one (`unlockAudio`), and with sound off or none running this stays silent.
 */
export function woKaata(): boolean {
  const c = ctx
  if (!c || !soundOn() || c.state !== 'running') return false
  const t = c.currentTime
  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.linearRampToValueAtTime(0.1, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28)
  gain.connect(c.destination)
  const o = c.createOscillator()
  o.type = 'triangle'
  o.frequency.value = 520
  o.connect(gain)
  o.start(t)
  o.stop(t + 0.3)
  return true
}

/**
 * Whether the city's ambience may play: the sound switch is on AND the visitor has chosen it (a stored
 * `on`, not just the default), so a first visit stays silent apart from the horn.
 */
export function ambientOn(): boolean {
  return soundOn() && storage.get(KEY) === 'on'
}

/**
 * The page's one audio context, for the ambience to build on (made here if there is none yet; the caller
 * only asks from inside a tap or key press). Typed loosely: the ambience declares what it uses.
 */
export function sharedAudio(): unknown {
  return context()
}

/** Lets the audio context go (the page is leaving the city); the next honk makes a fresh one. */
export function closeAudio(): void {
  const c = ctx
  ctx = null
  lastHonk = -Infinity
  void c?.close().catch(() => {})
}

/** For tests: forgets the cached choice and the throttle, so the next read starts from storage again. */
export function resetHorn(): void {
  ctx = null
  lastHonk = -Infinity
  on = null
}
