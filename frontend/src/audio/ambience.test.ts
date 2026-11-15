import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FestivalId } from '../net/protocol'
import { createAmbience, mixFor, phaseOf, type AmbientCtx } from './ambience'

const DAY = { sunElevationDeg: 50, sunAzimuthDeg: 200 }
const NIGHT = { sunElevationDeg: -30, sunAzimuthDeg: 20 }
const DAWN = { sunElevationDeg: 3, sunAzimuthDeg: 80 }
const DUSK = { sunElevationDeg: 3, sunAzimuthDeg: 270 }

it('reads the phase of the day from the sun', () => {
  expect([DAY, NIGHT, DAWN, DUSK].map(phaseOf)).toEqual(['day', 'night', 'dawn', 'dusk'])
})

it('puts the bazaar murmur in the Walled City and MI Road only', () => {
  expect(mixFor('walled-city', DAY, null).murmur).toBeGreaterThan(0)
  expect(mixFor('mi-road', DAY, null).murmur).toBeGreaterThan(0)
  expect(mixFor('university', DAY, null).murmur).toBe(0)
  expect(mixFor('malviya-nagar', DAY, null).murmur).toBe(0)
})

it('has birds by day, crickets at night, and bells only at dawn and dusk', () => {
  const day = mixFor('university', DAY, null)
  expect([day.birds > 0, day.crickets, day.bells]).toEqual([true, 0, 0])
  const night = mixFor('university', NIGHT, null)
  expect([night.birds, night.crickets > 0, night.bells]).toEqual([0, true, 0])
  expect(mixFor('university', DAWN, null).bells).toBe(1)
  expect(mixFor('university', DUSK, null).bells).toBe(1)
  expect(mixFor('university', DAWN, null).birds).toBeGreaterThan(0)
  expect(mixFor('university', DUSK, null).crickets).toBeGreaterThan(0)
})

it('plays festival drums only on a festival', () => {
  expect(mixFor('walled-city', DAY, null).drums).toBe(0)
  expect(mixFor('walled-city', DAY, 'holi').drums).toBe(1)
})

it('gives a district with no entry a quiet default, so a new one needs no code', () => {
  const m = mixFor('amer', DAY, null)
  expect(m.murmur).toBe(0)
  expect(m.birds).toBeGreaterThan(0)
})

// ---- lifecycle, with a fake AudioContext and document ----

let made: Fake[] = []
class Fake implements AmbientCtx {
  currentTime = 0
  sampleRate = 8000
  state = 'suspended'
  destination = { id: 'dest' }
  sources = 0
  stopped = 0
  gains: { gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> } }[] = []
  disconnected = 0
  resume = vi.fn(async () => void (this.state = 'running'))
  suspend = vi.fn(async () => void (this.state = 'suspended'))
  private param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime: vi.fn(),
  })
  private node = () => ({
    connect() {},
    disconnect: () => void this.disconnected++,
  })
  private source = () => ({
    ...this.node(),
    start: () => void this.sources++,
    stop: () => void this.stopped++,
  })
  createOscillator = () => ({ ...this.source(), type: '', frequency: this.param() })
  createGain = () => {
    const g = { ...this.node(), gain: this.param() }
    this.gains.push(g)
    return g
  }
  createBiquadFilter = () => ({ ...this.node(), type: '', frequency: this.param(), Q: this.param() })
  createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) })
  createBufferSource = () => ({ ...this.source(), buffer: null, loop: false })
}

class FakeDoc {
  visibilityState: DocumentVisibilityState = 'visible'
  private h = new Map<string, Set<() => void>>()
  addEventListener(e: string, f: () => void) {
    if (!this.h.has(e)) this.h.set(e, new Set())
    this.h.get(e)!.add(f)
  }
  removeEventListener(e: string, f: () => void) {
    this.h.get(e)?.delete(f)
  }
  fire(e: string) {
    for (const f of [...(this.h.get(e) ?? [])]) f()
  }
  count() {
    return [...this.h.values()].reduce((n, s) => n + s.size, 0)
  }
}

