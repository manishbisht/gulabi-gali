import { sharedAudio, soundOn, unlockAudio } from '../audio/horn'

/** What this file needs of WebAudio (the page's one context, see `sharedAudio`). */
interface Ctx {
  currentTime: number
  state: string
  destination: unknown
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

type Note = readonly [hz: number, at: number, len: number, type: string, vol: number]

/** `bat`: tennis ball on wood. `big`: a four or a six. `out`: the bricks go down. `glass`: somebody's window. */
const SOUNDS = {
  bat: [[190, 0, 0.07, 'triangle', 0.16]],
  big: [
    [190, 0, 0.07, 'triangle', 0.16],
    [523, 0.09, 0.12, 'sine', 0.07],
    [784, 0.2, 0.2, 'sine', 0.07],
  ],
  out: [
    [220, 0, 0.09, 'square', 0.05],
    [165, 0.1, 0.09, 'square', 0.05],
    [124, 0.2, 0.16, 'square', 0.05],
  ],
  glass: [
    [2093, 0, 0.09, 'sine', 0.05],
    [2637, 0.05, 0.09, 'sine', 0.05],
    [3136, 0.1, 0.16, 'sine', 0.05],
    [2349, 0.17, 0.2, 'sine', 0.04],
  ],
} as const satisfies Record<string, readonly Note[]>

/** A tap has woken the audio context: before one, nothing here makes a sound (or a context). */
let woken = false

/** From inside the batter's tap: lets the browser run the page's audio, if sound is on. */
export function wakeCricketSound(): void {
  unlockAudio()
  woken = true
}

/**
 * One of the game's short sounds, through the page's one context and its sound switch (`gg-sound`). Silent
 * with sound off, before the first tap, or with the context not running. Frames do not run in a hidden tab, so
 * nothing plays there. Returns whether it sounded.
 */
export function cricketSound(kind: keyof typeof SOUNDS): boolean {
  if (!woken || !soundOn()) return false
  const c = sharedAudio() as Ctx | null
  if (!c || c.state !== 'running') return false
  const t = c.currentTime
  for (const [hz, at, len, type, vol] of SOUNDS[kind]) {
    const gain = c.createGain()
    gain.gain.setValueAtTime(0.0001, t + at)
    gain.gain.linearRampToValueAtTime(vol, t + at + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + at + len)
    gain.connect(c.destination)
    const o = c.createOscillator()
    o.type = type
    o.frequency.value = hz
    o.connect(gain)
    o.start(t + at)
    o.stop(t + at + len + 0.02)
  }
  return true
}

/** For tests: back to before the first tap. */
export function resetCricketSound(): void {
  woken = false
}
