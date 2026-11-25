import { expect, it, vi } from 'vitest'
import type { AmbientCtx } from './ambience'
import { playTouch, type TouchSound } from './touch'

class Fake implements AmbientCtx {
  currentTime = 5
  sampleRate = 8000
  state = 'running'
  destination = { id: 'dest' }
  started: number[] = []
  stopped: number[] = []
  /** Every gain's loudest ramp target. */
  peaks: number[] = []
  buffers = 0
  resume = vi.fn(async () => void (this.state = 'running'))
  suspend = vi.fn(async () => {})
  private param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime: (v: number) => void this.peaks.push(v),
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  })
  private node = () => ({ connect() {}, disconnect() {} })
  private source = () => ({
    ...this.node(),
    start: (t: number) => void this.started.push(t),
    stop: (t: number) => void this.stopped.push(t),
  })
  createOscillator = () => ({ ...this.source(), type: '', frequency: this.param() })
  createGain = () => ({ ...this.node(), gain: this.param() })
  createBiquadFilter = () => ({ ...this.node(), type: '', frequency: this.param(), Q: this.param() })
  createBuffer = (_c: number, len: number) => {
    this.buffers++
    return { getChannelData: () => new Float32Array(len) }
  }
  createBufferSource = () => ({ ...this.source(), buffer: null, loop: false })
}

const KINDS: TouchSound[] = ['bell', 'pump', 'pigeons', 'diya', 'purr']
const deps = (c: Fake | null, over: { enabled?: boolean; hidden?: boolean } = {}) => ({
  enabled: () => over.enabled ?? true,
  hidden: () => over.hidden ?? false,
  context: vi.fn(() => c),
})

it.each(KINDS)('%s: a short, soft sound that starts now and stops by itself', (kind) => {
  const c = new Fake()
  expect(playTouch(kind, deps(c))).toBe(true)
  expect(c.started.length).toBeGreaterThan(0)
  // every source that starts is told when to stop, within a few seconds
  expect(c.stopped).toHaveLength(c.started.length)
  expect(Math.min(...c.started)).toBe(5)
  expect(Math.max(...c.stopped)).toBeLessThan(5 + 4)
  // soft: nothing as loud as the auto's horn (0.18)
  expect(Math.max(...c.peaks)).toBeLessThanOrEqual(0.07)
})

it('follows the sound switch: off, it makes no sound and asks for no audio context', () => {
  const c = new Fake()
  const d = deps(c, { enabled: false })
  expect(playTouch('bell', d)).toBe(false)
  expect(d.context).not.toHaveBeenCalled()
  expect(c.started).toHaveLength(0)
})

it('plays nothing in a hidden tab', () => {
  const c = new Fake()
  expect(playTouch('pigeons', deps(c, { hidden: true }))).toBe(false)
  expect(c.started).toHaveLength(0)
})

it('is silent, and does not throw, where there is no audio', () => {
  expect(playTouch('pump', deps(null))).toBe(false)
})

it('wakes a suspended context (the touch follows a tap), and makes the noise once per context', () => {
  const c = new Fake()
  c.state = 'suspended'
  expect(playTouch('pump', deps(c))).toBe(true)
  expect(c.resume).toHaveBeenCalled()
  playTouch('pigeons', deps(c))
  playTouch('diya', deps(c))
  expect(c.buffers).toBe(1)
})

it('the bell is one ring: three partials and nothing repeating', () => {
  const c = new Fake()
  playTouch('bell', deps(c))
  expect(c.started).toEqual([5, 5, 5])
})