let doc: FakeDoc
let enabled = true
let festival: FestivalId | null = null
let sky = DAY
function make(district = 'walled-city') {
  return createAmbience({
    district,
    sky: () => sky,
    festival: () => festival,
    enabled: () => enabled,
    context: () => {
      const c = new Fake()
      made.push(c)
      return c
    },
    doc: doc as unknown as Document,
    random: () => 0.5,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  made = []
  doc = new FakeDoc()
  enabled = true
  festival = null
  sky = DAY
})
afterEach(() => vi.useRealTimers())

it('makes no context and no sound until a gesture', () => {
  const a = make()
  vi.advanceTimersByTime(5000)
  expect(made).toHaveLength(0)
  doc.fire('pointerdown')
  expect(made).toHaveLength(1)
  expect(made[0].resume).toHaveBeenCalled()
  expect(made[0].sources).toBeGreaterThan(0)
  a.dispose()
})

it('stays silent on a gesture while sound is off, and starts on a later one once it is on', () => {
  enabled = false
  const a = make()
  doc.fire('keydown')
  expect(made).toHaveLength(0)
  enabled = true
  doc.fire('keydown')
  expect(made).toHaveLength(1)
  a.dispose()
})

it('does not start from a gesture in a hidden tab', () => {
  doc.visibilityState = 'hidden'
  const a = make()
  doc.fire('pointerdown')
  expect(made).toHaveLength(0)
  a.dispose()
})

it('pauses when the tab is hidden and resumes when it is visible again', () => {
  const a = make()
  doc.fire('pointerdown')
  const c = made[0]
  c.currentTime = 1
  c.resume.mockClear()
  doc.visibilityState = 'hidden'
  doc.fire('visibilitychange')
  expect(c.suspend).toHaveBeenCalledTimes(1)
  const targets = c.gains.reduce((n, g) => n + g.gain.setTargetAtTime.mock.calls.length, 0)
  vi.advanceTimersByTime(2000) // no scheduling while hidden
  expect(c.gains.reduce((n, g) => n + g.gain.setTargetAtTime.mock.calls.length, 0)).toBe(targets)
  doc.visibilityState = 'visible'
  doc.fire('visibilitychange')
  expect(c.resume).toHaveBeenCalledTimes(1)
  a.dispose()
})

it('fades every layer out when sound is switched off mid-visit', () => {
  const a = make()
  doc.fire('pointerdown')
  const c = made[0]
  enabled = false
  vi.advanceTimersByTime(500)
  // the layer buses (gains 1 to 5 after the master) were last told to go to 0
  for (const g of c.gains.slice(1, 6)) {
    const last = g.gain.setTargetAtTime.mock.calls.at(-1)!
    expect(last[0]).toBe(0)
  }
  a.dispose()
})

it('plays drums only on a festival, from the live festival', () => {
  const a = make('walled-city')
  doc.fire('pointerdown')
  const c = made[0]
  const before = c.sources
  c.currentTime = 10
  vi.advanceTimersByTime(400)
  const quiet = c.gains.length
  festival = 'diwali'
  c.currentTime = 30
  vi.advanceTimersByTime(400)
  expect(c.gains.length).toBeGreaterThan(quiet)
  expect(c.sources).toBeGreaterThan(before)
  a.dispose()
})

it('disposes everything on leave: sources stopped, graph cut, no timers, no listeners', () => {
  const a = make()
  doc.fire('pointerdown')
  const c = made[0]
  const started = c.sources
  a.dispose()
  expect(c.stopped).toBe(started)
  expect(c.disconnected).toBe(5) // the noise, the three steady oscillators and the master
  expect(doc.count()).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  c.currentTime = 100
  vi.advanceTimersByTime(5000)
  expect(c.sources).toBe(started)
  a.dispose() // twice is harmless
})
